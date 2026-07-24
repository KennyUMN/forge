import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSubagent } from "../../src/agent/subagent.js";
import type { SubagentConfig, SubagentContext } from "../../src/agent/subagent.js";
import { SessionStore } from "../../src/session/session-store.js";
import { PermissionGate } from "../../src/permission/permission-gate.js";
import { allowEverythingPolicy } from "../../src/permission/permission-policies.js";
import type { Tool } from "../../src/tool/tool.js";
import type { ModelProvider, StreamContext } from "../../src/provider/model-provider.js";
import type { StreamEvent } from "../../src/types/message.js";

function makeTool(name: string, execute?: Tool["execute"]): Tool {
  return {
    name,
    description: name,
    parameters: {},
    execute: execute ?? (async () => ({ output: "ok", isError: false })),
  };
}

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
  dir = await mkdtemp(join(tmpdir(), "forge-subagent-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function buildContext(overrides: Partial<SubagentContext> = {}): SubagentContext {
  const parentProvider = new ScriptedProvider([
    [
      { type: "text_delta", text: "Task complete: found 3 files." },
      { type: "finish", reason: "completed", rawReason: "end_turn" },
    ],
  ]);

  const parentTools = new Map<string, Tool>([
    ["read_file", makeTool("read_file")],
    ["grep", makeTool("grep")],
    ["glob", makeTool("glob")],
    ["write_file", makeTool("write_file")],
    ["edit_file", makeTool("edit_file")],
    ["bash", makeTool("bash")],
  ]);

  return {
    parentProvider,
    parentTools,
    parentSession: undefined as unknown as SessionStore,
    parentGate: new PermissionGate([allowEverythingPolicy], async () => true),
    systemPrompt: "You are Forge.",
    cwd: dir,
    ...overrides,
  };
}

describe("runSubagent", () => {
  it("creates a child session and returns a summary", async () => {
    const parentSession = await SessionStore.create(dir);
    await parentSession.append("user_message", { text: "do something" });

    const context = buildContext({ parentSession });
    const config: SubagentConfig = { mode: "worker" };

    const result = await runSubagent("Find all TypeScript files", config, context);

    expect(result.summary).toBe("Task complete: found 3 files.");
    expect(result.stepsExecuted).toBe(1);
    expect(result.stoppedReason).toBe("completed");
    expect(result.toolCallsMade).toBe(0);
  });

  it("advisory mode restricts tools to read-only (no write_file, edit_file, bash)", async () => {
    const parentSession = await SessionStore.create(dir);
    await parentSession.append("user_message", { text: "research" });

    const toolCallEvents: StreamEvent[] = [
      { type: "tool_call", id: "1", name: "write_file", input: { path: "x.ts", content: "" } },
      { type: "finish", reason: "tool_calls", rawReason: "tool_use" },
    ];
    const textEvents: StreamEvent[] = [
      { type: "text_delta", text: "Cannot write in advisory mode." },
      { type: "finish", reason: "completed", rawReason: "end_turn" },
    ];

    const provider = new ScriptedProvider([toolCallEvents, textEvents]);
    const context = buildContext({ parentSession, parentProvider: provider });
    const config: SubagentConfig = { mode: "advisory" };

    const result = await runSubagent("Try to write a file", config, context);

    expect(result.summary).toBe("Cannot write in advisory mode.");
    const entries = parentSession.getEntries();
    const toolResults = entries.filter((e) => e.type === "tool_result");
    expect(toolResults.length).toBe(0);
  });

  it("worker mode has full tool access", async () => {
    const parentSession = await SessionStore.create(dir);
    await parentSession.append("user_message", { text: "edit stuff" });

    const writeExecute = vi.fn().mockResolvedValue({ output: "written", isError: false });
    const tools = new Map<string, Tool>([
      ["read_file", makeTool("read_file")],
      ["write_file", makeTool("write_file", writeExecute)],
      ["bash", makeTool("bash")],
    ]);

    const provider = new ScriptedProvider([
      [
        { type: "tool_call", id: "1", name: "write_file", input: { path: "out.ts", content: "x" } },
        { type: "finish", reason: "tool_calls", rawReason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "File written." },
        { type: "finish", reason: "completed", rawReason: "end_turn" },
      ],
    ]);

    const context = buildContext({ parentSession, parentProvider: provider, parentTools: tools });
    const config: SubagentConfig = { mode: "worker" };

    const result = await runSubagent("Write a file", config, context);

    expect(writeExecute).toHaveBeenCalled();
    expect(result.summary).toBe("File written.");
    expect(result.toolCallsMade).toBe(1);
  });

  it("child session parentId links to the parent's head", async () => {
    const parentSession = await SessionStore.create(dir);
    await parentSession.append("user_message", { text: "parent turn" });
    const parentHead = parentSession.getHeadId();

    const context = buildContext({ parentSession });
    const config: SubagentConfig = { mode: "worker" };

    await runSubagent("Do a task", config, context);

    const { readdir, readFile } = await import("node:fs/promises");
    const files = await readdir(dir);
    const childFile = files.find((f) => f.endsWith(".jsonl") && f !== `${parentSession.sessionId}.jsonl`);
    expect(childFile).toBeDefined();

    const content = await readFile(join(dir, childFile!), "utf-8");
    const firstLine = content.split("\n")[0];
    const firstEntry = JSON.parse(firstLine);
    expect(firstEntry.parentId).toBe(parentHead);
  });

  it("respects maxSteps", async () => {
    const parentSession = await SessionStore.create(dir);
    await parentSession.append("user_message", { text: "loop" });

    let counter = 0;
    const infiniteProvider: ModelProvider = {
      name: "infinite",
      async *stream(): AsyncIterable<StreamEvent> {
        counter++;
        yield { type: "tool_call", id: String(counter), name: "read_file", input: { path: `f${counter}.ts` } };
        yield { type: "finish", reason: "tool_calls", rawReason: "tool_use" };
      },
    };

    const context = buildContext({ parentSession, parentProvider: infiniteProvider });
    const config: SubagentConfig = { mode: "worker", maxSteps: 3 };

    const result = await runSubagent("Loop forever", config, context);

    expect(result.stoppedReason).toBe("max_steps_reached");
    expect(result.stepsExecuted).toBe(3);
  });

  it("parent context only sees the summary, not child verbose output", async () => {
    const parentSession = await SessionStore.create(dir);
    await parentSession.append("user_message", { text: "parent work" });

    const provider = new ScriptedProvider([
      [
        { type: "tool_call", id: "1", name: "read_file", input: { path: "a.ts" } },
        { type: "finish", reason: "tool_calls", rawReason: "tool_use" },
      ],
      [
        { type: "tool_call", id: "2", name: "grep", input: { pattern: "foo" } },
        { type: "finish", reason: "tool_calls", rawReason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "Summary: found the answer." },
        { type: "finish", reason: "completed", rawReason: "end_turn" },
      ],
    ]);

    const context = buildContext({ parentSession, parentProvider: provider });
    const config: SubagentConfig = { mode: "advisory" };

    const result = await runSubagent("Research task", config, context);

    expect(result.summary).toBe("Summary: found the answer.");
    expect(result.stepsExecuted).toBe(3);
    expect(result.toolCallsMade).toBe(2);

    const parentEntries = parentSession.getEntries();
    const parentTexts = parentEntries
      .filter((e) => e.type === "assistant_message")
      .map((e) => (e.payload as { text: string }).text);
    expect(parentTexts).not.toContain("Summary: found the answer.");
  });

  it("defaults maxSteps to 25", async () => {
    const parentSession = await SessionStore.create(dir);
    await parentSession.append("user_message", { text: "task" });

    let stepCount = 0;
    const countingProvider: ModelProvider = {
      name: "counter",
      async *stream(): AsyncIterable<StreamEvent> {
        stepCount++;
        yield { type: "tool_call", id: String(stepCount), name: "read_file", input: { path: `f${stepCount}` } };
        yield { type: "finish", reason: "tool_calls", rawReason: "tool_use" };
      },
    };

    const context = buildContext({ parentSession, parentProvider: countingProvider });
    const config: SubagentConfig = { mode: "worker" };

    const result = await runSubagent("Infinite task", config, context);

    expect(result.stepsExecuted).toBe(25);
    expect(result.stoppedReason).toBe("max_steps_reached");
  });
});
