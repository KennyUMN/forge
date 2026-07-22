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
