import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTurn } from "../../src/agent/turn-orchestrator.js";
import { SessionStore } from "../../src/session/session-store.js";
import { PermissionGate } from "../../src/permission/permission-gate.js";
import type { ModelProvider, StreamContext } from "../../src/provider/model-provider.js";
import type { StreamEvent } from "../../src/types/message.js";
import type { Tool } from "../../src/tool/tool.js";
import type { TurnEvent } from "../../src/agent/turn-events.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "forge-turn-events-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function scriptedProvider(steps: StreamEvent[][], onContext?: (context: StreamContext) => void): ModelProvider {
  let index = 0;
  return {
    name: "scripted",
    async *stream(context) {
      onContext?.(context);
      for (const event of steps[index] ?? []) yield event;
      index++;
    },
  };
}

const echoTool: Tool = {
  name: "echo",
  description: "echoes",
  parameters: { type: "object", properties: {} },
  execute: async (input) => ({ output: `echoed ${JSON.stringify(input)}`, isError: false }),
};

const allowAll = () => new PermissionGate([], async () => true);

describe("runTurn event stream", () => {
  it("emits step, text, tool-call and tool-result events in the order they happen", async () => {
    const session = await SessionStore.create(dir);
    const provider = scriptedProvider([
      [
        { type: "text_delta", text: "working" },
        { type: "tool_call", id: "c1", name: "echo", input: { a: 1 } },
        { type: "finish", reason: "tool_calls", rawReason: "tool_calls" },
      ],
      [
        { type: "text_delta", text: "done" },
        { type: "finish", reason: "completed", rawReason: "stop" },
      ],
    ]);

    const events: TurnEvent[] = [];
    await runTurn("go", {
      provider,
      session,
      tools: new Map([["echo", echoTool]]),
      gate: allowAll(),
      systemPrompt: "",
      toolContext: { cwd: dir },
      onEvent: (event) => events.push(event),
    });

    expect(events.map((e) => e.type)).toEqual([
      "step_start",
      "text_delta",
      "step_end",
      "tool_call",
      "tool_result",
      "step_start",
      "text_delta",
      "step_end",
    ]);
  });

  // A renderer showing a spinner next to a pending call needs the result to
  // carry its originating call, or it has to maintain its own id->call map.
  it("pairs each tool_result with the call that produced it", async () => {
    const session = await SessionStore.create(dir);
    const provider = scriptedProvider([
      [
        { type: "tool_call", id: "c1", name: "echo", input: { a: 1 } },
        { type: "finish", reason: "tool_calls", rawReason: "tool_calls" },
      ],
      [{ type: "finish", reason: "completed", rawReason: "stop" }],
    ]);

    const events: TurnEvent[] = [];
    await runTurn("go", {
      provider,
      session,
      tools: new Map([["echo", echoTool]]),
      gate: allowAll(),
      systemPrompt: "",
      toolContext: { cwd: dir },
      onEvent: (event) => events.push(event),
    });

    const result = events.find((e) => e.type === "tool_result");
    expect(result).toMatchObject({
      call: { id: "c1", name: "echo" },
      result: { toolCallId: "c1", output: 'echoed {"a":1}', isError: false },
    });
  });

  // Denials and unknown tools are outcomes too: a renderer that only saw
  // successful results would leave those calls displayed as pending forever.
  it("emits a tool_result for a denied call", async () => {
    const session = await SessionStore.create(dir);
    const provider = scriptedProvider([
      [
        { type: "tool_call", id: "c1", name: "echo", input: {} },
        { type: "finish", reason: "tool_calls", rawReason: "tool_calls" },
      ],
      [{ type: "finish", reason: "completed", rawReason: "stop" }],
    ]);

    const events: TurnEvent[] = [];
    await runTurn("go", {
      provider,
      session,
      tools: new Map([["echo", echoTool]]),
      gate: new PermissionGate([], async () => false),
      systemPrompt: "",
      toolContext: { cwd: dir },
      onEvent: (event) => events.push(event),
    });

    expect(events.find((e) => e.type === "tool_result")).toMatchObject({
      result: { isError: true, output: expect.stringContaining("denied") },
    });
  });

  it("forwards thinking deltas without folding them into the assistant text", async () => {
    const session = await SessionStore.create(dir);
    const provider = scriptedProvider([
      [
        { type: "thinking_delta", text: "hmm" },
        { type: "text_delta", text: "answer" },
        { type: "finish", reason: "completed", rawReason: "stop" },
      ],
    ]);

    const events: TurnEvent[] = [];
    const result = await runTurn("go", {
      provider,
      session,
      tools: new Map(),
      gate: allowAll(),
      systemPrompt: "",
      toolContext: { cwd: dir },
      onEvent: (event) => events.push(event),
    });

    expect(events.filter((e) => e.type === "thinking_delta")).toHaveLength(1);
    expect(result.finalText).toBe("answer");
  });
});

describe("runTurn abort handling", () => {
  it("passes the signal to the provider so a stream in flight can be cancelled", async () => {
    const session = await SessionStore.create(dir);
    const controller = new AbortController();
    let seen: AbortSignal | undefined;
    const provider = scriptedProvider([[{ type: "finish", reason: "completed", rawReason: "stop" }]], (context) => {
      seen = context.signal;
    });

    await runTurn("go", {
      provider,
      session,
      tools: new Map(),
      gate: allowAll(),
      systemPrompt: "",
      toolContext: { cwd: dir },
      signal: controller.signal,
    });

    expect(seen).toBe(controller.signal);
  });

  // Without this the tool sees whatever context the caller built before the
  // turn began, so an interrupt reaches the provider but never the bash
  // command actually blocking the turn.
  it("passes the signal to tools through the execution context", async () => {
    const session = await SessionStore.create(dir);
    const controller = new AbortController();
    let seen: AbortSignal | undefined;
    const spyTool: Tool = {
      name: "spy",
      description: "records its context",
      parameters: { type: "object", properties: {} },
      execute: async (_input, context) => {
        seen = context.signal;
        return { output: "ok", isError: false };
      },
    };
    const provider = scriptedProvider([
      [
        { type: "tool_call", id: "c1", name: "spy", input: {} },
        { type: "finish", reason: "tool_calls", rawReason: "tool_calls" },
      ],
      [{ type: "finish", reason: "completed", rawReason: "stop" }],
    ]);

    await runTurn("go", {
      provider,
      session,
      tools: new Map([["spy", spyTool]]),
      gate: allowAll(),
      systemPrompt: "",
      toolContext: { cwd: dir },
      signal: controller.signal,
    });

    expect(seen).toBe(controller.signal);
  });

  it("stops with stoppedReason aborted rather than starting another step", async () => {
    const session = await SessionStore.create(dir);
    const controller = new AbortController();
    controller.abort();
    let streamCalls = 0;
    const provider: ModelProvider = {
      name: "counting",
      async *stream() {
        streamCalls++;
        yield { type: "finish", reason: "completed", rawReason: "stop" } as StreamEvent;
      },
    };

    const result = await runTurn("go", {
      provider,
      session,
      tools: new Map(),
      gate: allowAll(),
      systemPrompt: "",
      toolContext: { cwd: dir },
      signal: controller.signal,
    });

    expect(result.stoppedReason).toBe("aborted");
    expect(streamCalls).toBe(0);
  });
});
