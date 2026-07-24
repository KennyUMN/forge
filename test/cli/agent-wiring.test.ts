import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAgentFns } from "../../src/cli/agent-wiring.js";
import { SessionStore } from "../../src/session/session-store.js";
import { PermissionGate } from "../../src/permission/permission-gate.js";
import { autoAllowReadOnlyPolicy } from "../../src/permission/permission-policies.js";
import type { ModelProvider, StreamContext } from "../../src/provider/model-provider.js";
import type { StreamEvent } from "../../src/types/message.js";

// A provider that finishes in one step with a fixed final text, so a nested
// turn returns immediately without any tool calls.
class ScriptedProvider implements ModelProvider {
  readonly name = "scripted";
  constructor(private readonly text: string) {}
  async *stream(_context: StreamContext): AsyncIterable<StreamEvent> {
    yield { type: "text_delta", text: this.text };
    yield { type: "finish", reason: "completed", rawReason: "end_turn", usage: { inputTokens: 1, outputTokens: 1 } };
  }
}

describe("buildAgentFns", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "forge-wiring-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function fnsFor(text: string) {
    const session = await SessionStore.create(dir);
    return buildAgentFns({
      provider: new ScriptedProvider(text),
      tools: new Map(),
      session,
      gate: new PermissionGate([autoAllowReadOnlyPolicy], async () => false),
      systemPrompt: "system",
      cwd: dir,
    });
  }

  it("populates all three multi-agent callbacks the tools depend on", async () => {
    const fns = await fnsFor("done");
    expect(typeof fns.subagent).toBe("function");
    expect(typeof fns.parallelDispatch).toBe("function");
    expect(typeof fns.bestOfN).toBe("function");
  });

  it("subagent runs a nested turn and returns its summary", async () => {
    const fns = await fnsFor("subagent summary");
    const result = await fns.subagent("do a thing", { mode: "advisory" });
    expect(result.summary).toBe("subagent summary");
  });

  it("parallelDispatch runs advisory tasks through real subagents in the parent cwd", async () => {
    const fns = await fnsFor("ok");
    const results = await fns.parallelDispatch(
      [
        { id: "a1", task: "task one", mode: "advisory", useWorktree: false },
        { id: "a2", task: "task two", mode: "advisory", useWorktree: false },
      ],
      dir,
    );

    expect(results.map((r) => r.state)).toEqual(["succeeded", "succeeded"]);
    expect(results[0]!.summary).toBe("ok");
  });
});
