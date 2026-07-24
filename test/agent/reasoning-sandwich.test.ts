import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  reasoningForStep,
  reasoningToEffort,
  DEFAULT_SANDWICH,
} from "../../src/agent/reasoning-sandwich.js";
import type { ReasoningSandwichConfig } from "../../src/agent/reasoning-sandwich.js";
import { runTurn } from "../../src/agent/turn-orchestrator.js";
import { SessionStore } from "../../src/session/session-store.js";
import { PermissionGate } from "../../src/permission/permission-gate.js";
import { autoAllowReadOnlyPolicy } from "../../src/permission/permission-policies.js";
import type { Tool, ToolExecutionContext } from "../../src/tool/tool.js";
import type { ModelProvider, StreamContext } from "../../src/provider/model-provider.js";
import type { StreamEvent, ThinkingEffort } from "../../src/types/message.js";

describe("reasoningForStep", () => {
  it("returns planSteps level for the first step", () => {
    expect(reasoningForStep(1, 5, false, DEFAULT_SANDWICH)).toBe("high");
  });

  it("returns default level for middle steps", () => {
    expect(reasoningForStep(2, 5, false, DEFAULT_SANDWICH)).toBe("medium");
    expect(reasoningForStep(3, 5, false, DEFAULT_SANDWICH)).toBe("medium");
    expect(reasoningForStep(4, 5, false, DEFAULT_SANDWICH)).toBe("medium");
  });

  it("returns verifySteps level for verification steps", () => {
    expect(reasoningForStep(3, 5, true, DEFAULT_SANDWICH)).toBe("high");
  });

  it("prioritizes verification over plan on step 1 if both apply", () => {
    const config: ReasoningSandwichConfig = { default: "low", planSteps: "medium", verifySteps: "high" };
    expect(reasoningForStep(1, 5, true, config)).toBe("high");
  });

  it("respects custom config overrides", () => {
    const config: ReasoningSandwichConfig = { default: "low", planSteps: "medium", verifySteps: "high" };
    expect(reasoningForStep(1, 3, false, config)).toBe("medium");
    expect(reasoningForStep(2, 3, false, config)).toBe("low");
    expect(reasoningForStep(2, 3, true, config)).toBe("high");
  });
});

describe("reasoningToEffort", () => {
  it("maps low to low", () => {
    expect(reasoningToEffort("low")).toBe("low");
  });

  it("maps medium to high", () => {
    expect(reasoningToEffort("medium")).toBe("high");
  });

  it("maps high to max", () => {
    expect(reasoningToEffort("high")).toBe("max");
  });
});

function makeTool(name: string, execute: Tool["execute"]): Tool {
  return { name, description: name, parameters: {}, execute };
}

class ThinkingTrackerProvider implements ModelProvider {
  readonly name = "thinking-tracker";
  readonly efforts: ThinkingEffort[] = [];
  private readonly callCounter: { count: number };

  constructor(
    private readonly script: StreamEvent[][],
    callCounter?: { count: number },
  ) {
    this.callCounter = callCounter ?? { count: 0 };
  }

  async *stream(_context: StreamContext): AsyncIterable<StreamEvent> {
    const batch = this.script[Math.min(this.callCounter.count, this.script.length - 1)];
    this.callCounter.count++;
    for (const event of batch) yield event;
  }

  withThinking(effort: ThinkingEffort): ThinkingTrackerProvider {
    this.efforts.push(effort);
    return new ThinkingTrackerProvider(this.script, this.callCounter);
  }
}

class NoThinkingProvider implements ModelProvider {
  readonly name = "no-thinking";
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
  dir = await mkdtemp(join(tmpdir(), "forge-sandwich-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("reasoning sandwich orchestrator integration", () => {
  it("applies high reasoning on step 1 and medium on subsequent steps", async () => {
    const session = await SessionStore.create(dir);
    const tools = new Map([["noop", makeTool("noop", async () => ({ output: "ok", isError: false }))]]);
    const gate = new PermissionGate([autoAllowReadOnlyPolicy], vi.fn());

    const provider = new ThinkingTrackerProvider([
      [
        { type: "tool_call", id: "1", name: "noop", input: {} },
        { type: "finish", reason: "tool_calls", rawReason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "done" },
        { type: "finish", reason: "completed", rawReason: "end_turn" },
      ],
    ]);

    await runTurn("do something", {
      provider,
      session,
      tools,
      gate,
      systemPrompt: "",
      toolContext: { cwd: dir },
      reasoningSandwich: DEFAULT_SANDWICH,
    });

    expect(provider.efforts).toEqual(["max", "high"]);
  });

  it("does not call withThinking when no sandwich config is provided", async () => {
    const session = await SessionStore.create(dir);
    const tools = new Map<string, Tool>();
    const gate = new PermissionGate([autoAllowReadOnlyPolicy], vi.fn());

    const provider = new ThinkingTrackerProvider([
      [
        { type: "text_delta", text: "hello" },
        { type: "finish", reason: "completed", rawReason: "end_turn" },
      ],
    ]);

    const result = await runTurn("hi", {
      provider,
      session,
      tools,
      gate,
      systemPrompt: "",
      toolContext: { cwd: dir },
    });

    expect(provider.efforts).toEqual([]);
    expect(result.finalText).toBe("hello");
  });

  it("skips sandwich gracefully when provider lacks withThinking", async () => {
    const session = await SessionStore.create(dir);
    const tools = new Map<string, Tool>();
    const gate = new PermissionGate([autoAllowReadOnlyPolicy], vi.fn());

    const provider = new NoThinkingProvider([
      [
        { type: "text_delta", text: "response" },
        { type: "finish", reason: "completed", rawReason: "end_turn" },
      ],
    ]);

    const result = await runTurn("hi", {
      provider,
      session,
      tools,
      gate,
      systemPrompt: "",
      toolContext: { cwd: dir },
      reasoningSandwich: DEFAULT_SANDWICH,
    });

    expect(result.finalText).toBe("response");
    expect(result.stoppedReason).toBe("completed");
  });

  it("applies uniform reasoning when reasoningLevel is set", async () => {
    const session = await SessionStore.create(dir);
    const tools = new Map([["noop", makeTool("noop", async () => ({ output: "ok", isError: false }))]]);
    const gate = new PermissionGate([autoAllowReadOnlyPolicy], vi.fn());

    const provider = new ThinkingTrackerProvider([
      [
        { type: "tool_call", id: "1", name: "noop", input: {} },
        { type: "finish", reason: "tool_calls", rawReason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "done" },
        { type: "finish", reason: "completed", rawReason: "end_turn" },
      ],
    ]);

    await runTurn("do something", {
      provider,
      session,
      tools,
      gate,
      systemPrompt: "",
      toolContext: { cwd: dir },
      reasoningLevel: "low",
    });

    expect(provider.efforts).toEqual(["low", "low"]);
  });
});
