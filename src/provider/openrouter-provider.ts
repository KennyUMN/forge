import OpenAI from "openai";
import type { ModelProvider, StreamContext } from "./model-provider.js";
import type { FinishReason, Message, MessageContent, StreamEvent, ToolSchema } from "../types/message.js";

type ChatCompletionCreateParams = Parameters<OpenAI["chat"]["completions"]["stream"]>[0];

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

const FINISH_REASON_MAP: Record<string, FinishReason> = {
  stop: "completed",
  tool_calls: "tool_calls",
  length: "truncated",
  content_filter: "filtered",
};

function mapFinishReason(rawReason: string | null): FinishReason {
  if (rawReason === null) return "other";
  return FINISH_REASON_MAP[rawReason] ?? "other";
}

function textOf(content: MessageContent[]): string {
  return content
    .filter((c): c is Extract<MessageContent, { type: "text" }> => c.type === "text")
    .map((c) => c.text)
    .join("");
}

// Converts Forge's Message[] into OpenAI's chat message shape. Two things
// this is NOT a direct 1:1 mapping for: (1) OpenAI needs the system prompt
// as its own leading message, not a separate top-level field like
// Anthropic's `system` param; (2) Sprint 2's session bridge coalesces
// consecutive tool_result entries into one internal Message with multiple
// ToolResultContent items, but OpenAI requires exactly one tool result per
// message (tool_call_id + content) -- so a "tool" role message here must be
// exploded into multiple OpenAI messages, one per result.
function toOpenAiMessages(messages: Message[], systemPrompt: string): ChatCompletionCreateParams["messages"] {
  const result: Record<string, unknown>[] = [{ role: "system", content: systemPrompt }];

  for (const message of messages) {
    if (message.role === "user") {
      result.push({ role: "user", content: textOf(message.content) });
    } else if (message.role === "assistant") {
      const text = textOf(message.content);
      const toolCalls = message.content.filter(
        (c): c is Extract<MessageContent, { type: "tool_call" }> => c.type === "tool_call",
      );
      const assistantMessage: Record<string, unknown> = { role: "assistant" };
      if (text) assistantMessage.content = text;
      if (toolCalls.length > 0) {
        assistantMessage.tool_calls = toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: JSON.stringify(tc.input) },
        }));
      }
      result.push(assistantMessage);
    } else {
      for (const content of message.content) {
        if (content.type === "tool_result") {
          result.push({ role: "tool", tool_call_id: content.toolCallId, content: content.output });
        }
      }
    }
  }

  return result as unknown as ChatCompletionCreateParams["messages"];
}

function toOpenAiTools(tools: ToolSchema[]): ChatCompletionCreateParams["tools"] {
  return tools.map((tool) => ({
    type: "function",
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  })) as ChatCompletionCreateParams["tools"];
}

export interface OpenRouterProviderOptions {
  apiKey: string;
  model: string;
  maxTokens?: number;
}

export class OpenRouterProvider implements ModelProvider {
  readonly name = "openrouter";
  private readonly client: OpenAI;

  constructor(
    private readonly options: OpenRouterProviderOptions,
    client?: OpenAI,
  ) {
    this.client = client ?? new OpenAI({ apiKey: options.apiKey, baseURL: OPENROUTER_BASE_URL });
  }

  async *stream(context: StreamContext): AsyncIterable<StreamEvent> {
    const params = {
      model: this.options.model,
      messages: toOpenAiMessages(context.messages, context.systemPrompt),
      tools: toOpenAiTools(context.tools),
      ...(this.options.maxTokens ? { max_tokens: this.options.maxTokens } : {}),
    } as ChatCompletionCreateParams;

    const openaiStream = this.client.chat.completions.stream(params);

    for await (const chunk of openaiStream) {
      const delta = chunk.choices[0]?.delta;
      if (delta?.content) {
        yield { type: "text_delta", text: delta.content };
      }
    }

    const finalCompletion = await openaiStream.finalChatCompletion();
    const choice = finalCompletion.choices[0];
    for (const toolCall of choice?.message.tool_calls ?? []) {
      if (toolCall.type !== "function") continue;
      let input: unknown;
      try {
        input = JSON.parse(toolCall.function.arguments);
      } catch {
        input = {};
      }
      yield { type: "tool_call", id: toolCall.id, name: toolCall.function.name, input };
    }

    yield {
      type: "finish",
      reason: mapFinishReason(choice?.finish_reason ?? null),
      rawReason: choice?.finish_reason ?? "unknown",
    };
  }

  withMaxTokens(max: number): OpenRouterProvider {
    return new OpenRouterProvider({ ...this.options, maxTokens: max }, this.client);
  }
}
