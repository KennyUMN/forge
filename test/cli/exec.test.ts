import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runExec } from "../../src/cli/exec.js";
import { SessionStore } from "../../src/session/session-store.js";
import { PermissionGate } from "../../src/permission/permission-gate.js";
import { autoAllowReadOnlyPolicy, askBeforeWriteOrBashPolicy } from "../../src/permission/permission-policies.js";
import type { Tool } from "../../src/tool/tool.js";
import type { ModelProvider, StreamContext } from "../../src/provider/model-provider.js";
import type { StreamEvent } from "../../src/types/message.js";
import type { ExecOptions } from "../../src/cli/exec.js";

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

function makeTool(name: string, execute: Tool["execute"]): Tool {
  return { name, description: name, parameters: {}, execute };
}

let dir: string;
let stdoutSpy: ReturnType<typeof vi.spyOn>;
let stderrSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "forge-exec-"));
  stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  stdoutSpy.mockRestore();
  stderrSpy.mockRestore();
  process.exitCode = undefined;
});

function stdoutOutput(): string {
  return stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
}

async function makeExecOptions(overrides: Partial<ExecOptions> & { provider: ModelProvider }): Promise<ExecOptions> {
  const session = await SessionStore.create(dir);
  const gate = new PermissionGate([autoAllowReadOnlyPolicy], async () => false);
  return {
    prompt: "hello",
    outputFormat: "text",
    systemPrompt: "You are a test assistant.",
    provider: overrides.provider,
    session,
    tools: new Map(),
    gate,
    toolContext: { cwd: dir },
    ...overrides,
  };
}

describe("runExec", () => {
  describe("text format", () => {
    it("outputs only the final assistant text", async () => {
      const provider = new ScriptedProvider([
        [
          { type: "text_delta", text: "Hello " },
          { type: "text_delta", text: "world" },
          { type: "finish", reason: "completed", rawReason: "end_turn", usage: { inputTokens: 10, outputTokens: 5 } },
        ],
      ]);

      await runExec(await makeExecOptions({ provider, outputFormat: "text" }));

      const output = stdoutOutput();
      expect(output).toBe("Hello world\n");
    });

    it("does not emit JSON or decorations", async () => {
      const provider = new ScriptedProvider([
        [
          { type: "text_delta", text: "result" },
          { type: "finish", reason: "completed", rawReason: "end_turn" },
        ],
      ]);

      await runExec(await makeExecOptions({ provider, outputFormat: "text" }));

      const output = stdoutOutput();
      expect(output).not.toContain("{");
      expect(output).not.toContain("forge");
    });
  });

  describe("json format", () => {
    it("outputs a single valid JSON object with expected fields", async () => {
      const provider = new ScriptedProvider([
        [
          { type: "text_delta", text: "The answer is 42" },
          { type: "finish", reason: "completed", rawReason: "end_turn", usage: { inputTokens: 100, outputTokens: 20 } },
        ],
      ]);

      await runExec(await makeExecOptions({ provider, outputFormat: "json" }));

      const output = stdoutOutput().trim();
      const parsed = JSON.parse(output);
      expect(parsed.result).toBe("The answer is 42");
      expect(parsed.steps).toBe(1);
      expect(parsed.stoppedReason).toBe("completed");
      expect(parsed.usage).toEqual({ inputTokens: 100, outputTokens: 20 });
    });

    it("accumulates usage across multiple steps", async () => {
      const readExecute = vi.fn().mockResolvedValue({ output: "file contents", isError: false });
      const tools = new Map([["read_file", makeTool("read_file", readExecute)]]);
      const provider = new ScriptedProvider([
        [
          { type: "tool_call", id: "1", name: "read_file", input: { path: "a.ts" } },
          { type: "finish", reason: "tool_calls", rawReason: "tool_use", usage: { inputTokens: 50, outputTokens: 10 } },
        ],
        [
          { type: "text_delta", text: "Done" },
          { type: "finish", reason: "completed", rawReason: "end_turn", usage: { inputTokens: 80, outputTokens: 15 } },
        ],
      ]);

      await runExec(await makeExecOptions({ provider, outputFormat: "json", tools }));

      const parsed = JSON.parse(stdoutOutput().trim());
      expect(parsed.result).toBe("Done");
      expect(parsed.steps).toBe(2);
      expect(parsed.usage).toEqual({ inputTokens: 130, outputTokens: 25 });
    });
  });

  describe("stream-json format", () => {
    it("emits line-delimited JSON events", async () => {
      const provider = new ScriptedProvider([
        [
          { type: "text_delta", text: "Hi" },
          { type: "finish", reason: "completed", rawReason: "end_turn", usage: { inputTokens: 10, outputTokens: 5 } },
        ],
      ]);

      await runExec(await makeExecOptions({ provider, outputFormat: "stream-json" }));

      const lines = stdoutOutput().trim().split("\n");
      expect(lines.length).toBeGreaterThanOrEqual(3);

      const events = lines.map((line) => JSON.parse(line));
      expect(events[0]).toEqual({ type: "step_start", step: 1 });
      expect(events[1]).toEqual({ type: "text_delta", text: "Hi" });

      const stepEnd = events.find((e) => e.type === "step_end");
      expect(stepEnd).toBeDefined();
      expect(stepEnd.step).toBe(1);
      expect(stepEnd.finishReason).toBe("completed");

      const result = events[events.length - 1];
      expect(result.type).toBe("result");
      expect(result.text).toBe("Hi");
      expect(result.steps).toBe(1);
      expect(result.stoppedReason).toBe("completed");
    });

    it("emits tool_call and tool_result events", async () => {
      const readExecute = vi.fn().mockResolvedValue({ output: "contents", isError: false });
      const tools = new Map([["read_file", makeTool("read_file", readExecute)]]);
      const provider = new ScriptedProvider([
        [
          { type: "tool_call", id: "1", name: "read_file", input: { path: "x.ts" } },
          { type: "finish", reason: "tool_calls", rawReason: "tool_use", usage: { inputTokens: 20, outputTokens: 8 } },
        ],
        [
          { type: "text_delta", text: "Read it" },
          { type: "finish", reason: "completed", rawReason: "end_turn", usage: { inputTokens: 40, outputTokens: 12 } },
        ],
      ]);

      await runExec(await makeExecOptions({ provider, outputFormat: "stream-json", tools }));

      const lines = stdoutOutput().trim().split("\n");
      const events = lines.map((line) => JSON.parse(line));

      const toolCall = events.find((e) => e.type === "tool_call");
      expect(toolCall).toBeDefined();
      expect(toolCall.name).toBe("read_file");
      expect(toolCall.input).toEqual({ path: "x.ts" });

      const toolResult = events.find((e) => e.type === "tool_result");
      expect(toolResult).toBeDefined();
      expect(toolResult.name).toBe("read_file");
      expect(toolResult.output).toContain("contents");
      expect(toolResult.isError).toBe(false);
    });

    it("every emitted line is parseable by JSON.parse", async () => {
      const provider = new ScriptedProvider([
        [
          { type: "text_delta", text: "line with \"quotes\" and\nnewlines" },
          { type: "finish", reason: "completed", rawReason: "end_turn", usage: { inputTokens: 5, outputTokens: 3 } },
        ],
      ]);

      await runExec(await makeExecOptions({ provider, outputFormat: "stream-json" }));

      const lines = stdoutOutput().trim().split("\n");
      for (const line of lines) {
        expect(() => JSON.parse(line)).not.toThrow();
      }
    });
  });

  describe("permission denials", () => {
    it("denies silently without prompting in exec mode", async () => {
      const bashExecute = vi.fn();
      const tools = new Map([["bash", makeTool("bash", bashExecute)]]);
      const ask = vi.fn().mockResolvedValue(false);
      const gate = new PermissionGate([autoAllowReadOnlyPolicy, askBeforeWriteOrBashPolicy], ask);
      const provider = new ScriptedProvider([
        [
          { type: "tool_call", id: "1", name: "bash", input: { command: "rm -rf /" } },
          { type: "finish", reason: "tool_calls", rawReason: "tool_use" },
        ],
        [
          { type: "text_delta", text: "Denied, moving on" },
          { type: "finish", reason: "completed", rawReason: "end_turn" },
        ],
      ]);

      await runExec(await makeExecOptions({ provider, outputFormat: "text", tools, gate }));

      expect(bashExecute).not.toHaveBeenCalled();
      expect(stdoutOutput()).toContain("Denied, moving on");
    });
  });

  describe("exit codes", () => {
    it("sets exit code 1 on budget exceeded", async () => {
      const provider = new ScriptedProvider([
        [
          { type: "text_delta", text: "expensive" },
          { type: "finish", reason: "completed", rawReason: "end_turn", usage: { inputTokens: 999999, outputTokens: 999999 } },
        ],
      ]);

      await runExec(await makeExecOptions({
        provider,
        outputFormat: "json",
        budget: { maxTotalTokens: 100 },
      }));

      expect(process.exitCode).toBe(1);
    });

    it("sets exit code 0 on success", async () => {
      const provider = new ScriptedProvider([
        [
          { type: "text_delta", text: "ok" },
          { type: "finish", reason: "completed", rawReason: "end_turn" },
        ],
      ]);

      await runExec(await makeExecOptions({ provider, outputFormat: "text" }));

      expect(process.exitCode).toBeUndefined();
    });
  });
});
