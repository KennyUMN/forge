# Multi-Provider Support (OpenRouter) — Design

**Date**: 2026-07-23
**Status**: Approved, pending implementation planning
**Scope**: First real second implementation of the `ModelProvider` interface (Sprint 1's seam), plus config-driven provider selection in the CLI. This is the start of the "multi-model routing" phase the kernel-phase PRD explicitly deferred — scoped here to "support more than one provider, pick one via config," not dynamic per-task routing.

## 1. Motivation

Forge only worked against a real Anthropic API key. That's a real lock-in complaint, not a nice-to-have: it blocks anyone without an Anthropic account from using Forge at all. OpenRouter is a single API gateway proxying 300+ models across providers (OpenAI, Anthropic, Google, Meta, Mistral, and more) through one OpenAI-compatible endpoint and one API key — one new `ModelProvider` implementation unlocks access to nearly all of them at once, rather than hand-writing N separate provider integrations.

## 2. Research Basis

Checked before designing (not assumed):
- No standalone official OpenRouter Node client exists with a clean low-level API. `@openrouter/ai-sdk-provider` is a Vercel AI SDK plugin (would pull in Vercel AI SDK as a dependency, contradicting Sprint 1's decision to avoid it). `@langchain/openrouter` is a LangChain integration (same problem, heavier).
- OpenRouter's own docs confirm the supported pattern: use the official `openai` npm package (v6.48.0, installed and inspected locally) with `baseURL: "https://openrouter.ai/api/v1"` and an OpenRouter API key. Documented as a genuine drop-in replacement, including streaming and tool/function calling.
- Inspected the `openai` SDK's real type definitions: `client.chat.completions.stream(params)` returns a `ChatCompletionStream` (`AsyncIterable<ChatCompletionChunk>` for live text deltas) that also exposes `.finalChatCompletion(): Promise<ChatCompletion>` — a direct analog to Anthropic SDK's `finalMessage()`, so tool-call arguments can be read complete and valid from the accumulated final result instead of hand-accumulating partial JSON deltas (`delta.tool_calls[].function.arguments` arrives as incremental string fragments in the raw stream, matching the same "accumulate live text, read tool calls from the final assembled result" pattern already used for `AnthropicProvider`).
- Inspected the real message/tool param shapes: `ChatCompletionToolMessageParam` is `{ role: "tool", tool_call_id: string, content: string }` — **one tool result per message**, no bundling multiple results into one message. This matters: Forge's `sessionEntriesToMessages` bridge (Sprint 2) coalesces consecutive `tool_result` entries into a single internal `Message` with `role: "tool"` and multiple `ToolResultContent` items. Converting that single Forge message into OpenAI's format requires **exploding it into one OpenAI message per tool result**, not a 1:1 message mapping. Assistant messages don't have this problem — OpenAI's `ChatCompletionAssistantMessageParam` allows both `content` (text) and `tool_calls` on the same message, matching Forge's own coalescing.

## 3. Architecture

```
src/provider/openrouter-provider.ts   -- new, mirrors anthropic-provider.ts's shape
src/cli/config.ts                     -- modified: ForgeConfig gains a `provider` field
src/cli/build-provider.ts             -- new: config -> concrete ModelProvider instance
src/cli/main.ts                       -- modified: uses build-provider.ts instead of a hardcoded AnthropicProvider
```

## 4. Components

### 4.1 `OpenRouterProvider`

Implements `ModelProvider` (`src/provider/model-provider.ts`, unchanged). Constructed with `{ apiKey, model }`. Internally: `new OpenAI({ apiKey, baseURL: "https://openrouter.ai/api/v1" })`.

`stream(context)`:
1. Converts Forge's `Message[]`/`ToolSchema[]` to OpenAI's `ChatCompletionMessageParam[]`/`ChatCompletionTool[]` (see 4.2/4.3).
2. Calls `client.chat.completions.stream({ model, messages, tools, stream: true })`.
3. Iterates the stream, yielding a `text_delta` StreamEvent for each `delta.content` chunk.
4. Awaits `.finalChatCompletion()`, extracts `choices[0].message.tool_calls` (already complete, valid JSON), yields one `tool_call` StreamEvent per entry.
5. Maps `choices[0].finish_reason` to Forge's `FinishReason`: `stop`→`completed`, `tool_calls`→`tool_calls`, `length`→`truncated`, `content_filter`→`filtered`, anything else (including the deprecated `function_call`)→`other`. Yields the `finish` event.

`withMaxTokens(max)` maps to the request's `max_tokens` field, returning a new `OpenRouterProvider` (immutable, matching `AnthropicProvider`'s pattern). `withThinking` is not implemented for v1 — it's optional on the `ModelProvider` interface, and OpenRouter's reasoning-model support varies per underlying model in ways not worth building against speculatively yet (YAGNI; revisit if a real need shows up).

### 4.2 Message conversion (`toOpenAiMessages`)

```ts
function toOpenAiMessages(messages: Message[]): ChatCompletionMessageParam[] {
  const result: ChatCompletionMessageParam[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      const text = message.content.filter((c) => c.type === "text").map((c) => c.text).join("");
      result.push({ role: "user", content: text });
    } else if (message.role === "assistant") {
      const text = message.content.filter((c) => c.type === "text").map((c) => c.text).join("");
      const toolCalls = message.content.filter((c) => c.type === "tool_call");
      const assistantMessage = { role: "assistant" as const, ...(text ? { content: text } : {}) };
      if (toolCalls.length > 0) {
        Object.assign(assistantMessage, {
          tool_calls: toolCalls.map((tc) => ({
            id: tc.id,
            type: "function" as const,
            function: { name: tc.name, arguments: JSON.stringify(tc.input) },
          })),
        });
      }
      result.push(assistantMessage);
    } else {
      // role === "tool": Forge may have coalesced several tool_result entries into
      // one internal Message -- OpenAI requires one message per tool result.
      for (const content of message.content) {
        if (content.type === "tool_result") {
          result.push({ role: "tool", tool_call_id: content.toolCallId, content: content.output });
        }
      }
    }
  }
  return result;
}
```

### 4.3 Tool schema conversion (`toOpenAiTools`)

`ToolSchema { name, description, parameters }` → `{ type: "function", function: { name, description, parameters } }` per tool. Direct field mapping, no explosion needed here.

### 4.4 Config (`src/cli/config.ts`)

`ForgeConfig` gains a `provider` field:

```ts
export interface ProviderConfig {
  type: "anthropic" | "openrouter";
  model?: string;
}
export interface ForgeConfig {
  mcpServers: McpServerConfig[];
  provider: ProviderConfig;
}
```

`loadConfig` defaults `provider` to `{ type: "anthropic" }` when the config file omits it or doesn't exist — fully backward compatible with every prior sprint's behavior. `model` defaults to `"claude-sonnet-4-5"` when `type: "anthropic"` and `model` is omitted (matches the CLI's existing hardcoded default). When `type: "openrouter"`, `model` is required — there's no sensible universal default across 300+ options, so a missing model is a clear config error, not a silent guess.

### 4.5 `buildProvider` (`src/cli/build-provider.ts`, new)

```ts
export function buildProvider(config: ProviderConfig): ModelProvider {
  if (config.type === "openrouter") {
    if (!config.model) throw new Error('provider.model is required when provider.type is "openrouter".');
    const apiKey = requireEnv("OPENROUTER_API_KEY");
    return new OpenRouterProvider({ apiKey, model: config.model });
  }
  const apiKey = requireEnv("ANTHROPIC_API_KEY");
  return new AnthropicProvider({ apiKey, model: config.model ?? "claude-sonnet-4-5" });
}
```

`requireEnv(name)` replaces Sprint 4's `requireApiKey()` (which was hardcoded to `ANTHROPIC_API_KEY`) with a parameterized version, used by both branches.

## 5. Non-Goals

- Dynamic per-task/per-cost routing across multiple simultaneously-configured providers (the "multi-model routing" phase's fuller scope) — this is "pick one provider via config," not a router.
- Thinking/reasoning-effort support for OpenRouter.
- Any provider beyond Anthropic and OpenRouter in this pass — OpenRouter itself already covers most of the "openness" complaint by proxying to everything else.
- Changing `AnthropicProvider` itself — untouched.
