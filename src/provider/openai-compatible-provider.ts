import OpenAI from "openai";
import { readFileSync } from "node:fs";
import { Agent, fetch as undiciFetch } from "undici";
import type { ModelProvider, StreamContext } from "./model-provider.js";
import type { FinishReason, Message, MessageContent, StreamEvent, TokenUsage, ToolSchema } from "../types/message.js";

type ChatCompletionCreateParams = Parameters<OpenAI["chat"]["completions"]["stream"]>[0];

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
          // OpenAI's tool message has no field equivalent to Anthropic's
          // native `is_error` on a tool_result content block, so fold the
          // error signal into the content string itself rather than
          // silently dropping it.
          const output = content.isError ? `Error: ${content.output}` : content.output;
          result.push({ role: "tool", tool_call_id: content.toolCallId, content: output });
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

interface AccumulatedToolCall {
  id: string;
  name: string;
  args: string;
}

// The subset of a streamed chunk this provider reads. Declared locally rather
// than taken from the SDK because `reasoning_content` is not in OpenAI's schema
// and every field here must be treated as optional -- compatible servers vary
// in which ones they send.
interface StreamChunk {
  // Arrives in its own trailing chunk, which carries an empty choices array --
  // so usage must be read from every chunk, not only from ones with content.
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
  choices?: {
    delta?: {
      content?: string | null;
      reasoning_content?: string | null;
      tool_calls?: {
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }[];
    };
    finish_reason?: string | null;
  }[];
}

export interface OpenAiCompatibleProviderOptions {
  // Every endpoint speaking OpenAI's chat-completions dialect is reachable by
  // varying this alone: OpenRouter, a self-hosted router, Ollama, LM Studio,
  // vLLM, LiteLLM, Groq, DeepSeek, Together. Required rather than defaulted,
  // so a misconfigured endpoint fails at construction instead of silently
  // sending a local-model request to a paid hosted API.
  baseUrl: string;
  model: string;
  // Local runtimes accept and ignore any key, but the OpenAI SDK refuses to
  // construct without a non-empty one -- see PLACEHOLDER_API_KEY in the CLI's
  // buildProvider, which supplies a sentinel when no key is configured.
  apiKey: string;
  // Surfaces in logs and session entries. Defaults to a generic label rather
  // than to the endpoint, which can contain credentials in its query string.
  name?: string;
  maxTokens?: number;
  // Path to a PEM certificate authority to trust in addition to the system
  // store. Self-hosted endpoints commonly sit behind a private CA (Caddy's
  // internal authority, an corporate root), whose certificates Node rejects by
  // default. This is the correct fix for that case: it adds one anchor rather
  // than switching verification off.
  caCertPath?: string;
  // Escape hatch for a private endpoint whose CA certificate is not available.
  // Scoped to this provider's own HTTP client -- unlike
  // NODE_TLS_REJECT_UNAUTHORIZED=0, it cannot silently weaken any other
  // connection the process makes.
  insecureSkipTlsVerify?: boolean;
}

// Returns undefined when neither TLS option is set, so the default global
// dispatcher (and its connection pooling) is used in the common case.
function buildTlsDispatcher(options: OpenAiCompatibleProviderOptions): Agent | undefined {
  if (options.caCertPath) {
    return new Agent({ connect: { ca: readFileSync(options.caCertPath, "utf8") } });
  }
  if (options.insecureSkipTlsVerify) {
    return new Agent({ connect: { rejectUnauthorized: false } });
  }
  return undefined;
}

export class OpenAiCompatibleProvider implements ModelProvider {
  readonly name: string;
  private readonly client: OpenAI;

  constructor(
    private readonly options: OpenAiCompatibleProviderOptions,
    client?: OpenAI,
  ) {
    this.name = options.name ?? "openai-compatible";
    const dispatcher = buildTlsDispatcher(options);
    this.client =
      client ??
      new OpenAI({
        apiKey: options.apiKey,
        baseURL: options.baseUrl,
        // A dispatcher is only honoured by the undici instance that created
        // it, and Node's global fetch is a *different* bundled copy of undici
        // than the npm package -- so the matching fetch must be supplied
        // alongside it, or the request fails with an opaque connection error.
        // Both are cast because the SDK types fetchOptions as a WHATWG
        // RequestInit, which has no notion of undici's dispatcher.
        ...(dispatcher
          ? {
              fetch: undiciFetch as unknown as typeof globalThis.fetch,
              fetchOptions: { dispatcher } as Record<string, unknown>,
            }
          : {}),
      });
  }

  async *stream(context: StreamContext): AsyncIterable<StreamEvent> {
    const params = {
      model: this.options.model,
      messages: toOpenAiMessages(context.messages, context.systemPrompt),
      tools: toOpenAiTools(context.tools),
      stream: true,
      // Without this a streamed response reports no usage at all. Servers that
      // do not recognise the option ignore it, and the absent usage is handled
      // the same as any other missing count.
      stream_options: { include_usage: true },
      ...(this.options.maxTokens ? { max_tokens: this.options.maxTokens } : {}),
    } as ChatCompletionCreateParams;

    // Deliberately create() rather than the SDK's stream() helper. That helper
    // accumulates chunks through a strict validator which requires the first
    // delta to carry `role: "assistant"` -- mandated by OpenAI's own spec, but
    // omitted by several compatible servers (a self-hosted router is how this
    // first surfaced), which makes it throw "missing role for choice 0" before
    // a single token reaches the caller. Accumulating here instead means the
    // provider tolerates any server that gets the *content* right, which is
    // the whole point of an openai-compatible provider.
    const openaiStream = (await this.client.chat.completions.create(params, {
      signal: context.signal,
    })) as unknown as AsyncIterable<StreamChunk>;

    // Keyed by the `index` field rather than by array position: tool-call
    // fragments for several calls interleave across chunks, and only `index`
    // identifies which call a fragment belongs to.
    const toolCalls = new Map<number, AccumulatedToolCall>();
    let rawFinishReason: string | null = null;
    let usage: TokenUsage | undefined;

    for await (const chunk of openaiStream) {
      if (chunk.usage) {
        usage = {
          inputTokens: chunk.usage.prompt_tokens ?? 0,
          outputTokens: chunk.usage.completion_tokens ?? 0,
        };
      }

      const choice = chunk.choices?.[0];
      if (!choice) continue;
      const delta = choice.delta;

      if (delta?.content) {
        yield { type: "text_delta", text: delta.content };
      }
      // The reasoning-stream field is not in OpenAI's schema but is the
      // convention compatible servers settled on for exposing thinking tokens.
      if (delta?.reasoning_content) {
        yield { type: "thinking_delta", text: delta.reasoning_content };
      }

      for (const fragment of delta?.tool_calls ?? []) {
        const existing = toolCalls.get(fragment.index) ?? { id: "", name: "", args: "" };
        if (fragment.id) existing.id = fragment.id;
        if (fragment.function?.name) existing.name = fragment.function.name;
        // Arguments arrive as a partial JSON string split across chunks, so
        // they concatenate rather than replace.
        if (fragment.function?.arguments) existing.args += fragment.function.arguments;
        toolCalls.set(fragment.index, existing);
      }

      if (choice.finish_reason) rawFinishReason = choice.finish_reason;
    }

    for (const [, call] of [...toolCalls.entries()].sort(([a], [b]) => a - b)) {
      let input: unknown;
      try {
        input = JSON.parse(call.args);
      } catch {
        // A stream cut off mid-arguments leaves unparseable JSON. Emitting the
        // call with empty input keeps it visible to the orchestrator's
        // truncation defense, which fails it explicitly rather than executing
        // a tool with arguments nobody can vouch for.
        input = {};
      }
      yield { type: "tool_call", id: call.id, name: call.name, input };
    }

    yield {
      type: "finish",
      reason: mapFinishReason(rawFinishReason),
      rawReason: rawFinishReason ?? "unknown",
      usage,
    };
  }

  withMaxTokens(max: number): OpenAiCompatibleProvider {
    return new OpenAiCompatibleProvider({ ...this.options, maxTokens: max }, this.client);
  }
}
