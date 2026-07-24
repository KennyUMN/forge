import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile as fsReadFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionStore } from "../../src/session/session-store.js";
import { PermissionGate } from "../../src/permission/permission-gate.js";
import { autoAllowReadOnlyPolicy, askBeforeWriteOrBashPolicy } from "../../src/permission/permission-policies.js";
import { runTurn } from "../../src/agent/turn-orchestrator.js";
import { ToolRegistry } from "../../src/tool/tool-registry.js";
import { readFileTool } from "../../src/tools/read-file.js";
import { writeFileTool } from "../../src/tools/write-file.js";
import { bashTool } from "../../src/tools/bash.js";
import type { ModelProvider, StreamContext } from "../../src/provider/model-provider.js";
import type { StreamEvent } from "../../src/types/message.js";

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
  dir = await mkdtemp(join(tmpdir(), "forge-full-loop-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("full agent loop with real built-in tools", () => {
  it("writes a real file, reads it back, and lists the directory via bash, all through runTurn", async () => {
    const session = await SessionStore.create(dir);
    const registry = new ToolRegistry();
    registry.registerTool(writeFileTool);
    registry.registerTool(readFileTool);
    registry.registerTool(bashTool);

    const gate = new PermissionGate([autoAllowReadOnlyPolicy, askBeforeWriteOrBashPolicy], async () => true);

    const provider = new ScriptedProvider([
      [
        { type: "tool_call", id: "1", name: "write_file", input: { path: "notes.txt", content: "hello forge" } },
        { type: "finish", reason: "tool_calls", rawReason: "tool_use" },
      ],
      [
        { type: "tool_call", id: "2", name: "read_file", input: { path: "notes.txt" } },
        { type: "finish", reason: "tool_calls", rawReason: "tool_use" },
      ],
      [
        { type: "tool_call", id: "3", name: "bash", input: { command: "ls" } },
        { type: "finish", reason: "tool_calls", rawReason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "Done: wrote, read, and listed notes.txt" },
        { type: "finish", reason: "completed", rawReason: "end_turn" },
      ],
    ]);

    const result = await runTurn("create notes.txt, read it back, then list the directory", {
      provider,
      session,
      tools: registry.getAll(),
      gate,
      systemPrompt: "",
      toolContext: { cwd: dir },
    });

    expect(result.stoppedReason).toBe("completed");
    expect(result.finalText).toBe("Done: wrote, read, and listed notes.txt");

    // Real filesystem assertion -- not just checking session log entries.
    expect(await fsReadFile(join(dir, "notes.txt"), "utf8")).toBe("hello forge");

    const toolResults = session
      .getEntries()
      .filter((e) => e.type === "tool_result")
      .map((e) => e.payload as { output: string; isError: boolean });

    expect(toolResults.every((r) => r.isError === false)).toBe(true);
    expect(toolResults[1].output).toContain("hello forge"); // read_file result (tainted)
    expect(toolResults[2].output).toContain("notes.txt"); // bash `ls` result
  });
});
