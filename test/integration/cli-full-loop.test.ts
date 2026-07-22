import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile as fsReadFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildToolRegistry } from "../../src/cli/build-registry.js";
import { resolveSession } from "../../src/cli/resolve-session.js";
import { PermissionGate } from "../../src/permission/permission-gate.js";
import { DEFAULT_PERMISSION_POLICIES } from "../../src/permission/permission-policies.js";
import { runTurn } from "../../src/agent/turn-orchestrator.js";
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
  dir = await mkdtemp(join(tmpdir(), "forge-cli-loop-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("CLI wiring end-to-end (fake model, real everything else)", () => {
  it("resolves a session, builds the registry, and writes a real file through the CLI's own construction functions", async () => {
    const registryHandle = await buildToolRegistry([]);
    const session = await resolveSession(join(dir, ".forge", "sessions"), {});
    const gate = new PermissionGate(DEFAULT_PERMISSION_POLICIES, async () => true);

    const streamed: string[] = [];
    const provider = new ScriptedProvider([
      [
        { type: "tool_call", id: "1", name: "write_file", input: { path: "hello.txt", content: "hi from forge" } },
        { type: "finish", reason: "tool_calls", rawReason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "Wrote hello.txt" },
        { type: "finish", reason: "completed", rawReason: "end_turn" },
      ],
    ]);

    const result = await runTurn("create hello.txt", {
      provider,
      session,
      tools: registryHandle.registry.getAll(),
      gate,
      systemPrompt: "",
      toolContext: { cwd: dir },
      onTextDelta: (text) => streamed.push(text),
    });

    expect(result.stoppedReason).toBe("completed");
    expect(streamed.join("")).toBe("Wrote hello.txt");
    expect(await fsReadFile(join(dir, "hello.txt"), "utf8")).toBe("hi from forge");

    await registryHandle.close();
  });

  it("resuming a session by id continues the same conversation history", async () => {
    const sessionsDir = join(dir, ".forge", "sessions");
    const registryHandle = await buildToolRegistry([]);
    const gate = new PermissionGate(DEFAULT_PERMISSION_POLICIES, async () => true);

    const first = await resolveSession(sessionsDir, {});
    const providerOne = new ScriptedProvider([
      [{ type: "text_delta", text: "first reply" }, { type: "finish", reason: "completed", rawReason: "end_turn" }],
    ]);
    await runTurn("first message", {
      provider: providerOne,
      session: first,
      tools: registryHandle.registry.getAll(),
      gate,
      systemPrompt: "",
      toolContext: { cwd: dir },
    });

    const resumed = await resolveSession(sessionsDir, { resumeSessionId: first.sessionId });
    expect(resumed.getEntries()).toHaveLength(2); // user_message + assistant_message
    expect(resumed.getEntries()[0].payload).toEqual({ text: "first message" });

    await registryHandle.close();
  });
});
