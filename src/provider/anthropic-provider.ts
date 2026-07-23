import Anthropic from "@anthropic-ai/sdk";
import type { ModelProvider, StreamContext } from "./model-provider.js";
import type { FinishReason, StreamEvent, ThinkingEffort } from "../types/message.js";

type AnthropicStreamParams = Parameters<Anthropic["messages"]["stream"]>[0];

// The installed @anthropic-ai/sdk version predates the Extended Thinking API, so
// neither its request params nor its stream delta types model `thinking`. These
// field names match Anthropic's public API contract; they're modeled locally and
// merged in via permissive casts rather than widening the public SDK types.
//
// PROVISIONAL: because the installed SDK doesn't model this API, this wiring is
// only exercised against a hand-rolled fake client built to mirror the documented
// wire shape (see "exercises the full thinking-enabled request+response shape" in
// test/provider/anthropic-provider.test.ts) -- never against the real SDK's actual
// types or a live response. Treat this path as unverified until it has been run
// against a real Anthropic API call (Sprint 1 plan, Task 4 Step 7).
interface AnthropicThinkingConfig {
  type: "enabled";
  budget_tokens: number;
}

interface ThinkingDeltaEvent {
  type: "thinking_delta";
  thinking: string;
}

const DEFAULT_MAX_TOKENS = 4096;

// Provisional budgets: the brief specifies the `ThinkingEffort` type but not concrete
// token counts, so these are our own reasonable defaults, not a brief/spec requirement.
// Anthropic's Extended Thinking API requires `max_tokens` to strictly exceed
// `thinking.budget_tokens` — see `resolveMaxTokens()`, which enforces that invariant.
const THINKING_BUDGET_TOKENS: Record<Exclude<ThinkingEffort, "none">, number> = {
  low: 4_096,
  high: 16_384,
  max: 32_768,
};

const FINISH_REASON_MAP: Record<string, FinishReason> = {
  end_turn: "completed",
  tool_use: "tool_calls",
  max_tokens: "truncated",
  stop_sequence: "completed",
};

function toAnthropicThinking(effort: ThinkingEffort | undefined): AnthropicThinkingConfig | undefined {
  if (effort === undefined || effort === "none") return undefined;
  return { type: "enabled", budget_tokens: THINKING_BUDGET_TOKENS[effort] };
}

// Anthropic's Extended Thinking API rejects requests where `max_tokens` does not
// strictly exceed `thinking.budget_tokens`. When the caller never set an explicit
// `maxTokens`, auto-size it above the thinking budget (leaving `DEFAULT_MAX_TOKENS`
// worth of room for the actual response) so `withThinking(effort)` alone — the most
// natural call pattern — produces a valid request. When the caller did set an
// explicit `maxTokens` that's too small for the configured budget, fail fast with a
// clear error instead of silently sending an invalid request to the API.
function resolveMaxTokens(explicitMaxTokens: number | undefined, thinking: AnthropicThinkingConfig | undefined): number {
  if (!thinking) return explicitMaxTokens ?? DEFAULT_MAX_TOKENS;
  if (explicitMaxTokens === undefined) return thinking.budget_tokens + DEFAULT_MAX_TOKENS;
  if (explicitMaxTokens <= thinking.budget_tokens) {
    throw new Error(
      `max_tokens (${explicitMaxTokens}) must be greater than thinking.budget_tokens (${thinking.budget_tokens}); ` +
        `call withMaxTokens() with a larger value or use a lower thinking effort.`,
    );
  }
  return explicitMaxTokens;
}

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
    const thinking = toAnthropicThinking(this.options.thinkingEffort);
    const params = {
      model: this.options.model,
      max_tokens: resolveMaxTokens(this.options.maxTokens, thinking),
      system: context.systemPrompt,
      messages: toAnthropicMessages(context.messages),
      tools: toAnthropicTools(context.tools),
      ...(thinking ? { thinking } : {}),
    } as AnthropicStreamParams;

    const anthropicStream = this.client.messages.stream(params, { signal: context.signal });

    for await (const event of anthropicStream) {
      if (event.type === "content_block_delta") {
        const delta = event.delta as typeof event.delta | ThinkingDeltaEvent;
        if (delta.type === "text_delta") {
          yield { type: "text_delta", text: delta.text };
        } else if (delta.type === "thinking_delta") {
          yield { type: "thinking_delta", text: delta.thinking };
        }
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
      ...(finalMessage.usage
        ? {
            usage: {
              inputTokens: finalMessage.usage.input_tokens ?? 0,
              outputTokens: finalMessage.usage.output_tokens ?? 0,
            },
          }
        : {}),
    };
  }

  withThinking(effort: ThinkingEffort): AnthropicProvider {
    return new AnthropicProvider({ ...this.options, thinkingEffort: effort }, this.client);
  }

  withMaxTokens(max: number): AnthropicProvider {
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
