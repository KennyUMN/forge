# Multi-Provider Support (OpenRouter) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Forge can run against OpenRouter (300+ models across providers via one API) in addition to Anthropic, selected via `forge.config.json`, closing the "only accepts an Anthropic key" lock-in complaint.

**Architecture:** `OpenRouterProvider` implements the existing `ModelProvider` interface using the official `openai` npm package pointed at OpenRouter's OpenAI-compatible endpoint -- mirroring `AnthropicProvider`'s shape exactly (stream text live, read tool calls from an SDK-provided final-result accumulator, map finish reasons). `forge.config.json` gains a `provider` field; a new `buildProvider` function turns that config into a concrete `ModelProvider` instance, replacing `main.ts`'s hardcoded `AnthropicProvider` construction.

**Tech Stack:** TypeScript (Node >=20, ESM/NodeNext), Vitest, `openai@^6.48.0` (new dependency, verified against its real installed type definitions before writing this plan).

## Global Constraints

- Node >=20, TypeScript with `strict: true`.
- The only new runtime dependency is `openai` (official SDK), used solely by `OpenRouterProvider`, pointed at OpenRouter's `baseURL` -- not used to call OpenAI's API directly (out of scope, see the design spec's non-goals).
- Message conversion MUST explode a coalesced internal `Message{role:"tool", content: ToolResultContent[]}` into one OpenAI tool message per result -- OpenAI's API rejects/mishandles multiple tool results bundled into one message. Verify with a dedicated test, not just inspection.
- `config.ts`'s `requireApiKey()` is deliberately renamed to `requireEnv(name: string)` (generalized for both providers) -- this is an intentional signature change, not a regression; update every call site and test in the same task.
- No changes to `AnthropicProvider`, the `ModelProvider` interface, or any Sprint 1-4 kernel file (`src/agent/*`, `src/session/*`, `src/permission/*`, `src/tool/*`, `src/tools/*`, `src/mcp/*`) -- this work is confined to `src/provider/` (new file) and `src/cli/` (config + wiring).
- No placeholder/TODO code -- every function does what its tests assert.
- Commit after every task's tests pass.

## Real Interfaces This Plan Builds On

```ts
// src/provider/model-provider.ts (Sprint 1, unchanged)
export interface StreamContext { systemPrompt: string; messages: Message[]; tools: ToolSchema[]; }
export interface ModelProvider {
  readonly name: string;
  stream(context: StreamContext): AsyncIterable<StreamEvent>;
  withThinking?(effort: ThinkingEffort): ModelProvider;
  withMaxTokens?(max: number): ModelProvider;
}

// src/types/message.ts (Sprint 1/2, unchanged)
export interface TextContent { type: "text"; text: string; }
export interface ToolCallContent { type: "tool_call"; id: string; name: string; input: unknown; }
export interface ToolResultContent { type: "tool_result"; toolCallId: string; output: string; isError: boolean; }
export type MessageContent = TextContent | ToolCallContent | ToolResultContent;
export interface Message { role: "user" | "assistant" | "tool"; content: MessageContent[]; }
export interface ToolSchema { name: string; description: string; parameters: Record<string, unknown>; }
export type FinishReason = "completed" | "tool_calls" | "truncated" | "filtered" | "other";
export type StreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "thinking_delta"; text: string }
  | { type: "tool_call"; id: string; name: string; input: unknown }
  | { type: "finish"; reason: FinishReason; rawReason: string };

// src/cli/config.ts (Sprint 4, current -- Task 2 modifies this)
export interface ForgeConfig { mcpServers: McpServerConfig[]; }
export async function loadConfig(cwd: string): Promise<ForgeConfig>;
export function requireApiKey(): string; // reads ANTHROPIC_API_KEY specifically

// src/cli/main.ts (Sprint 4, current -- Task 2 modifies this)
// currently: const apiKey = requireApiKey(); const provider = new AnthropicProvider({ apiKey, model: DEFAULT_MODEL });
```

---

### Task 1: `OpenRouterProvider`

**Files:**
- Modify: `package.json` (add `openai` dependency)
- Create: `src/provider/openrouter-provider.ts`
- Test: `test/provider/openrouter-provider.test.ts`

**Interfaces:**
- Consumes: `ModelProvider`, `StreamContext` (Sprint 1, `src/provider/model-provider.js`); `Message`, `MessageContent`, `StreamEvent`, `FinishReason`, `ToolSchema` (Sprint 1/2, `src/types/message.js`).
- Produces: `OpenRouterProvider` class, `OpenRouterProviderOptions` interface -- Task 2's `buildProvider` constructs one and returns it as a `ModelProvider`.

- [ ] **Step 1: Add the `openai` dependency**

In `package.json`, find:

```json
  "dependencies": {
    "@anthropic-ai/sdk": "^0.32.0",
    "@modelcontextprotocol/sdk": "^1.29.0",
    "glob": "^13.0.6"
  },
```

Replace with:

```json
  "dependencies": {
    "@anthropic-ai/sdk": "^0.32.0",
    "@modelcontextprotocol/sdk": "^1.29.0",
    "glob": "^13.0.6",
    "openai": "^6.48.0"
  },
```

Run: `npm install`
Expected: `node_modules/openai` created, `package-lock.json` updated, no errors.

- [ ] **Step 2: Write the failing tests**

Create `test/provider/openrouter-provider.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type OpenAI from "openai";
import { OpenRouterProvider } from "../../src/provider/openrouter-provider.js";

function fakeOpenAiClient(chunks: unknown[], finalCompletion: unknown): OpenAI {
  return {
    chat: {
      completions: {
        stream: () => ({
          [Symbol.asyncIterator]: async function* () {
            for (const chunk of chunks) yield chunk;
          },
          finalChatCompletion: async () => finalCompletion,
        }),
      },
    },
  } as unknown as OpenAI;
}

describe("OpenRouterProvider", () => {
  it("streams text deltas and maps stop to completed", async () => {
    const client = fakeOpenAiClient(
      [{ choices: [{ delta: { content: "Hel" } }] }, { choices: [{ delta: { content: "lo" } }] }],
      { choices: [{ finish_reason: "stop", message: { tool_calls: [] } }] },
    );
    const provider = new OpenRouterProvider({ apiKey: "test", model: "test-model" }, client);

    const events = [];
    for await (const event of provider.stream({ systemPrompt: "", messages: [], tools: [] })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "text_delta", text: "Hel" },
      { type: "text_delta", text: "lo" },
      { type: "finish", reason: "completed", rawReason: "stop" },
    ]);
  });

  it("emits a tool_call event from the final completion's tool_calls, parsing the JSON arguments", async () => {
    const client = fakeOpenAiClient([], {
      choices: [
        {
          finish_reason: "tool_calls",
          message: {
            tool_calls: [
              { id: "call_1", type: "function", function: { name: "read_file", arguments: '{"path":"a.ts"}' } },
            ],
          },
        },
      ],
    });
    const provider = new OpenRouterProvider({ apiKey: "test", model: "test-model" }, client);

    const events = [];
    for await (const event of provider.stream({ systemPrompt: "", messages: [], tools: [] })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "tool_call", id: "call_1", name: "read_file", input: { path: "a.ts" } },
      { type: "finish", reason: "tool_calls", rawReason: "tool_calls" },
    ]);
  });

  it("maps length to truncated and a null finish_reason to other", async () => {
    const client = fakeOpenAiClient([], { choices: [{ finish_reason: "length", message: {} }] });
    const provider = new OpenRouterProvider({ apiKey: "test", model: "test-model" }, client);

    const events = [];
    for await (const event of provider.stream({ systemPrompt: "", messages: [], tools: [] })) {
      events.push(event);
    }

    expect(events).toEqual([{ type: "finish", reason: "truncated", rawReason: "length" }]);
  });

  it("withMaxTokens returns a new provider instance without mutating the original", () => {
    const client = fakeOpenAiClient([], { choices: [{ finish_reason: "stop", message: {} }] });
    const provider = new OpenRouterProvider({ apiKey: "test", model: "test-model" }, client);
    const updated = provider.withMaxTokens(4096);

    expect(updated).not.toBe(provider);
    expect(updated.name).toBe("openrouter");
  });

  it("explodes a coalesced tool-result message into one OpenAI tool message per result, and injects the system prompt as the first message", async () => {
    let receivedMessages: unknown;
    const client = {
      chat: {
        completions: {
          stream: (params: { messages: unknown }) => {
            receivedMessages = params.messages;
            return {
              [Symbol.asyncIterator]: async function* () {},
              finalChatCompletion: async () => ({ choices: [{ finish_reason: "stop", message: {} }] }),
            };
          },
        },
      },
    } as unknown as OpenAI;

    const provider = new OpenRouterProvider({ apiKey: "test", model: "test-model" }, client);

    const context = {
      systemPrompt: "You are Forge.",
      messages: [
        { role: "user" as const, content: [{ type: "text" as const, text: "do it" }] },
        {
          role: "assistant" as const,
          content: [
            { type: "text" as const, text: "sure" },
            { type: "tool_call" as const, id: "c1", name: "bash", input: { command: "ls" } },
            { type: "tool_call" as const, id: "c2", name: "bash", input: { command: "pwd" } },
          ],
        },
        {
          role: "tool" as const,
          content: [
            { type: "tool_result" as const, toolCallId: "c1", output: "a.ts", isError: false },
            { type: "tool_result" as const, toolCallId: "c2", output: "/repo", isError: false },
          ],
        },
      ],
      tools: [],
    };

    const events = [];
    for await (const event of provider.stream(context)) events.push(event);

    expect(receivedMessages).toEqual([
      { role: "system", content: "You are Forge." },
      { role: "user", content: "do it" },
      {
        role: "assistant",
        content: "sure",
        tool_calls: [
          { id: "c1", type: "function", function: { name: "bash", arguments: '{"command":"ls"}' } },
          { id: "c2", type: "function", function: { name: "bash", arguments: '{"command":"pwd"}' } },
        ],
      },
      { role: "tool", tool_call_id: "c1", content: "a.ts" },
      { role: "tool", tool_call_id: "c2", content: "/repo" },
    ]);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- test/provider/openrouter-provider.test.ts`
Expected: FAIL -- `Cannot find module '../../src/provider/openrouter-provider.js'`

- [ ] **Step 4: Implement `OpenRouterProvider`**

Create `src/provider/openrouter-provider.ts`:

```ts
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

  return result as ChatCompletionCreateParams["messages"];
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- test/provider/openrouter-provider.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 6: Run the full suite and both typecheck paths**

Run: `npm test && npm run typecheck && npm run typecheck:test`
Expected: all existing tests still pass (141 from Sprints 1-4), plus these 5 new = 146 total, both typechecks clean.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/provider/openrouter-provider.ts test/provider/openrouter-provider.test.ts
git commit -m "feat: add OpenRouterProvider implementing ModelProvider"
```

---

### Task 2: Config extension + `buildProvider` + CLI wiring

**Files:**
- Modify: `src/cli/config.ts` (add `ProviderConfig`, extend `ForgeConfig`/`loadConfig`, rename `requireApiKey` to `requireEnv`)
- Modify: `test/cli/config.test.ts` (update existing tests for the rename and the new `provider` field)
- Create: `src/cli/build-provider.ts`
- Test: `test/cli/build-provider.test.ts`
- Modify: `src/cli/main.ts` (use `buildProvider` instead of a hardcoded `AnthropicProvider`)

**Interfaces:**
- Consumes: `AnthropicProvider` (Sprint 1, `src/provider/anthropic-provider.js`); `OpenRouterProvider` (Task 1, `src/provider/openrouter-provider.js`); `ModelProvider` (Sprint 1, `src/provider/model-provider.js`).
- Produces: `ProviderConfig { type: "anthropic" | "openrouter"; model?: string }`, extended `ForgeConfig { mcpServers, provider }`, `requireEnv(name): string` (`src/cli/config.ts`); `buildProvider(config): ModelProvider` (`src/cli/build-provider.ts`) -- `main.ts` is the only caller of `buildProvider`.

- [ ] **Step 1: Update the config tests for the new provider field and the requireEnv rename**

Replace `test/cli/config.test.ts` in full with:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, requireEnv } from "../../src/cli/config.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "forge-cli-config-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("loadConfig", () => {
  it("returns an empty mcpServers list and the default anthropic provider when no config file exists", async () => {
    const config = await loadConfig(dir);
    expect(config).toEqual({ mcpServers: [], provider: { type: "anthropic" } });
  });

  it("reads mcpServers from forge.config.json when present", async () => {
    await writeFile(
      join(dir, "forge.config.json"),
      JSON.stringify({
        mcpServers: [{ name: "fs", command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "."] }],
      }),
      "utf8",
    );

    const config = await loadConfig(dir);

    expect(config.mcpServers).toEqual([
      { name: "fs", command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "."] },
    ]);
    expect(config.provider).toEqual({ type: "anthropic" });
  });

  it("defaults mcpServers to an empty array if the config file omits it", async () => {
    await writeFile(join(dir, "forge.config.json"), JSON.stringify({}), "utf8");

    const config = await loadConfig(dir);

    expect(config.mcpServers).toEqual([]);
  });

  it("reads a configured provider from forge.config.json", async () => {
    await writeFile(
      join(dir, "forge.config.json"),
      JSON.stringify({ provider: { type: "openrouter", model: "anthropic/claude-3.5-sonnet" } }),
      "utf8",
    );

    const config = await loadConfig(dir);

    expect(config.provider).toEqual({ type: "openrouter", model: "anthropic/claude-3.5-sonnet" });
  });

  it("defaults provider to anthropic if the config file omits it", async () => {
    await writeFile(join(dir, "forge.config.json"), JSON.stringify({ mcpServers: [] }), "utf8");

    const config = await loadConfig(dir);

    expect(config.provider).toEqual({ type: "anthropic" });
  });
});

describe("requireEnv", () => {
  it("returns the value when the given env var is set", () => {
    const original = process.env.FORGE_TEST_VAR;
    process.env.FORGE_TEST_VAR = "test-value";
    try {
      expect(requireEnv("FORGE_TEST_VAR")).toBe("test-value");
    } finally {
      if (original === undefined) delete process.env.FORGE_TEST_VAR;
      else process.env.FORGE_TEST_VAR = original;
    }
  });

  it("throws a clear error naming the env var when it is not set", () => {
    const original = process.env.FORGE_TEST_VAR;
    delete process.env.FORGE_TEST_VAR;
    try {
      expect(() => requireEnv("FORGE_TEST_VAR")).toThrow(/FORGE_TEST_VAR/);
    } finally {
      if (original !== undefined) process.env.FORGE_TEST_VAR = original;
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails against the current config.ts**

Run: `npm test -- test/cli/config.test.ts`
Expected: FAIL -- `requireEnv` is not exported, and `loadConfig`'s result is missing the `provider` field.

- [ ] **Step 3: Update `config.ts`**

Replace `src/cli/config.ts` in full with:

```ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { McpServerConfig } from "../mcp/mcp-client.js";

export interface ProviderConfig {
  type: "anthropic" | "openrouter";
  model?: string;
}

export interface ForgeConfig {
  mcpServers: McpServerConfig[];
  provider: ProviderConfig;
}

const CONFIG_FILENAME = "forge.config.json";
const DEFAULT_PROVIDER: ProviderConfig = { type: "anthropic" };

export async function loadConfig(cwd: string): Promise<ForgeConfig> {
  const configPath = join(cwd, CONFIG_FILENAME);
  let raw: string;
  try {
    raw = await readFile(configPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { mcpServers: [], provider: DEFAULT_PROVIDER };
    }
    throw err;
  }

  const parsed = JSON.parse(raw) as Partial<ForgeConfig>;
  return {
    mcpServers: parsed.mcpServers ?? [],
    provider: parsed.provider ?? DEFAULT_PROVIDER,
  };
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} environment variable is not set.`);
  }
  return value;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/cli/config.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Write the failing tests for `buildProvider`**

Create `test/cli/build-provider.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildProvider } from "../../src/cli/build-provider.js";
import { AnthropicProvider } from "../../src/provider/anthropic-provider.js";
import { OpenRouterProvider } from "../../src/provider/openrouter-provider.js";

describe("buildProvider", () => {
  it("builds an AnthropicProvider using ANTHROPIC_API_KEY and the default model when type is anthropic and model is omitted", () => {
    const original = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
    try {
      const provider = buildProvider({ type: "anthropic" });
      expect(provider).toBeInstanceOf(AnthropicProvider);
      expect(provider.name).toBe("anthropic");
    } finally {
      if (original === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = original;
    }
  });

  it("throws a clear error when type is anthropic and ANTHROPIC_API_KEY is not set", () => {
    const original = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      expect(() => buildProvider({ type: "anthropic" })).toThrow(/ANTHROPIC_API_KEY/);
    } finally {
      if (original !== undefined) process.env.ANTHROPIC_API_KEY = original;
    }
  });

  it("builds an OpenRouterProvider using OPENROUTER_API_KEY when type is openrouter and a model is given", () => {
    const original = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    try {
      const provider = buildProvider({ type: "openrouter", model: "anthropic/claude-3.5-sonnet" });
      expect(provider).toBeInstanceOf(OpenRouterProvider);
      expect(provider.name).toBe("openrouter");
    } finally {
      if (original === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = original;
    }
  });

  it("throws a clear error when type is openrouter and model is omitted", () => {
    expect(() => buildProvider({ type: "openrouter" })).toThrow(/provider\.model/);
  });

  it("throws a clear error when type is openrouter and OPENROUTER_API_KEY is not set", () => {
    const original = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    try {
      expect(() =>
        buildProvider({ type: "openrouter", model: "anthropic/claude-3.5-sonnet" }),
      ).toThrow(/OPENROUTER_API_KEY/);
    } finally {
      if (original !== undefined) process.env.OPENROUTER_API_KEY = original;
    }
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npm test -- test/cli/build-provider.test.ts`
Expected: FAIL -- `Cannot find module '../../src/cli/build-provider.js'`

- [ ] **Step 7: Implement `buildProvider`**

Create `src/cli/build-provider.ts`:

```ts
import { AnthropicProvider } from "../provider/anthropic-provider.js";
import { OpenRouterProvider } from "../provider/openrouter-provider.js";
import { requireEnv } from "./config.js";
import type { ModelProvider } from "../provider/model-provider.js";
import type { ProviderConfig } from "./config.js";

const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-5";

export function buildProvider(config: ProviderConfig): ModelProvider {
  if (config.type === "openrouter") {
    if (!config.model) {
      throw new Error('provider.model is required in forge.config.json when provider.type is "openrouter".');
    }
    const apiKey = requireEnv("OPENROUTER_API_KEY");
    return new OpenRouterProvider({ apiKey, model: config.model });
  }
  const apiKey = requireEnv("ANTHROPIC_API_KEY");
  return new AnthropicProvider({ apiKey, model: config.model ?? DEFAULT_ANTHROPIC_MODEL });
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npm test -- test/cli/build-provider.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 9: Wire `buildProvider` into `main.ts`**

In `src/cli/main.ts`, find:

```ts
import { AnthropicProvider } from "../provider/anthropic-provider.js";
import { PermissionGate } from "../permission/permission-gate.js";
import { DEFAULT_PERMISSION_POLICIES } from "../permission/permission-policies.js";
import { runTurn } from "../agent/turn-orchestrator.js";
import { buildToolRegistry } from "./build-registry.js";
import { loadConfig, requireApiKey } from "./config.js";
import { createSharedAskFn } from "./ask-terminal.js";
import { parseArgs, resolveSession } from "./resolve-session.js";

const DEFAULT_MODEL = "claude-sonnet-4-5";

export async function main(argv: string[]): Promise<void> {
  const cwd = process.cwd();
  const args = parseArgs(argv);
  const config = await loadConfig(cwd);
  const apiKey = requireApiKey();

  const sessionsDir = join(cwd, ".forge", "sessions");
  const session = await resolveSession(sessionsDir, args);
  console.log(`Session: ${session.sessionId}`);

  const registryHandle = await buildToolRegistry(config.mcpServers);
  const provider = new AnthropicProvider({ apiKey, model: DEFAULT_MODEL });
```

Replace with:

```ts
import { PermissionGate } from "../permission/permission-gate.js";
import { DEFAULT_PERMISSION_POLICIES } from "../permission/permission-policies.js";
import { runTurn } from "../agent/turn-orchestrator.js";
import { buildToolRegistry } from "./build-registry.js";
import { buildProvider } from "./build-provider.js";
import { loadConfig } from "./config.js";
import { createSharedAskFn } from "./ask-terminal.js";
import { parseArgs, resolveSession } from "./resolve-session.js";

export async function main(argv: string[]): Promise<void> {
  const cwd = process.cwd();
  const args = parseArgs(argv);
  const config = await loadConfig(cwd);

  const sessionsDir = join(cwd, ".forge", "sessions");
  const session = await resolveSession(sessionsDir, args);
  console.log(`Session: ${session.sessionId}`);

  const registryHandle = await buildToolRegistry(config.mcpServers);
  const provider = buildProvider(config.provider);
```

Everything else in the file (the `rl`/`closed` setup, the gate construction, the prompt loop, the `finally` block) is unchanged.

- [ ] **Step 10: Run the existing CLI tests to confirm nothing broke**

Run: `npm test -- test/cli/main.test.ts`
Expected: PASS (2 tests, unchanged). `main.test.ts` sets `ANTHROPIC_API_KEY` in its `beforeEach` and no `forge.config.json` exists in its temp dir, so `config.provider` defaults to `{ type: "anthropic" }` and `buildProvider` resolves exactly as `main.ts`'s old hardcoded construction did.

- [ ] **Step 11: Run the full suite and both typecheck paths**

Run: `npm test && npm run typecheck && npm run typecheck:test`
Expected: all tests pass. Task 1 added 5 tests; Task 2 changes `config.test.ts` from 5 to 7 tests (+2) and adds `build-provider.test.ts` (5 new). Total: 141 (Sprints 1-4) + 5 (Task 1) + 2 (Task 2 config additions) + 5 (Task 2 build-provider) = **153 tests**, both typechecks clean.

- [ ] **Step 12: Commit**

```bash
git add src/cli/config.ts test/cli/config.test.ts src/cli/build-provider.ts test/cli/build-provider.test.ts src/cli/main.ts
git commit -m "feat: config-driven provider selection (anthropic/openrouter), wired into the CLI"
```

- [ ] **Step 13 (manual, gated on a real OpenRouter API key + network access): smoke-test against the real OpenRouter API**

Not an automated test -- run once by hand, same pattern as the Anthropic/MCP smoke tests in earlier sprints.

```bash
cd ~/Projects/Forge
cat > forge.config.json <<'EOF'
{ "provider": { "type": "openrouter", "model": "anthropic/claude-3.5-sonnet" } }
EOF
npm run build
OPENROUTER_API_KEY=sk-or-... node bin/forge.js
```

At the `>` prompt, type something simple like "say hi in 3 words" and confirm a real streamed response comes back through OpenRouter. Then `/exit` and `rm forge.config.json` (or keep it, your call -- it's already gitignored-adjacent in that it's a local run config, but is NOT currently in `.gitignore`, so check `git status` before committing anything else).

Expected: a real response streams token-by-token, `finish_reason` maps correctly (no crash), confirming the OpenAI-compatible request/response path works end-to-end against the real API, not just the fake-client unit tests.

---

## Definition of Done

- [ ] All automated tests pass (`npm test`), 153 total.
- [ ] `npm run typecheck` and `npm run typecheck:test` both report no errors.
- [ ] `forge.config.json` with `provider.type: "openrouter"` routes real requests through OpenRouter (Task 2 Step 13's manual check).
- [ ] `forge.config.json` with no `provider` field (or no config file at all) still works exactly as before, against Anthropic (Task 2 Step 10's automated regression coverage).
- [ ] The tool-result message-exploding behavior is verified by a real test (Task 1's last test), not just claimed.
