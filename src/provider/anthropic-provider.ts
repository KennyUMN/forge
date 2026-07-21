import Anthropic from "@anthropic-ai/sdk";
import type { ModelProvider, StreamContext } from "./model-provider.js";
import type { FinishReason, StreamEvent, ThinkingEffort } from "../types/message.js";

type AnthropicStreamParams = Parameters<Anthropic["messages"]["stream"]>[0];

const FINISH_REASON_MAP: Record<string, FinishReason> = {
  end_turn: "completed",
  tool_use: "tool_calls",
  max_tokens: "truncated",
  stop_sequence: "completed",
};

function mapFinishReason(rawReason: string | null): FinishReason {
  if (rawReason === null) return "other";
  return FINISH_REASON_MAP[rawReason] ?? "other";
}

export interface AnthropicProviderOptions {
  apiKey: string;
  model: string;
  maxTokens?: number;
  thinkingEffort?: ThinkingEffort;
}

export class AnthropicProvider implements ModelProvider {
  readonly name = "anthropic";
  private readonly client: Anthropic;

  constructor(
    private readonly options: AnthropicProviderOptions,
    client?: Anthropic,
  ) {
    this.client = client ?? new Anthropic({ apiKey: options.apiKey });
  }

  async *stream(context: StreamContext): AsyncIterable<StreamEvent> {
    const params = {
      model: this.options.model,
      max_tokens: this.options.maxTokens ?? 4096,
      system: context.systemPrompt,
      messages: toAnthropicMessages(context.messages),
      tools: toAnthropicTools(context.tools),
    } as AnthropicStreamParams;

    const anthropicStream = this.client.messages.stream(params);

    for await (const event of anthropicStream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        yield { type: "text_delta", text: event.delta.text };
      }
    }

    const finalMessage = await anthropicStream.finalMessage();
    for (const block of finalMessage.content) {
      if (block.type === "tool_use") {
        yield { type: "tool_call", id: block.id, name: block.name, input: block.input };
      }
    }

    yield {
      type: "finish",
      reason: mapFinishReason(finalMessage.stop_reason),
      rawReason: finalMessage.stop_reason ?? "unknown",
    };
  }

  withThinking(effort: ThinkingEffort): ModelProvider {
    return new AnthropicProvider({ ...this.options, thinkingEffort: effort }, this.client);
  }

  withMaxTokens(max: number): ModelProvider {
    return new AnthropicProvider({ ...this.options, maxTokens: max }, this.client);
  }
}

function toAnthropicMessages(messages: StreamContext["messages"]): AnthropicStreamParams["messages"] {
  return messages.map((message) => ({
    role: message.role === "assistant" ? "assistant" : "user",
    content: message.content.map((content) => {
      if (content.type === "text") return { type: "text", text: content.text };
      if (content.type === "tool_call") {
        return { type: "tool_use", id: content.id, name: content.name, input: content.input };
      }
      return {
        type: "tool_result",
        tool_use_id: content.toolCallId,
        content: content.output,
        is_error: content.isError,
      };
    }),
  })) as AnthropicStreamParams["messages"];
}

function toAnthropicTools(tools: StreamContext["tools"]): AnthropicStreamParams["tools"] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
  })) as AnthropicStreamParams["tools"];
}
