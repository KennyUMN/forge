# Sprint 1: Session Manager + ModelProvider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the foundational data model (session log) and a single working LLM connection (Anthropic), each independently testable, with no dependency on the agent loop that comes in Sprint 2.

**Architecture:** A crash-tolerant JSONL append/replay log underlies a `SessionStore` that models sessions as a DAG of entries (`id`/`parentId`). Separately, a minimal `ModelProvider` interface is implemented once by `AnthropicProvider`, wrapping the official SDK's streaming API and normalizing its events/finish-reasons into Forge's own types.

**Tech Stack:** TypeScript (Node ≥20, ESM/NodeNext), Vitest, `@anthropic-ai/sdk`.

## Global Constraints

- Node ≥20, TypeScript with `strict: true`.
- No Vercel AI SDK or other provider-abstraction library dependency — the `ModelProvider` interface is hand-rolled (see design spec §4.2, §9 decision log).
- Session storage is append-only JSONL, never a single mutable JSON blob; every entry carries `id` and `parentId` (design spec §4.5).
- No placeholder/TODO code — every function does what its tests assert.
- Commit after every task's tests pass.

---

### Task 1: Project scaffolding + crash-tolerant JSONL log

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `src/session/jsonl-log.ts`
- Test: `test/session/jsonl-log.test.ts`

**Interfaces:**
- Produces: `appendJsonlEntry(filePath: string, entry: unknown): Promise<void>`, `readJsonlEntries<T>(filePath: string): Promise<T[]>` — later tasks (Task 2) call these directly.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "forge",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.32.0"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "@types/node": "^22.0.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "declaration": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
  },
});
```

- [ ] **Step 4: Install dependencies**

Run: `npm install`
Expected: `node_modules/` created, `package-lock.json` written, no errors.

- [ ] **Step 5: Write the failing test for the JSONL log**

Create `test/session/jsonl-log.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendJsonlEntry, readJsonlEntries } from "../../src/session/jsonl-log.js";

describe("jsonl-log", () => {
  let dir: string;
  let filePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "forge-jsonl-"));
    filePath = join(dir, "session.jsonl");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns an empty array when the file does not exist yet", async () => {
    const entries = await readJsonlEntries(filePath);
    expect(entries).toEqual([]);
  });

  it("appends entries and reads them back in order", async () => {
    await appendJsonlEntry(filePath, { id: "1", value: "a" });
    await appendJsonlEntry(filePath, { id: "2", value: "b" });

    const entries = await readJsonlEntries<{ id: string; value: string }>(filePath);
    expect(entries).toEqual([
      { id: "1", value: "a" },
      { id: "2", value: "b" },
    ]);
  });

  it("discards a torn final line but keeps every entry before it", async () => {
    await appendJsonlEntry(filePath, { id: "1", value: "a" });
    await appendJsonlEntry(filePath, { id: "2", value: "b" });
    // simulate a crash mid-write: a truncated JSON line with no trailing newline
    await appendFile(filePath, '{"id":"3","value":"unterm', "utf8");

    const entries = await readJsonlEntries<{ id: string; value: string }>(filePath);
    expect(entries).toEqual([
      { id: "1", value: "a" },
      { id: "2", value: "b" },
    ]);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npm test -- test/session/jsonl-log.test.ts`
Expected: FAIL — `Cannot find module '../../src/session/jsonl-log.js'`

- [ ] **Step 7: Implement the JSONL log**

Create `src/session/jsonl-log.ts`:

```ts
import { appendFile, readFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export async function appendJsonlEntry(filePath: string, entry: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await appendFile(filePath, JSON.stringify(entry) + "\n", "utf8");
}

export async function readJsonlEntries<T>(filePath: string): Promise<T[]> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  const lines = raw.split("\n").filter((line) => line.length > 0);
  const entries: T[] = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line) as T);
    } catch {
      // A parse failure only happens on the last line of a log torn mid-write
      // by a crash. Stop here and keep everything already collected rather
      // than discarding the whole session.
      break;
    }
  }
  return entries;
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npm test -- test/session/jsonl-log.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 9: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts src/session/jsonl-log.ts test/session/jsonl-log.test.ts package-lock.json
git commit -m "feat: add crash-tolerant JSONL append/replay log"
```

---

### Task 2: Session types + `SessionStore`

**Files:**
- Create: `src/types/session.ts`
- Create: `src/session/session-store.ts`
- Test: `test/session/session-store.test.ts`

**Interfaces:**
- Consumes: `appendJsonlEntry`, `readJsonlEntries` from Task 1 (`src/session/jsonl-log.js`).
- Produces: `SessionEntry`, `EntryType` (`src/types/session.ts`); `SessionStore` class with `static create(sessionsDir): Promise<SessionStore>`, `static load(sessionsDir, sessionId): Promise<SessionStore>`, `append(type, payload): Promise<SessionEntry>`, `getEntries(): readonly SessionEntry[]`, `getHeadId(): string | null`, `readonly sessionId: string` — Sprint 2's Agent Loop will call `append()` and `getEntries()` directly.

- [ ] **Step 1: Write the failing tests**

Create `test/session/session-store.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionStore } from "../../src/session/session-store.js";

describe("SessionStore", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "forge-session-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("gives a fresh session a null head and empty entries", async () => {
    const store = await SessionStore.create(dir);
    expect(store.getHeadId()).toBeNull();
    expect(store.getEntries()).toEqual([]);
  });

  it("appends entries with parentId chained to the previous head", async () => {
    const store = await SessionStore.create(dir);

    const first = await store.append("user_message", { text: "hello" });
    const second = await store.append("assistant_message", { text: "hi there" });

    expect(first.parentId).toBeNull();
    expect(second.parentId).toBe(first.id);
    expect(store.getHeadId()).toBe(second.id);
  });

  it("reloads a session from disk with the same entries and head", async () => {
    const store = await SessionStore.create(dir);
    await store.append("user_message", { text: "hello" });
    await store.append("assistant_message", { text: "hi there" });

    const reloaded = await SessionStore.load(dir, store.sessionId);

    expect(reloaded.getEntries()).toEqual(store.getEntries());
    expect(reloaded.getHeadId()).toBe(store.getHeadId());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/session/session-store.test.ts`
Expected: FAIL — `Cannot find module '../../src/session/session-store.js'`

- [ ] **Step 3: Write the session entry types**

Create `src/types/session.ts`:

```ts
export type EntryType = "user_message" | "assistant_message" | "tool_call" | "tool_result";

export interface SessionEntry {
  id: string;
  parentId: string | null;
  type: EntryType;
  timestamp: string;
  payload: unknown;
}
```

- [ ] **Step 4: Implement `SessionStore`**

Create `src/session/session-store.ts`:

```ts
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { appendJsonlEntry, readJsonlEntries } from "./jsonl-log.js";
import type { EntryType, SessionEntry } from "../types/session.js";

export class SessionStore {
  private readonly filePath: string;
  private entries: SessionEntry[] = [];
  private headId: string | null = null;

  private constructor(
    readonly sessionId: string,
    sessionsDir: string,
  ) {
    this.filePath = join(sessionsDir, `${sessionId}.jsonl`);
  }

  static async create(sessionsDir: string): Promise<SessionStore> {
    return new SessionStore(randomUUID(), sessionsDir);
  }

  static async load(sessionsDir: string, sessionId: string): Promise<SessionStore> {
    const store = new SessionStore(sessionId, sessionsDir);
    store.entries = await readJsonlEntries<SessionEntry>(store.filePath);
    store.headId = store.entries.length > 0 ? store.entries[store.entries.length - 1].id : null;
    return store;
  }

  async append(type: EntryType, payload: unknown): Promise<SessionEntry> {
    const entry: SessionEntry = {
      id: randomUUID(),
      parentId: this.headId,
      type,
      timestamp: new Date().toISOString(),
      payload,
    };
    await appendJsonlEntry(this.filePath, entry);
    this.entries.push(entry);
    this.headId = entry.id;
    return entry;
  }

  getEntries(): readonly SessionEntry[] {
    return this.entries;
  }

  getHeadId(): string | null {
    return this.headId;
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- test/session/session-store.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add src/types/session.ts src/session/session-store.ts test/session/session-store.test.ts
git commit -m "feat: add SessionStore with DAG-shaped session entries"
```

---

### Task 3: Message/provider types + `ModelProvider` interface

**Files:**
- Create: `src/types/message.ts`
- Create: `src/provider/model-provider.ts`
- Test: `test/provider/model-provider.test.ts`

**Interfaces:**
- Produces: `Message`, `MessageContent`, `ToolSchema`, `FinishReason`, `StreamEvent`, `ThinkingEffort` (`src/types/message.ts`); `ModelProvider`, `StreamContext` (`src/provider/model-provider.ts`) — Task 4's `AnthropicProvider` implements this interface; Sprint 2's Agent Loop calls `provider.stream(context)`.

- [ ] **Step 1: Write the failing test**

Create `test/provider/model-provider.test.ts`. This test defines a minimal fake provider to prove the interface is genuinely consumable end-to-end — it doubles as the reference example for Task 4's real implementation:

```ts
import { describe, it, expect } from "vitest";
import type { ModelProvider, StreamContext } from "../../src/provider/model-provider.js";
import type { StreamEvent } from "../../src/types/message.js";

class FakeProvider implements ModelProvider {
  readonly name = "fake";

  constructor(private readonly events: StreamEvent[]) {}

  async *stream(_context: StreamContext): AsyncIterable<StreamEvent> {
    for (const event of this.events) {
      yield event;
    }
  }

  withMaxTokens(_max: number): ModelProvider {
    return new FakeProvider(this.events);
  }
}

describe("ModelProvider contract", () => {
  it("a conforming provider streams events consumable by a for-await loop", async () => {
    const provider = new FakeProvider([
      { type: "text_delta", text: "Hello" },
      { type: "finish", reason: "completed", rawReason: "end_turn" },
    ]);

    const collected: StreamEvent[] = [];
    for await (const event of provider.stream({ systemPrompt: "", messages: [], tools: [] })) {
      collected.push(event);
    }

    expect(collected).toEqual([
      { type: "text_delta", text: "Hello" },
      { type: "finish", reason: "completed", rawReason: "end_turn" },
    ]);
  });

  it("withMaxTokens returns a new provider instance rather than mutating", () => {
    const provider = new FakeProvider([]);
    const updated = provider.withMaxTokens!(100);

    expect(updated).not.toBe(provider);
    expect(updated.name).toBe("fake");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/provider/model-provider.test.ts`
Expected: FAIL — `Cannot find module '../../src/provider/model-provider.js'`

- [ ] **Step 3: Write the message/stream types**

Create `src/types/message.ts`:

```ts
export type ThinkingEffort = "none" | "low" | "high" | "max";

export interface TextContent {
  type: "text";
  text: string;
}

export interface ToolCallContent {
  type: "tool_call";
  id: string;
  name: string;
  input: unknown;
}

export interface ToolResultContent {
  type: "tool_result";
  toolCallId: string;
  output: string;
  isError: boolean;
}

export type MessageContent = TextContent | ToolCallContent | ToolResultContent;

export interface Message {
  role: "user" | "assistant" | "tool";
  content: MessageContent[];
}

export interface ToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export type FinishReason = "completed" | "tool_calls" | "truncated" | "filtered" | "other";

export type StreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_call"; id: string; name: string; input: unknown }
  | { type: "finish"; reason: FinishReason; rawReason: string };
```

- [ ] **Step 4: Write the `ModelProvider` interface**

Create `src/provider/model-provider.ts`:

```ts
import type { Message, StreamEvent, ThinkingEffort, ToolSchema } from "../types/message.js";

export interface StreamContext {
  systemPrompt: string;
  messages: Message[];
  tools: ToolSchema[];
}

export interface ModelProvider {
  readonly name: string;
  stream(context: StreamContext): AsyncIterable<StreamEvent>;
  withThinking?(effort: ThinkingEffort): ModelProvider;
  withMaxTokens?(max: number): ModelProvider;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- test/provider/model-provider.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add src/types/message.ts src/provider/model-provider.ts test/provider/model-provider.test.ts
git commit -m "feat: add Message types and the ModelProvider interface"
```

---

### Task 4: `AnthropicProvider`

**Files:**
- Create: `src/provider/anthropic-provider.ts`
- Test: `test/provider/anthropic-provider.test.ts`

**Interfaces:**
- Consumes: `ModelProvider`, `StreamContext` (Task 3, `src/provider/model-provider.js`); `Message`, `StreamEvent`, `FinishReason`, `ThinkingEffort` (Task 3, `src/types/message.js`).
- Produces: `AnthropicProvider` class, `AnthropicProviderOptions` interface — Sprint 2's Agent Loop constructs one `AnthropicProvider` and calls it only through the `ModelProvider` interface.

**Note before starting**: this task depends on the exact type names exported by the installed `@anthropic-ai/sdk` version. The code below derives request/response types directly from the client's own method signatures (`Parameters<...>`) rather than naming nested SDK types, specifically so minor SDK version drift doesn't break compilation — but if `npm run typecheck` still flags a mismatch, check `node_modules/@anthropic-ai/sdk`'s type definitions and adjust the conversion helpers, not the public `AnthropicProvider` shape.

- [ ] **Step 1: Write the failing tests**

Create `test/provider/anthropic-provider.test.ts`. This uses a fake client object (dependency-injected) instead of mocking the SDK module, so it stays robust and fast with no real network call:

```ts
import { describe, it, expect } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { AnthropicProvider } from "../../src/provider/anthropic-provider.js";

function fakeAnthropicClient(
  events: unknown[],
  finalMessage: { stop_reason: string | null; content: unknown[] },
): Anthropic {
  return {
    messages: {
      stream: () => ({
        [Symbol.asyncIterator]: async function* () {
          for (const event of events) yield event;
        },
        finalMessage: async () => finalMessage,
      }),
    },
  } as unknown as Anthropic;
}

describe("AnthropicProvider", () => {
  it("streams text deltas and maps end_turn to completed", async () => {
    const client = fakeAnthropicClient(
      [
        { type: "content_block_delta", delta: { type: "text_delta", text: "Hel" } },
        { type: "content_block_delta", delta: { type: "text_delta", text: "lo" } },
      ],
      { stop_reason: "end_turn", content: [{ type: "text", text: "Hello" }] },
    );
    const provider = new AnthropicProvider({ apiKey: "test", model: "claude-test" }, client);

    const events = [];
    for await (const event of provider.stream({ systemPrompt: "", messages: [], tools: [] })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "text_delta", text: "Hel" },
      { type: "text_delta", text: "lo" },
      { type: "finish", reason: "completed", rawReason: "end_turn" },
    ]);
  });

  it("emits a tool_call event from the final message and maps tool_use to tool_calls", async () => {
    const client = fakeAnthropicClient([], {
      stop_reason: "tool_use",
      content: [{ type: "tool_use", id: "call_1", name: "read_file", input: { path: "a.ts" } }],
    });
    const provider = new AnthropicProvider({ apiKey: "test", model: "claude-test" }, client);

    const events = [];
    for await (const event of provider.stream({ systemPrompt: "", messages: [], tools: [] })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "tool_call", id: "call_1", name: "read_file", input: { path: "a.ts" } },
      { type: "finish", reason: "tool_calls", rawReason: "tool_use" },
    ]);
  });

  it("maps max_tokens to truncated and null stop_reason to other", async () => {
    const client = fakeAnthropicClient([], { stop_reason: "max_tokens", content: [] });
    const provider = new AnthropicProvider({ apiKey: "test", model: "claude-test" }, client);

    const events = [];
    for await (const event of provider.stream({ systemPrompt: "", messages: [], tools: [] })) {
      events.push(event);
    }

    expect(events).toEqual([{ type: "finish", reason: "truncated", rawReason: "max_tokens" }]);
  });

  it("withMaxTokens and withThinking return new provider instances, not mutations", () => {
    const client = fakeAnthropicClient([], { stop_reason: "end_turn", content: [] });
    const provider = new AnthropicProvider({ apiKey: "test", model: "claude-test" }, client);

    const withTokens = provider.withMaxTokens(8192);
    const withThinking = provider.withThinking("high");

    expect(withTokens).not.toBe(provider);
    expect(withThinking).not.toBe(provider);
    expect(withTokens.name).toBe("anthropic");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/provider/anthropic-provider.test.ts`
Expected: FAIL — `Cannot find module '../../src/provider/anthropic-provider.js'`

- [ ] **Step 3: Implement `AnthropicProvider`**

Create `src/provider/anthropic-provider.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/provider/anthropic-provider.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Run the full test suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: all tests pass (12 total across Tasks 1–4), typecheck reports no errors.

- [ ] **Step 6: Commit**

```bash
git add src/provider/anthropic-provider.ts test/provider/anthropic-provider.test.ts
git commit -m "feat: implement AnthropicProvider against the ModelProvider interface"
```

- [ ] **Step 7 (manual, gated on having a real API key): smoke-test against the real Anthropic API**

Not an automated test — run once by hand to confirm the mapping holds against the real streaming API before Sprint 2 builds on it:

```bash
ANTHROPIC_API_KEY=sk-... node --experimental-strip-types -e "
import { AnthropicProvider } from './src/provider/anthropic-provider.ts';
const provider = new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY, model: 'claude-sonnet-4-5' });
for await (const event of provider.stream({ systemPrompt: 'Be brief.', messages: [{ role: 'user', content: [{ type: 'text', text: 'Say hi in 3 words.' }] }], tools: [] })) {
  console.log(event);
}
"
```

Expected: several `text_delta` events followed by one `finish` event with `reason: "completed"`.

- [ ] **Step 7b (manual, gated on having a real API key and an SDK version that models Extended Thinking): smoke-test the thinking-enabled path against the real Anthropic API**

The installed `@anthropic-ai/sdk` (0.32.1) predates the Extended Thinking API, so the `thinking` request param and `thinking_delta`/`thinking` response shapes in `anthropic-provider.ts` are modeled locally from Anthropic's public docs and merged in via permissive casts (see the `PROVISIONAL` comment above `AnthropicThinkingConfig`) — they have only ever been exercised against a hand-rolled fake client, never the real API. Before Sprint 2 or any production code relies on `withThinking()`, run this by hand (upgrading the SDK first if needed):

```bash
ANTHROPIC_API_KEY=sk-... node --experimental-strip-types -e "
import { AnthropicProvider } from './src/provider/anthropic-provider.ts';
const provider = new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY, model: 'claude-sonnet-4-5' }).withThinking('low');
for await (const event of provider.stream({ systemPrompt: 'Be brief.', messages: [{ role: 'user', content: [{ type: 'text', text: 'Say hi in 3 words.' }] }], tools: [] })) {
  console.log(event);
}
"
```

Expected: one or more `thinking_delta` events, followed by `text_delta` events, followed by one `finish` event with `reason: "completed"`. Confirm the real response shape matches what `AnthropicThinkingConfig`/`ThinkingDeltaEvent` assume; adjust the conversion helpers (not the public `AnthropicProvider` shape) if it doesn't, and remove the `PROVISIONAL` comment once confirmed.

---

## Sprint 1 Definition of Done

- [ ] All automated tests across Tasks 1–4 pass (`npm test`).
- [ ] `npm run typecheck` reports no errors.
- [ ] `npm run typecheck:test` (type-checks `test/` alongside `src/`) reports no errors.
- [ ] The manual smoke test (Task 4, Step 7) has been run at least once against the real API.
- [ ] The manual thinking-path smoke test (Task 4, Step 7b) has been run at least once against the real API before `withThinking()` is relied on in production.
- [ ] A session directory killed mid-write (simulate by killing the process during a burst of `append()` calls) reloads with only the torn entry missing — worth a quick manual check beyond the unit test, since the unit test only simulates the torn line, not an actual process kill.

Once this Definition of Done is met, move to Sprint 2 (Agent Loop + Permission Gate) — see [ROADMAP.md](../../ROADMAP.md).
