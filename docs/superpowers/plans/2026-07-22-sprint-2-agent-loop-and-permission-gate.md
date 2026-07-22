# Sprint 2: Agent Loop + Permission Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a working conversational agent loop that requests tool use and gates every call through a policy chain, using Sprint 1's `SessionStore` and `ModelProvider`.

**Architecture:** The loop is three separable, independently testable units — Step Executor (one model round-trip), Tool Dispatcher (routes tool calls through permission + execution), and Turn Orchestrator (the outer loop tying them together with the session log) — explicitly avoiding the single-giant-function anti-pattern found in nearly every reference repo studied for the kernel design. A `SessionEntry[] -> Message[]` bridge (flagged as Sprint 2's job by Sprint 1's final review) coalesces the durable session log into the shape `ModelProvider` expects. The Permission Gate is a composable ordered chain of policy objects, not a single check, with a doom-loop guard that overrides any policy on 3 consecutive identical tool calls.

**Tech Stack:** TypeScript (Node >=20, ESM/NodeNext), Vitest — same as Sprint 1, no new dependencies.

## Global Constraints

- Node >=20, TypeScript with `strict: true`.
- No new runtime dependencies — this sprint is pure TypeScript logic on top of Sprint 1's types.
- Immutable data patterns: functions return new arrays/objects rather than mutating their inputs in place (e.g. `dispatchToolCalls` returns an updated `callHistory` rather than mutating the one it's given).
- The Agent Loop stays decomposed into Step Executor / Tool Dispatcher / Turn Orchestrator as separate files — do not collapse them into one function, even under time pressure.
- The Permission Gate is a chain of independent `PermissionPolicy` objects evaluated in order (first non-`undefined` decision wins) — never a single hardcoded if-chain.
- Doom-loop guard: if the same tool name + identical (deep-equal via JSON) input would be called 3 times consecutively, force an `ask` decision regardless of what the policy chain would otherwise return.
- Truncated model responses: any tool calls from a step whose `finishReason` is `"truncated"` must never be executed — synthesize an error `ToolResult` for each instead.
- No placeholder/TODO code — every function does what its tests assert.
- Commit after every task's tests pass.

## Real Sprint 1 Interfaces This Sprint Builds On

These are the actual signatures on `master` right now (not the original plan draft — Sprint 1's implementation added `thinking_delta` and narrowed some return types during review):

```ts
// src/types/message.ts
export type ThinkingEffort = "none" | "low" | "high" | "max";
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

// src/types/session.ts
export type EntryType = "user_message" | "assistant_message" | "tool_call" | "tool_result";
export interface SessionEntry { id: string; parentId: string | null; type: EntryType; timestamp: string; payload: unknown; }

// src/provider/model-provider.ts
export interface StreamContext { systemPrompt: string; messages: Message[]; tools: ToolSchema[]; }
export interface ModelProvider {
  readonly name: string;
  stream(context: StreamContext): AsyncIterable<StreamEvent>;
  withThinking?(effort: ThinkingEffort): ModelProvider;
  withMaxTokens?(max: number): ModelProvider;
}

// src/session/session-store.ts
export class SessionStore {
  readonly sessionId: string;
  static create(sessionsDir: string): Promise<SessionStore>;
  static load(sessionsDir: string, sessionId: string): Promise<SessionStore>;
  append(type: EntryType, payload: unknown): Promise<SessionEntry>;
  getEntries(): readonly SessionEntry[];
  getHeadId(): string | null;
}
```

---

### Task 1: Shared tool-call types + Tool contract

**Files:**
- Create: `src/types/tool-call.ts`
- Create: `src/tool/tool.ts`
- Test: `test/tool/tool.test.ts`

**Interfaces:**
- Produces: `ToolCallRequest { id, name, input }`, `ToolResult { toolCallId, output, isError }` (`src/types/tool-call.ts`); `ToolExecutionContext { cwd }`, `ToolExecutionResult { output, isError }`, `Tool { name, description, parameters, execute(input, context) }` (`src/tool/tool.ts`) — every later task in this sprint imports these.

- [ ] **Step 1: Write the failing test**

Create `test/tool/tool.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { Tool, ToolExecutionContext } from "../../src/tool/tool.js";

const echoTool: Tool = {
  name: "echo",
  description: "Echoes the input back",
  parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
  async execute(input, _context) {
    const { text } = input as { text: string };
    return { output: text, isError: false };
  },
};

describe("Tool contract", () => {
  it("a conforming tool can be executed with input and context", async () => {
    const context: ToolExecutionContext = { cwd: "/tmp" };
    const result = await echoTool.execute({ text: "hello" }, context);
    expect(result).toEqual({ output: "hello", isError: false });
  });

  it("a tool can report an error result without throwing", async () => {
    const failingTool: Tool = {
      name: "fail",
      description: "Always fails",
      parameters: {},
      async execute() {
        return { output: "something went wrong", isError: true };
      },
    };
    const result = await failingTool.execute({}, { cwd: "/tmp" });
    expect(result.isError).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/tool/tool.test.ts`
Expected: FAIL — `Cannot find module '../../src/tool/tool.js'`

- [ ] **Step 3: Create the shared tool-call types**

Create `src/types/tool-call.ts`:

```ts
export interface ToolCallRequest {
  id: string;
  name: string;
  input: unknown;
}

export interface ToolResult {
  toolCallId: string;
  output: string;
  isError: boolean;
}
```

- [ ] **Step 4: Create the Tool contract**

Create `src/tool/tool.ts`:

```ts
export interface ToolExecutionContext {
  cwd: string;
}

export interface ToolExecutionResult {
  output: string;
  isError: boolean;
}

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(input: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult>;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- test/tool/tool.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add src/types/tool-call.ts src/tool/tool.ts test/tool/tool.test.ts
git commit -m "feat: add ToolCallRequest/ToolResult types and the Tool contract"
```

---

### Task 2: Permission Gate + doom-loop guard

**Files:**
- Create: `src/permission/permission-policies.ts`
- Create: `src/permission/permission-gate.ts`
- Create: `src/agent/doom-loop.ts`
- Test: `test/permission/permission-policies.test.ts`
- Test: `test/permission/permission-gate.test.ts`
- Test: `test/agent/doom-loop.test.ts`

**Interfaces:**
- Consumes: `ToolCallRequest` (Task 1, `src/types/tool-call.js`).
- Produces: `PermissionDecision`, `PermissionPolicy`, `autoAllowReadOnlyPolicy`, `askBeforeWriteOrBashPolicy`, `DEFAULT_PERMISSION_POLICIES` (`src/permission/permission-policies.ts`); `PermissionGate` class with `evaluate(call, options?): Promise<{decision, reason?}>`, `AskFn`, `EvaluateOptions { forceAsk? }` (`src/permission/permission-gate.ts`); `isDoomLoop(history, call): boolean`, `DOOM_LOOP_THRESHOLD` (`src/agent/doom-loop.ts`) — Task 4's Tool Dispatcher uses all three.

- [ ] **Step 1: Write the failing tests**

Create `test/permission/permission-policies.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { autoAllowReadOnlyPolicy, askBeforeWriteOrBashPolicy } from "../../src/permission/permission-policies.js";

describe("autoAllowReadOnlyPolicy", () => {
  it("allows read_file", () => {
    expect(autoAllowReadOnlyPolicy.evaluate({ id: "1", name: "read_file", input: {} })).toBe("allow");
  });

  it("does not decide on bash", () => {
    expect(autoAllowReadOnlyPolicy.evaluate({ id: "1", name: "bash", input: {} })).toBeUndefined();
  });
});

describe("askBeforeWriteOrBashPolicy", () => {
  it("asks before bash", () => {
    expect(askBeforeWriteOrBashPolicy.evaluate({ id: "1", name: "bash", input: {} })).toBe("ask");
  });

  it("asks before write_file", () => {
    expect(askBeforeWriteOrBashPolicy.evaluate({ id: "1", name: "write_file", input: {} })).toBe("ask");
  });

  it("does not decide on read_file", () => {
    expect(askBeforeWriteOrBashPolicy.evaluate({ id: "1", name: "read_file", input: {} })).toBeUndefined();
  });
});
```

Create `test/permission/permission-gate.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { PermissionGate } from "../../src/permission/permission-gate.js";
import type { PermissionPolicy } from "../../src/permission/permission-policies.js";

const call = { id: "1", name: "bash", input: { command: "ls" } };

describe("PermissionGate", () => {
  it("allows a call when the first matching policy allows it", async () => {
    const policy: PermissionPolicy = { name: "always-allow", evaluate: () => "allow" };
    const ask = vi.fn();
    const gate = new PermissionGate([policy], ask);

    const result = await gate.evaluate(call);

    expect(result).toEqual({ decision: "allow" });
    expect(ask).not.toHaveBeenCalled();
  });

  it("denies a call when the first matching policy denies it", async () => {
    const policy: PermissionPolicy = { name: "always-deny", evaluate: () => "deny" };
    const gate = new PermissionGate([policy], vi.fn());

    const result = await gate.evaluate(call);

    expect(result.decision).toBe("deny");
    expect(result.reason).toContain("always-deny");
  });

  it("stops at the first policy that returns a decision, ignoring later policies", async () => {
    const first: PermissionPolicy = { name: "first", evaluate: () => "allow" };
    const second: PermissionPolicy = { name: "second", evaluate: () => "deny" };
    const gate = new PermissionGate([first, second], vi.fn());

    const result = await gate.evaluate(call);

    expect(result.decision).toBe("allow");
  });

  it("skips a policy that returns undefined and consults the next one", async () => {
    const first: PermissionPolicy = { name: "first", evaluate: () => undefined };
    const second: PermissionPolicy = { name: "second", evaluate: () => "allow" };
    const gate = new PermissionGate([first, second], vi.fn());

    const result = await gate.evaluate(call);

    expect(result.decision).toBe("allow");
  });

  it("asks and allows when a policy says ask and the ask function approves", async () => {
    const policy: PermissionPolicy = { name: "ask-policy", evaluate: () => "ask" };
    const ask = vi.fn().mockResolvedValue(true);
    const gate = new PermissionGate([policy], ask);

    const result = await gate.evaluate(call);

    expect(ask).toHaveBeenCalledWith(call);
    expect(result).toEqual({ decision: "allow" });
  });

  it("asks and denies when the ask function rejects", async () => {
    const policy: PermissionPolicy = { name: "ask-policy", evaluate: () => "ask" };
    const ask = vi.fn().mockResolvedValue(false);
    const gate = new PermissionGate([policy], ask);

    const result = await gate.evaluate(call);

    expect(result.decision).toBe("deny");
    expect(result.reason).toContain("denied by user");
  });

  it("defaults to ask when no policy matches", async () => {
    const policy: PermissionPolicy = { name: "no-op", evaluate: () => undefined };
    const ask = vi.fn().mockResolvedValue(true);
    const gate = new PermissionGate([policy], ask);

    const result = await gate.evaluate(call);

    expect(ask).toHaveBeenCalled();
    expect(result.decision).toBe("allow");
  });

  it("forceAsk bypasses every policy and asks directly", async () => {
    const policy: PermissionPolicy = { name: "always-allow", evaluate: () => "allow" };
    const ask = vi.fn().mockResolvedValue(false);
    const gate = new PermissionGate([policy], ask);

    const result = await gate.evaluate(call, { forceAsk: true });

    expect(ask).toHaveBeenCalled();
    expect(result.decision).toBe("deny");
    expect(result.reason).toContain("doom-loop");
  });
});
```

Create `test/agent/doom-loop.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isDoomLoop } from "../../src/agent/doom-loop.js";

const call = (input: unknown) => ({ id: "x", name: "bash", input });

describe("isDoomLoop", () => {
  it("returns false when history is empty", () => {
    expect(isDoomLoop([], call({ command: "ls" }))).toBe(false);
  });

  it("returns false when fewer than threshold-1 prior identical calls exist", () => {
    const history = [call({ command: "ls" })];
    expect(isDoomLoop(history, call({ command: "ls" }))).toBe(false);
  });

  it("returns true when the same call would be the 3rd consecutive identical call", () => {
    const history = [call({ command: "ls" }), call({ command: "ls" })];
    expect(isDoomLoop(history, call({ command: "ls" }))).toBe(true);
  });

  it("returns false when the two most recent calls differ in input", () => {
    const history = [call({ command: "ls" }), call({ command: "pwd" })];
    expect(isDoomLoop(history, call({ command: "ls" }))).toBe(false);
  });

  it("returns false when the two most recent calls have the same input but a different tool name", () => {
    const history = [
      { id: "a", name: "bash", input: { command: "ls" } },
      { id: "b", name: "grep", input: { command: "ls" } },
    ];
    expect(isDoomLoop(history, call({ command: "ls" }))).toBe(false);
  });

  it("does not mutate the history array", () => {
    const history = [call({ command: "ls" }), call({ command: "ls" })];
    const snapshot = JSON.stringify(history);
    isDoomLoop(history, call({ command: "ls" }));
    expect(JSON.stringify(history)).toBe(snapshot);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/permission/permission-policies.test.ts test/permission/permission-gate.test.ts test/agent/doom-loop.test.ts`
Expected: FAIL — modules not found

- [ ] **Step 3: Implement the default permission policies**

Create `src/permission/permission-policies.ts`:

```ts
import type { ToolCallRequest } from "../types/tool-call.js";

export type PermissionDecision = "allow" | "deny" | "ask";

export interface PermissionPolicy {
  name: string;
  evaluate(call: ToolCallRequest): PermissionDecision | undefined;
}

// These names match the built-in tools Sprint 3 will register (design spec
// section 4.6): read_file/grep/glob are read-only, write_file/edit_file/bash
// can change state or run arbitrary commands.
const READ_ONLY_TOOL_NAMES = new Set(["read_file", "grep", "glob"]);
const APPROVAL_REQUIRED_TOOL_NAMES = new Set(["write_file", "edit_file", "bash"]);

export const autoAllowReadOnlyPolicy: PermissionPolicy = {
  name: "auto-allow-read-only",
  evaluate(call) {
    return READ_ONLY_TOOL_NAMES.has(call.name) ? "allow" : undefined;
  },
};

export const askBeforeWriteOrBashPolicy: PermissionPolicy = {
  name: "ask-before-write-or-bash",
  evaluate(call) {
    return APPROVAL_REQUIRED_TOOL_NAMES.has(call.name) ? "ask" : undefined;
  },
};

export const DEFAULT_PERMISSION_POLICIES: PermissionPolicy[] = [autoAllowReadOnlyPolicy, askBeforeWriteOrBashPolicy];
```

- [ ] **Step 4: Implement the Permission Gate**

Create `src/permission/permission-gate.ts`:

```ts
import type { ToolCallRequest } from "../types/tool-call.js";
import type { PermissionPolicy } from "./permission-policies.js";

export interface PermissionResult {
  decision: "allow" | "deny";
  reason?: string;
}

export type AskFn = (call: ToolCallRequest) => Promise<boolean>;

export interface EvaluateOptions {
  forceAsk?: boolean;
}

export class PermissionGate {
  constructor(
    private readonly policies: PermissionPolicy[],
    private readonly ask: AskFn,
  ) {}

  async evaluate(call: ToolCallRequest, options: EvaluateOptions = {}): Promise<PermissionResult> {
    if (!options.forceAsk) {
      for (const policy of this.policies) {
        const result = policy.evaluate(call);
        if (result === "allow") return { decision: "allow" };
        if (result === "deny") return { decision: "deny", reason: `denied by policy "${policy.name}"` };
        if (result === "ask") return this.resolveAsk(call, `policy "${policy.name}" requires approval`);
      }
    }
    const reason = options.forceAsk
      ? "repeated identical tool call (doom-loop guard)"
      : "no policy matched (default: ask)";
    return this.resolveAsk(call, reason);
  }

  private async resolveAsk(call: ToolCallRequest, promptReason: string): Promise<PermissionResult> {
    const approved = await this.ask(call);
    return approved ? { decision: "allow" } : { decision: "deny", reason: `denied by user (${promptReason})` };
  }
}
```

- [ ] **Step 5: Implement the doom-loop guard**

Create `src/agent/doom-loop.ts`:

```ts
import type { ToolCallRequest } from "../types/tool-call.js";

export const DOOM_LOOP_THRESHOLD = 3;

function serializeCall(call: ToolCallRequest): string {
  return `${call.name}:${JSON.stringify(call.input)}`;
}

// Returns true when `call` would be the Nth consecutive identical (name +
// input) tool call, per DOOM_LOOP_THRESHOLD, based on the calls already
// recorded in `history` (most recent last). Does not mutate history -- the
// caller decides when and whether to record the call.
export function isDoomLoop(history: readonly ToolCallRequest[], call: ToolCallRequest): boolean {
  const requiredPriorRepeats = DOOM_LOOP_THRESHOLD - 1;
  if (history.length < requiredPriorRepeats) return false;

  const recent = history.slice(-requiredPriorRepeats);
  const signature = serializeCall(call);
  return recent.every((entry) => serializeCall(entry) === signature);
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- test/permission/permission-policies.test.ts test/permission/permission-gate.test.ts test/agent/doom-loop.test.ts`
Expected: PASS (5 + 8 + 6 = 19 tests)

- [ ] **Step 7: Commit**

```bash
git add src/permission/permission-policies.ts src/permission/permission-gate.ts src/agent/doom-loop.ts test/permission/permission-policies.test.ts test/permission/permission-gate.test.ts test/agent/doom-loop.test.ts
git commit -m "feat: add PermissionGate policy chain and doom-loop guard"
```

---

### Task 3: Session/Message bridge + Step Executor

**Files:**
- Create: `src/agent/session-bridge.ts`
- Create: `src/agent/step-executor.ts`
- Test: `test/agent/session-bridge.test.ts`
- Test: `test/agent/step-executor.test.ts`

**Interfaces:**
- Consumes: `ToolCallRequest`, `ToolResult` (Task 1, `src/types/tool-call.js`); `SessionEntry` (Sprint 1, `src/types/session.js`); `Message`, `MessageContent`, `StreamEvent`, `FinishReason` (Sprint 1, `src/types/message.js`); `ModelProvider`, `StreamContext` (Sprint 1, `src/provider/model-provider.js`).
- Produces: `sessionEntriesToMessages(entries): Message[]` (`src/agent/session-bridge.ts`); `executeStep(provider, context): Promise<StepResult>`, `StepResult { text, toolCalls, finishReason }` (`src/agent/step-executor.ts`) — Task 4's Turn Orchestrator calls both directly.

- [ ] **Step 1: Write the failing tests**

Create `test/agent/session-bridge.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { sessionEntriesToMessages } from "../../src/agent/session-bridge.js";
import type { SessionEntry } from "../../src/types/session.js";

function entry(partial: Pick<SessionEntry, "type" | "payload">): SessionEntry {
  return { id: "id", parentId: null, timestamp: "2026-01-01T00:00:00.000Z", ...partial };
}

describe("sessionEntriesToMessages", () => {
  it("maps a user_message entry to a user message with text content", () => {
    const entries = [entry({ type: "user_message", payload: { text: "hi" } })];
    expect(sessionEntriesToMessages(entries)).toEqual([{ role: "user", content: [{ type: "text", text: "hi" }] }]);
  });

  it("coalesces an assistant_message followed by tool_call entries into one assistant message", () => {
    const entries: SessionEntry[] = [
      entry({ type: "assistant_message", payload: { text: "let me check" } }),
      entry({ type: "tool_call", payload: { id: "call1", name: "read_file", input: { path: "a.ts" } } }),
    ];

    expect(sessionEntriesToMessages(entries)).toEqual([
      {
        role: "assistant",
        content: [
          { type: "text", text: "let me check" },
          { type: "tool_call", id: "call1", name: "read_file", input: { path: "a.ts" } },
        ],
      },
    ]);
  });

  it("coalesces consecutive tool_result entries into one tool message", () => {
    const entries: SessionEntry[] = [
      entry({ type: "tool_result", payload: { toolCallId: "call1", output: "contents", isError: false } }),
      entry({ type: "tool_result", payload: { toolCallId: "call2", output: "oops", isError: true } }),
    ];

    expect(sessionEntriesToMessages(entries)).toEqual([
      {
        role: "tool",
        content: [
          { type: "tool_result", toolCallId: "call1", output: "contents", isError: false },
          { type: "tool_result", toolCallId: "call2", output: "oops", isError: true },
        ],
      },
    ]);
  });

  it("starts a new message when the role changes, e.g. an assistant tool_call followed by its tool_result", () => {
    const entries: SessionEntry[] = [
      entry({ type: "tool_call", payload: { id: "call1", name: "bash", input: {} } }),
      entry({ type: "tool_result", payload: { toolCallId: "call1", output: "done", isError: false } }),
    ];

    const messages = sessionEntriesToMessages(entries);

    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("assistant");
    expect(messages[1].role).toBe("tool");
  });

  it("does not mutate its input array", () => {
    const entries: SessionEntry[] = [entry({ type: "user_message", payload: { text: "hi" } })];
    const snapshot = JSON.stringify(entries);
    sessionEntriesToMessages(entries);
    expect(JSON.stringify(entries)).toBe(snapshot);
  });
});
```

Create `test/agent/step-executor.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { executeStep } from "../../src/agent/step-executor.js";
import type { ModelProvider, StreamContext } from "../../src/provider/model-provider.js";
import type { StreamEvent } from "../../src/types/message.js";

class FakeProvider implements ModelProvider {
  readonly name = "fake";
  constructor(private readonly events: StreamEvent[]) {}
  async *stream(_context: StreamContext): AsyncIterable<StreamEvent> {
    for (const event of this.events) yield event;
  }
}

const emptyContext: StreamContext = { systemPrompt: "", messages: [], tools: [] };

describe("executeStep", () => {
  it("accumulates text_delta events into the final text", async () => {
    const provider = new FakeProvider([
      { type: "text_delta", text: "Hel" },
      { type: "text_delta", text: "lo" },
      { type: "finish", reason: "completed", rawReason: "end_turn" },
    ]);

    const result = await executeStep(provider, emptyContext);

    expect(result.text).toBe("Hello");
    expect(result.toolCalls).toEqual([]);
    expect(result.finishReason).toBe("completed");
  });

  it("collects tool_call events into toolCalls", async () => {
    const provider = new FakeProvider([
      { type: "tool_call", id: "1", name: "read_file", input: { path: "a.ts" } },
      { type: "tool_call", id: "2", name: "bash", input: { command: "ls" } },
      { type: "finish", reason: "tool_calls", rawReason: "tool_use" },
    ]);

    const result = await executeStep(provider, emptyContext);

    expect(result.toolCalls).toEqual([
      { id: "1", name: "read_file", input: { path: "a.ts" } },
      { id: "2", name: "bash", input: { command: "ls" } },
    ]);
    expect(result.finishReason).toBe("tool_calls");
  });

  it("ignores thinking_delta events", async () => {
    const provider = new FakeProvider([
      { type: "thinking_delta", text: "reasoning..." },
      { type: "text_delta", text: "answer" },
      { type: "finish", reason: "completed", rawReason: "end_turn" },
    ]);

    const result = await executeStep(provider, emptyContext);

    expect(result.text).toBe("answer");
  });

  it("defaults finishReason to 'other' if the stream never yields a finish event", async () => {
    const provider = new FakeProvider([{ type: "text_delta", text: "partial" }]);

    const result = await executeStep(provider, emptyContext);

    expect(result.finishReason).toBe("other");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/agent/session-bridge.test.ts test/agent/step-executor.test.ts`
Expected: FAIL — modules not found

- [ ] **Step 3: Implement the session/message bridge**

Create `src/agent/session-bridge.ts`:

```ts
import type { SessionEntry } from "../types/session.js";
import type { Message, MessageContent } from "../types/message.js";
import type { ToolCallRequest, ToolResult } from "../types/tool-call.js";

// Bridges the durable session log (a flat sequence of typed entries) into the
// Message[] shape a ModelProvider expects. Consecutive entries that belong to
// the same provider-facing turn are coalesced into one Message: an
// assistant-role message accumulates any assistant_message text followed by
// tool_call entries from the same step, and a tool-role message accumulates
// the tool_result entries that follow. This mirrors how providers like
// Anthropic expect tool_use/tool_result blocks grouped within one message per
// role, not as separate messages per entry.
export function sessionEntriesToMessages(entries: readonly SessionEntry[]): Message[] {
  return entries.reduce<Message[]>((messages, entry) => {
    if (entry.type === "user_message") {
      const payload = entry.payload as { text: string };
      return [...messages, { role: "user" as const, content: [{ type: "text" as const, text: payload.text }] }];
    }
    if (entry.type === "assistant_message") {
      const payload = entry.payload as { text: string };
      return mergeInto(messages, "assistant", { type: "text", text: payload.text });
    }
    if (entry.type === "tool_call") {
      const payload = entry.payload as ToolCallRequest;
      return mergeInto(messages, "assistant", {
        type: "tool_call",
        id: payload.id,
        name: payload.name,
        input: payload.input,
      });
    }
    const payload = entry.payload as ToolResult;
    return mergeInto(messages, "tool", {
      type: "tool_result",
      toolCallId: payload.toolCallId,
      output: payload.output,
      isError: payload.isError,
    });
  }, []);
}

function mergeInto(messages: Message[], role: Message["role"], content: MessageContent): Message[] {
  const last = messages[messages.length - 1];
  if (last && last.role === role) {
    return [...messages.slice(0, -1), { role, content: [...last.content, content] }];
  }
  return [...messages, { role, content: [content] }];
}
```

- [ ] **Step 4: Implement the Step Executor**

Create `src/agent/step-executor.ts`:

```ts
import type { ModelProvider, StreamContext } from "../provider/model-provider.js";
import type { FinishReason } from "../types/message.js";
import type { ToolCallRequest } from "../types/tool-call.js";

export interface StepResult {
  text: string;
  toolCalls: ToolCallRequest[];
  finishReason: FinishReason;
}

// Runs exactly one model round-trip: streams the provider's response and
// accumulates it into a single result. Does not dispatch tool calls or touch
// the session log -- that's the Tool Dispatcher's and Turn Orchestrator's
// job, kept separate so each unit is independently testable.
export async function executeStep(provider: ModelProvider, context: StreamContext): Promise<StepResult> {
  let text = "";
  const toolCalls: ToolCallRequest[] = [];
  let finishReason: FinishReason = "other";

  for await (const event of provider.stream(context)) {
    if (event.type === "text_delta") {
      text += event.text;
    } else if (event.type === "tool_call") {
      toolCalls.push({ id: event.id, name: event.name, input: event.input });
    } else if (event.type === "finish") {
      finishReason = event.reason;
    }
    // thinking_delta is intentionally ignored -- not part of Sprint 2's contract.
  }

  return { text, toolCalls, finishReason };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- test/agent/session-bridge.test.ts test/agent/step-executor.test.ts`
Expected: PASS (5 + 4 = 9 tests)

- [ ] **Step 6: Commit**

```bash
git add src/agent/session-bridge.ts src/agent/step-executor.ts test/agent/session-bridge.test.ts test/agent/step-executor.test.ts
git commit -m "feat: add SessionEntry->Message bridge and the Step Executor"
```

---

### Task 4: Tool Dispatcher + Turn Orchestrator (integration)

**Files:**
- Create: `src/agent/tool-dispatcher.ts`
- Create: `src/agent/turn-orchestrator.ts`
- Test: `test/agent/tool-dispatcher.test.ts`
- Test: `test/agent/turn-orchestrator.test.ts`

**Interfaces:**
- Consumes: `Tool`, `ToolExecutionContext` (Task 1, `src/tool/tool.js`); `PermissionGate` (Task 2, `src/permission/permission-gate.js`); `isDoomLoop` (Task 2, `src/agent/doom-loop.js`); `ToolCallRequest`, `ToolResult` (Task 1, `src/types/tool-call.js`); `sessionEntriesToMessages`, `executeStep`, `StepResult` (Task 3); `SessionStore` (Sprint 1, `src/session/session-store.js`); `ModelProvider` (Sprint 1, `src/provider/model-provider.js`); `ToolSchema` (Sprint 1, `src/types/message.js`).
- Produces: `dispatchToolCalls(calls, tools, gate, callHistory, context): Promise<DispatchOutcome>`, `DispatchOutcome { results, callHistory }` (`src/agent/tool-dispatcher.ts`); `runTurn(userText, options): Promise<TurnResult>`, `TurnOrchestratorOptions`, `TurnResult { finalText, stepsExecuted, stoppedReason }` (`src/agent/turn-orchestrator.ts`) — this is the sprint's top-level entry point; Sprint 3's tools and Sprint 4's CLI will call `runTurn` directly.

- [ ] **Step 1: Write the failing test for the Tool Dispatcher**

Create `test/agent/tool-dispatcher.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { dispatchToolCalls } from "../../src/agent/tool-dispatcher.js";
import { PermissionGate } from "../../src/permission/permission-gate.js";
import type { Tool, ToolExecutionContext } from "../../src/tool/tool.js";
import type { PermissionPolicy } from "../../src/permission/permission-policies.js";

const context: ToolExecutionContext = { cwd: "/tmp" };

function makeTool(name: string, execute: Tool["execute"]): Tool {
  return { name, description: name, parameters: {}, execute };
}

describe("dispatchToolCalls", () => {
  it("executes an allowed tool call and returns its result", async () => {
    const echoTool = makeTool("echo", async (input) => ({ output: JSON.stringify(input), isError: false }));
    const tools = new Map([["echo", echoTool]]);
    const allowAll: PermissionPolicy = { name: "allow-all", evaluate: () => "allow" };
    const gate = new PermissionGate([allowAll], vi.fn());

    const outcome = await dispatchToolCalls(
      [{ id: "1", name: "echo", input: { text: "hi" } }],
      tools,
      gate,
      [],
      context,
    );

    expect(outcome.results).toEqual([{ toolCallId: "1", output: '{"text":"hi"}', isError: false }]);
  });

  it("returns an error result for an unknown tool without throwing", async () => {
    const gate = new PermissionGate([{ name: "allow-all", evaluate: () => "allow" }], vi.fn());

    const outcome = await dispatchToolCalls(
      [{ id: "1", name: "does_not_exist", input: {} }],
      new Map(),
      gate,
      [],
      context,
    );

    expect(outcome.results[0].isError).toBe(true);
    expect(outcome.results[0].output).toContain("does_not_exist");
  });

  it("returns an error result for a denied tool call and never calls execute", async () => {
    const execute = vi.fn();
    const tools = new Map([["bash", makeTool("bash", execute)]]);
    const denyAll: PermissionPolicy = { name: "deny-all", evaluate: () => "deny" };
    const gate = new PermissionGate([denyAll], vi.fn());

    const outcome = await dispatchToolCalls([{ id: "1", name: "bash", input: {} }], tools, gate, [], context);

    expect(execute).not.toHaveBeenCalled();
    expect(outcome.results[0].isError).toBe(true);
    expect(outcome.results[0].output).toContain("denied");
  });

  it("catches a thrown error from a tool's execute and reports it as an error result", async () => {
    const throwingTool = makeTool("boom", async () => {
      throw new Error("kaboom");
    });
    const tools = new Map([["boom", throwingTool]]);
    const gate = new PermissionGate([{ name: "allow-all", evaluate: () => "allow" }], vi.fn());

    const outcome = await dispatchToolCalls([{ id: "1", name: "boom", input: {} }], tools, gate, [], context);

    expect(outcome.results[0].isError).toBe(true);
    expect(outcome.results[0].output).toContain("kaboom");
  });

  it("forces a permission ask on the 3rd consecutive identical call even when a policy would auto-allow", async () => {
    const execute = vi.fn().mockResolvedValue({ output: "ok", isError: false });
    const tools = new Map([["bash", makeTool("bash", execute)]]);
    const allowAll: PermissionPolicy = { name: "allow-all", evaluate: () => "allow" };
    const ask = vi.fn().mockResolvedValue(false);
    const gate = new PermissionGate([allowAll], ask);

    const call = { id: "3", name: "bash", input: { command: "ls" } };
    const history = [
      { id: "1", name: "bash", input: { command: "ls" } },
      { id: "2", name: "bash", input: { command: "ls" } },
    ];

    const outcome = await dispatchToolCalls([call], tools, gate, history, context);

    expect(ask).toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(outcome.results[0].isError).toBe(true);
  });

  it("returns an updated callHistory including every call attempted, without mutating the input array", async () => {
    const tools = new Map([["echo", makeTool("echo", async () => ({ output: "ok", isError: false }))]]);
    const gate = new PermissionGate([{ name: "allow-all", evaluate: () => "allow" }], vi.fn());
    const inputHistory: { id: string; name: string; input: unknown }[] = [];

    const outcome = await dispatchToolCalls(
      [{ id: "1", name: "echo", input: {} }],
      tools,
      gate,
      inputHistory,
      context,
    );

    expect(inputHistory).toEqual([]);
    expect(outcome.callHistory).toEqual([{ id: "1", name: "echo", input: {} }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/agent/tool-dispatcher.test.ts`
Expected: FAIL — `Cannot find module '../../src/agent/tool-dispatcher.js'`

- [ ] **Step 3: Implement the Tool Dispatcher**

Create `src/agent/tool-dispatcher.ts`:

```ts
import type { Tool, ToolExecutionContext } from "../tool/tool.js";
import type { PermissionGate } from "../permission/permission-gate.js";
import type { ToolCallRequest, ToolResult } from "../types/tool-call.js";
import { isDoomLoop } from "./doom-loop.js";

export interface DispatchOutcome {
  results: ToolResult[];
  callHistory: ToolCallRequest[];
}

// Dispatches a batch of tool calls: for each one, checks the doom-loop guard,
// evaluates permission, and executes the tool if approved. Returns one
// ToolResult per call, in order, regardless of individual outcomes -- a
// denial, an unknown tool, or a thrown error never propagates as an
// exception, it becomes an error ToolResult so the model can see and adapt to
// it. Returns the updated call history rather than mutating the one it's
// given, so the Turn Orchestrator can thread it across multiple steps of the
// same turn immutably.
export async function dispatchToolCalls(
  calls: readonly ToolCallRequest[],
  tools: ReadonlyMap<string, Tool>,
  gate: PermissionGate,
  callHistory: readonly ToolCallRequest[],
  context: ToolExecutionContext,
): Promise<DispatchOutcome> {
  const results: ToolResult[] = [];
  let history = [...callHistory];

  for (const call of calls) {
    const forceAsk = isDoomLoop(history, call);
    history = [...history, call];

    const tool = tools.get(call.name);
    if (!tool) {
      results.push({ toolCallId: call.id, output: `Unknown tool: "${call.name}"`, isError: true });
      continue;
    }

    const permission = await gate.evaluate(call, { forceAsk });
    if (permission.decision === "deny") {
      results.push({ toolCallId: call.id, output: `Tool call denied: ${permission.reason}`, isError: true });
      continue;
    }

    try {
      const executed = await tool.execute(call.input, context);
      results.push({ toolCallId: call.id, output: executed.output, isError: executed.isError });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({ toolCallId: call.id, output: `Tool "${call.name}" threw: ${message}`, isError: true });
    }
  }

  return { results, callHistory: history };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/agent/tool-dispatcher.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/agent/tool-dispatcher.ts test/agent/tool-dispatcher.test.ts
git commit -m "feat: add the Tool Dispatcher"
```

- [ ] **Step 6: Write the failing integration test for the Turn Orchestrator**

Create `test/agent/turn-orchestrator.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTurn } from "../../src/agent/turn-orchestrator.js";
import { SessionStore } from "../../src/session/session-store.js";
import { PermissionGate } from "../../src/permission/permission-gate.js";
import { autoAllowReadOnlyPolicy, askBeforeWriteOrBashPolicy } from "../../src/permission/permission-policies.js";
import type { Tool, ToolExecutionContext } from "../../src/tool/tool.js";
import type { PermissionPolicy } from "../../src/permission/permission-policies.js";
import type { ModelProvider, StreamContext } from "../../src/provider/model-provider.js";
import type { StreamEvent } from "../../src/types/message.js";
import type { ToolResult } from "../../src/types/tool-call.js";

function makeTool(name: string, execute: Tool["execute"]): Tool {
  return { name, description: name, parameters: {}, execute };
}

// Yields a scripted sequence of StreamEvent[] batches, one batch per call to
// stream(). The last batch repeats indefinitely if stream() is called more
// times than the script has entries, which keeps the "runs forever" test simple.
class ScriptedProvider implements ModelProvider {
  readonly name = "scripted";
  private callCount = 0;

  constructor(private readonly script: StreamEvent[][]) {}

  async *stream(_context: StreamContext): AsyncIterable<StreamEvent> {
    const batch = this.script[Math.min(this.callCount, this.script.length - 1)];
    this.callCount++;
    for (const event of batch) yield event;
  }
}

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "forge-turn-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("runTurn", () => {
  it("runs a full turn: user message -> tool call -> tool result -> final text", async () => {
    const session = await SessionStore.create(dir);
    const readExecute = vi.fn().mockResolvedValue({ output: "contents of a.ts", isError: false });
    const tools = new Map([["read_file", makeTool("read_file", readExecute)]]);
    const gate = new PermissionGate([autoAllowReadOnlyPolicy], vi.fn());
    const provider = new ScriptedProvider([
      [
        { type: "tool_call", id: "1", name: "read_file", input: { path: "a.ts" } },
        { type: "finish", reason: "tool_calls", rawReason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "The file contains X" },
        { type: "finish", reason: "completed", rawReason: "end_turn" },
      ],
    ]);

    const result = await runTurn("what's in a.ts?", {
      provider,
      session,
      tools,
      gate,
      systemPrompt: "",
      toolContext: { cwd: dir },
    });

    expect(result.finalText).toBe("The file contains X");
    expect(result.stoppedReason).toBe("completed");
    expect(result.stepsExecuted).toBe(2);

    const entryTypes = session.getEntries().map((e) => e.type);
    expect(entryTypes).toEqual(["user_message", "tool_call", "tool_result", "assistant_message"]);
  });

  it("feeds a denial back to the model, which can then try a different tool", async () => {
    const session = await SessionStore.create(dir);
    const bashExecute = vi.fn();
    const readExecute = vi.fn().mockResolvedValue({ output: "file contents", isError: false });
    const tools = new Map([
      ["bash", makeTool("bash", bashExecute)],
      ["read_file", makeTool("read_file", readExecute)],
    ]);
    const ask = vi.fn().mockResolvedValue(false);
    const gate = new PermissionGate([autoAllowReadOnlyPolicy, askBeforeWriteOrBashPolicy], ask);
    const provider = new ScriptedProvider([
      [
        { type: "tool_call", id: "1", name: "bash", input: { command: "rm -rf /" } },
        { type: "finish", reason: "tool_calls", rawReason: "tool_use" },
      ],
      [
        { type: "tool_call", id: "2", name: "read_file", input: { path: "a.ts" } },
        { type: "finish", reason: "tool_calls", rawReason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "done" },
        { type: "finish", reason: "completed", rawReason: "end_turn" },
      ],
    ]);

    const result = await runTurn("do something", {
      provider,
      session,
      tools,
      gate,
      systemPrompt: "",
      toolContext: { cwd: dir },
    });

    expect(bashExecute).not.toHaveBeenCalled();
    expect(readExecute).toHaveBeenCalled();
    expect(result.finalText).toBe("done");

    const toolResults = session
      .getEntries()
      .filter((e) => e.type === "tool_result")
      .map((e) => e.payload as ToolResult);
    expect(toolResults[0].isError).toBe(true);
    expect(toolResults[0].output).toContain("denied");
    expect(toolResults[1]).toEqual({ toolCallId: "2", output: "file contents", isError: false });
  });

  it("forces an ask on the 3rd consecutive identical tool call even when a policy would auto-allow it", async () => {
    const session = await SessionStore.create(dir);
    const execute = vi.fn().mockResolvedValue({ output: "ok", isError: false });
    const tools = new Map([["bash", makeTool("bash", execute)]]);
    const alwaysAllow: PermissionPolicy = { name: "always-allow", evaluate: () => "allow" };
    const ask = vi.fn().mockResolvedValue(false);
    const gate = new PermissionGate([alwaysAllow], ask);

    const repeatedCall: StreamEvent = { type: "tool_call", id: "x", name: "bash", input: { command: "ls" } };
    const finishToolCalls: StreamEvent = { type: "finish", reason: "tool_calls", rawReason: "tool_use" };
    const provider = new ScriptedProvider([
      [repeatedCall, finishToolCalls],
      [repeatedCall, finishToolCalls],
      [repeatedCall, finishToolCalls],
      [
        { type: "text_delta", text: "giving up" },
        { type: "finish", reason: "completed", rawReason: "end_turn" },
      ],
    ]);

    const result = await runTurn("loop", {
      provider,
      session,
      tools,
      gate,
      systemPrompt: "",
      toolContext: { cwd: dir },
    });

    expect(execute).toHaveBeenCalledTimes(2);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(result.finalText).toBe("giving up");
  });

  it("does not execute tool calls from a truncated step and reports them as errors", async () => {
    const session = await SessionStore.create(dir);
    const execute = vi.fn().mockResolvedValue({ output: "ok", isError: false });
    const tools = new Map([["bash", makeTool("bash", execute)]]);
    const gate = new PermissionGate([{ name: "allow-all", evaluate: () => "allow" }], vi.fn());
    const provider = new ScriptedProvider([
      [
        { type: "tool_call", id: "1", name: "bash", input: { command: "rm -rf" } },
        { type: "finish", reason: "truncated", rawReason: "max_tokens" },
      ],
      [
        { type: "text_delta", text: "sorry, let me retry" },
        { type: "finish", reason: "completed", rawReason: "end_turn" },
      ],
    ]);

    const result = await runTurn("do something risky", {
      provider,
      session,
      tools,
      gate,
      systemPrompt: "",
      toolContext: { cwd: dir },
    });

    expect(execute).not.toHaveBeenCalled();
    expect(result.finalText).toBe("sorry, let me retry");

    const toolResult = session
      .getEntries()
      .find((e) => e.type === "tool_result")!
      .payload as ToolResult;
    expect(toolResult.isError).toBe(true);
    expect(toolResult.output).toContain("truncated");
  });

  it("stops after maxSteps when the model keeps requesting tool calls indefinitely", async () => {
    const session = await SessionStore.create(dir);
    const tools = new Map([["bash", makeTool("bash", async () => ({ output: "ok", isError: false }))]]);
    const gate = new PermissionGate([{ name: "allow-all", evaluate: () => "allow" }], vi.fn());
    let counter = 0;
    const provider: ModelProvider = {
      name: "infinite",
      async *stream(): AsyncIterable<StreamEvent> {
        counter++;
        yield { type: "tool_call", id: String(counter), name: "bash", input: { command: `cmd-${counter}` } };
        yield { type: "finish", reason: "tool_calls", rawReason: "tool_use" };
      },
    };

    const result = await runTurn("loop forever", {
      provider,
      session,
      tools,
      gate,
      systemPrompt: "",
      toolContext: { cwd: dir },
      maxSteps: 3,
    });

    expect(result.stoppedReason).toBe("max_steps_reached");
    expect(result.stepsExecuted).toBe(3);
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npm test -- test/agent/turn-orchestrator.test.ts`
Expected: FAIL — `Cannot find module '../../src/agent/turn-orchestrator.js'`

- [ ] **Step 8: Implement the Turn Orchestrator**

Create `src/agent/turn-orchestrator.ts`:

```ts
import type { ModelProvider } from "../provider/model-provider.js";
import type { SessionStore } from "../session/session-store.js";
import type { Tool, ToolExecutionContext } from "../tool/tool.js";
import type { PermissionGate } from "../permission/permission-gate.js";
import type { ToolCallRequest, ToolResult } from "../types/tool-call.js";
import type { ToolSchema } from "../types/message.js";
import { sessionEntriesToMessages } from "./session-bridge.js";
import { executeStep } from "./step-executor.js";
import { dispatchToolCalls } from "./tool-dispatcher.js";

const DEFAULT_MAX_STEPS = 50;

export interface TurnOrchestratorOptions {
  provider: ModelProvider;
  session: SessionStore;
  tools: ReadonlyMap<string, Tool>;
  gate: PermissionGate;
  systemPrompt: string;
  toolContext: ToolExecutionContext;
  maxSteps?: number;
}

export type TurnStoppedReason = "completed" | "max_steps_reached";

export interface TurnResult {
  finalText: string;
  stepsExecuted: number;
  stoppedReason: TurnStoppedReason;
}

function toolsToSchemas(tools: ReadonlyMap<string, Tool>): ToolSchema[] {
  return [...tools.values()].map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));
}

function failTruncatedToolCalls(calls: readonly ToolCallRequest[]): ToolResult[] {
  return calls.map((call) => ({
    toolCallId: call.id,
    output:
      "Tool call not executed: the model's response was truncated before its arguments could be safely determined.",
    isError: true,
  }));
}

// The outer loop of one user turn: appends the user's message, repeatedly
// calls the Step Executor for a model round-trip, and -- when the model
// requests tool calls -- either fails them (a truncated response) or routes
// them through the Tool Dispatcher, appending every step's results to the
// session log as it goes. Stops when the model returns a plain text response
// with no further tool calls, or when maxSteps is exhausted as a safety bound
// against a runaway tool-calling loop.
export async function runTurn(userText: string, options: TurnOrchestratorOptions): Promise<TurnResult> {
  const { provider, session, tools, gate, systemPrompt, toolContext } = options;
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
  const toolSchemas = toolsToSchemas(tools);

  await session.append("user_message", { text: userText });

  let callHistory: ToolCallRequest[] = [];

  for (let step = 1; step <= maxSteps; step++) {
    const messages = sessionEntriesToMessages(session.getEntries());
    const stepResult = await executeStep(provider, { systemPrompt, messages, tools: toolSchemas });

    if (stepResult.text) {
      await session.append("assistant_message", { text: stepResult.text });
    }

    if (stepResult.toolCalls.length === 0) {
      return { finalText: stepResult.text, stepsExecuted: step, stoppedReason: "completed" };
    }

    for (const call of stepResult.toolCalls) {
      await session.append("tool_call", call);
    }

    let results: ToolResult[];
    if (stepResult.finishReason === "truncated") {
      results = failTruncatedToolCalls(stepResult.toolCalls);
    } else {
      const outcome = await dispatchToolCalls(stepResult.toolCalls, tools, gate, callHistory, toolContext);
      results = outcome.results;
      callHistory = outcome.callHistory;
    }

    for (const result of results) {
      await session.append("tool_result", result);
    }
  }

  return { finalText: "", stepsExecuted: maxSteps, stoppedReason: "max_steps_reached" };
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `npm test -- test/agent/turn-orchestrator.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 10: Run the full test suite and both typecheck paths**

Run: `npm test && npm run typecheck && npm run typecheck:test`
Expected: all tests pass (Sprint 1's 20 + Sprint 2's new tests: Task 1 = 2, Task 2 = 5+8+6 = 19, Task 3 = 5+4 = 9, Task 4 = 6+5 = 11; 2+19+9+11 = 41 new = 61 total), both typechecks report no errors.

- [ ] **Step 11: Commit**

```bash
git add src/agent/turn-orchestrator.ts test/agent/turn-orchestrator.test.ts
git commit -m "feat: add the Turn Orchestrator, completing the Sprint 2 agent loop"
```

---

## Sprint 2 Definition of Done

- [ ] All automated tests across Tasks 1-4 pass (`npm test`), full suite green including Sprint 1's tests.
- [ ] `npm run typecheck` and `npm run typecheck:test` both report no errors.
- [ ] A scripted conversation against a fake tool and fake provider runs end-to-end through the full loop (Task 4's integration test), including one denied-then-corrected tool call and one doom-loop trigger, all as automated tests.
- [ ] The Agent Loop is decomposed into three separate files (Step Executor, Tool Dispatcher, Turn Orchestrator) -- no single god-function.
- [ ] The Permission Gate is a chain of independent policy objects, not a hardcoded if-chain.

Once this Definition of Done is met, move to Sprint 3 (Plugin/Tool Registry + MCP client + built-in tools) -- see [ROADMAP.md](../../ROADMAP.md).
