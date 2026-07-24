import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runVerification, detectVerificationCommand } from "../../src/agent/verification-gate.js";
import type { VerificationConfig } from "../../src/agent/verification-gate.js";
import { runTurn } from "../../src/agent/turn-orchestrator.js";
import { SessionStore } from "../../src/session/session-store.js";
import { PermissionGate } from "../../src/permission/permission-gate.js";
import type { Tool, ToolExecutionContext } from "../../src/tool/tool.js";
import type { ModelProvider, StreamContext } from "../../src/provider/model-provider.js";
import type { StreamEvent } from "../../src/types/message.js";
import type { TurnEvent } from "../../src/agent/turn-events.js";

function makeTool(name: string, execute: Tool["execute"]): Tool {
  return { name, description: name, parameters: {}, execute };
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
  dir = await mkdtemp(join(tmpdir(), "forge-vgate-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("runVerification", () => {
  it("returns pass when the command exits 0", async () => {
    const config: VerificationConfig = { command: "echo ok" };
    const verdict = await runVerification(config, { cwd: dir });
    expect(verdict).toEqual({ action: "pass" });
  });

  it("returns fail with output when the command exits non-zero", async () => {
    const config: VerificationConfig = { command: "echo 'test failed' && exit 1" };
    const verdict = await runVerification(config, { cwd: dir });
    expect(verdict.action).toBe("fail");
    if (verdict.action === "fail") {
      expect(verdict.output).toContain("test failed");
      expect(verdict.attempt).toBe(1);
    }
  });

  it("returns skip when config has an empty command", async () => {
    const config: VerificationConfig = { command: "" };
    const verdict = await runVerification(config, { cwd: dir });
    expect(verdict).toEqual({ action: "skip", reason: "empty command" });
  });

  it("returns fail on timeout", async () => {
    const config: VerificationConfig = { command: "sleep 10", timeout: 200 };
    const verdict = await runVerification(config, { cwd: dir });
    expect(verdict.action).toBe("fail");
    if (verdict.action === "fail") {
      expect(verdict.output).toContain("timed out");
    }
  });

  it("bounds output to the last 100 lines", async () => {
    const lines = Array.from({ length: 150 }, (_, i) => `line ${i + 1}`).join("\\n");
    const config: VerificationConfig = { command: `printf '${lines}' && exit 1` };
    const verdict = await runVerification(config, { cwd: dir });
    expect(verdict.action).toBe("fail");
    if (verdict.action === "fail") {
      const outputLines = verdict.output.split("\n");
      expect(outputLines.length).toBeLessThanOrEqual(100);
      expect(verdict.output).toContain("line 150");
      expect(verdict.output).not.toContain("line 50\n");
    }
  });

  it("respects the attempt parameter", async () => {
    const config: VerificationConfig = { command: "exit 1" };
    const verdict = await runVerification(config, { cwd: dir }, 2);
    expect(verdict.action).toBe("fail");
    if (verdict.action === "fail") {
      expect(verdict.attempt).toBe(2);
    }
  });
});

describe("detectVerificationCommand", () => {
  it("returns npm test when package.json has a test script", async () => {
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ scripts: { test: "vitest run" } }),
    );
    const cmd = await detectVerificationCommand(dir);
    expect(cmd).toBe("npm test");
  });

  it("returns npx tsc --noEmit when tsconfig.json exists but no test script", async () => {
    await writeFile(join(dir, "package.json"), JSON.stringify({ scripts: {} }));
    await writeFile(join(dir, "tsconfig.json"), "{}");
    const cmd = await detectVerificationCommand(dir);
    expect(cmd).toBe("npx tsc --noEmit");
  });

  it("returns null when neither package.json nor tsconfig.json exist", async () => {
    const cmd = await detectVerificationCommand(dir);
    expect(cmd).toBeNull();
  });

  it("returns npx tsc --noEmit when package.json has no scripts field", async () => {
    await writeFile(join(dir, "package.json"), JSON.stringify({ name: "x" }));
    await writeFile(join(dir, "tsconfig.json"), "{}");
    const cmd = await detectVerificationCommand(dir);
    expect(cmd).toBe("npx tsc --noEmit");
  });
});

describe("verification gate orchestrator integration", () => {
  it("blocks completion on failure, injects feedback, and completes when verification passes", async () => {
    const session = await SessionStore.create(dir);
    const tools = new Map<string, Tool>();
    const gate = new PermissionGate([{ name: "allow-all", evaluate: () => "allow" as const }], vi.fn());

    const provider = new ScriptedProvider([
      [
        { type: "text_delta", text: "I think I'm done" },
        { type: "finish", reason: "completed", rawReason: "end_turn" },
      ],
      [
        { type: "text_delta", text: "Fixed it now" },
        { type: "finish", reason: "completed", rawReason: "end_turn" },
      ],
    ]);

    const marker = join(dir, ".verified");
    const events: TurnEvent[] = [];

    const result = await runTurn("do the task", {
      provider,
      session,
      tools,
      gate,
      systemPrompt: "",
      toolContext: { cwd: dir },
      verification: {
        command: `test -f "${marker}" || (touch "${marker}" && exit 1)`,
        maxRetries: 3,
      },
      onEvent: (e) => events.push(e),
    });

    expect(result.stoppedReason).toBe("completed");
    expect(result.finalText).toBe("Fixed it now");

    const userEntries = session.getEntries().filter((e) => e.type === "user_message");
    expect(userEntries.length).toBe(2);
    const syntheticPayload = userEntries[1].payload as { text: string };
    expect(syntheticPayload.text).toContain("[VERIFICATION FAILED]");
    expect(syntheticPayload.text).toContain("Attempt: 1/3");
  });

  it("stops with verification_failed when maxRetries is exhausted", async () => {
    const session = await SessionStore.create(dir);
    const tools = new Map<string, Tool>();
    const gate = new PermissionGate([{ name: "allow-all", evaluate: () => "allow" as const }], vi.fn());

    const provider = new ScriptedProvider([
      [
        { type: "text_delta", text: "done attempt 1" },
        { type: "finish", reason: "completed", rawReason: "end_turn" },
      ],
      [
        { type: "text_delta", text: "done attempt 2" },
        { type: "finish", reason: "completed", rawReason: "end_turn" },
      ],
    ]);

    const events: TurnEvent[] = [];

    const result = await runTurn("do the task", {
      provider,
      session,
      tools,
      gate,
      systemPrompt: "",
      toolContext: { cwd: dir },
      verification: {
        command: "exit 1",
        maxRetries: 2,
      },
      onEvent: (e) => events.push(e),
    });

    expect(result.stoppedReason).toBe("verification_failed");
    expect(result.finalText).toBe("done attempt 2");

    const verificationFailEvents = events.filter((e) => e.type === "verification_fail");
    expect(verificationFailEvents.length).toBe(2);
  });

  it("emits verification_start and verification_pass events on success", async () => {
    const session = await SessionStore.create(dir);
    const tools = new Map<string, Tool>();
    const gate = new PermissionGate([{ name: "allow-all", evaluate: () => "allow" as const }], vi.fn());

    const provider = new ScriptedProvider([
      [
        { type: "text_delta", text: "all done" },
        { type: "finish", reason: "completed", rawReason: "end_turn" },
      ],
    ]);

    const events: TurnEvent[] = [];

    const result = await runTurn("do the task", {
      provider,
      session,
      tools,
      gate,
      systemPrompt: "",
      toolContext: { cwd: dir },
      verification: { command: "echo ok" },
      onEvent: (e) => events.push(e),
    });

    expect(result.stoppedReason).toBe("completed");
    const startEvents = events.filter((e) => e.type === "verification_start");
    const passEvents = events.filter((e) => e.type === "verification_pass");
    expect(startEvents.length).toBe(1);
    expect(passEvents.length).toBe(1);
  });

  it("does not run verification when not configured", async () => {
    const session = await SessionStore.create(dir);
    const tools = new Map<string, Tool>();
    const gate = new PermissionGate([{ name: "allow-all", evaluate: () => "allow" as const }], vi.fn());

    const provider = new ScriptedProvider([
      [
        { type: "text_delta", text: "done" },
        { type: "finish", reason: "completed", rawReason: "end_turn" },
      ],
    ]);

    const events: TurnEvent[] = [];

    const result = await runTurn("do the task", {
      provider,
      session,
      tools,
      gate,
      systemPrompt: "",
      toolContext: { cwd: dir },
      onEvent: (e) => events.push(e),
    });

    expect(result.stoppedReason).toBe("completed");
    const verificationEvents = events.filter((e) => e.type.startsWith("verification"));
    expect(verificationEvents.length).toBe(0);
  });
});
