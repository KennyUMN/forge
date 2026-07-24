import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBudgetTracker } from "../../src/agent/budget.js";
import { runTurn } from "../../src/agent/turn-orchestrator.js";
import { SessionStore } from "../../src/session/session-store.js";
import { PermissionGate } from "../../src/permission/permission-gate.js";
import type { BudgetConfig } from "../../src/agent/budget.js";
import type { TurnEvent } from "../../src/agent/turn-events.js";
import type { ModelProvider, StreamContext } from "../../src/provider/model-provider.js";
import type { StreamEvent } from "../../src/types/message.js";
import type { Tool, ToolExecutionContext } from "../../src/tool/tool.js";

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

describe("createBudgetTracker", () => {
  it("accumulates usage across multiple records", () => {
    const tracker = createBudgetTracker({ maxTotalTokens: 100_000 });

    tracker.record({ inputTokens: 100, outputTokens: 50 });
    tracker.record({ inputTokens: 200, outputTokens: 100 });

    const state = tracker.state();
    expect(state.inputTokensUsed).toBe(300);
    expect(state.outputTokensUsed).toBe(150);
    expect(state.totalTokensUsed).toBe(450);
  });

  it("returns a new state object on each call (immutability)", () => {
    const tracker = createBudgetTracker({ maxTotalTokens: 100_000 });

    const s1 = tracker.record({ inputTokens: 10, outputTokens: 5 });
    const s2 = tracker.record({ inputTokens: 20, outputTokens: 10 });

    expect(s1).not.toBe(s2);
    expect(s1.totalTokensUsed).toBe(15);
    expect(s2.totalTokensUsed).toBe(45);
  });

  it("continues when under all limits", () => {
    const tracker = createBudgetTracker({
      maxInputTokens: 1000,
      maxOutputTokens: 500,
      maxTotalTokens: 1500,
    });

    tracker.record({ inputTokens: 100, outputTokens: 50 });

    expect(tracker.check()).toEqual({ action: "continue" });
  });

  it("halts when maxInputTokens is exceeded", () => {
    const tracker = createBudgetTracker({ maxInputTokens: 200 });

    tracker.record({ inputTokens: 150, outputTokens: 10 });
    tracker.record({ inputTokens: 100, outputTokens: 10 });

    const verdict = tracker.check();
    expect(verdict.action).toBe("halt");
    if (verdict.action === "halt") {
      expect(verdict.reason).toContain("input");
    }
  });

  it("halts when maxOutputTokens is exceeded", () => {
    const tracker = createBudgetTracker({ maxOutputTokens: 100 });

    tracker.record({ inputTokens: 10, outputTokens: 60 });
    tracker.record({ inputTokens: 10, outputTokens: 60 });

    const verdict = tracker.check();
    expect(verdict.action).toBe("halt");
    if (verdict.action === "halt") {
      expect(verdict.reason).toContain("output");
    }
  });

  it("halts when maxTotalTokens is exceeded", () => {
    const tracker = createBudgetTracker({ maxTotalTokens: 100 });

    tracker.record({ inputTokens: 40, outputTokens: 30 });
    tracker.record({ inputTokens: 20, outputTokens: 20 });

    const verdict = tracker.check();
    expect(verdict.action).toBe("halt");
    if (verdict.action === "halt") {
      expect(verdict.reason).toContain("total");
    }
  });

  it("halts when maxBudgetUsd is exceeded using default pricing", () => {
    const tracker = createBudgetTracker({ maxBudgetUsd: 0.01 });

    // Default pricing: $5/M input, $5/M output
    // 2000 input tokens = $0.01, 100 output = $0.0005 => total > $0.01
    tracker.record({ inputTokens: 2000, outputTokens: 100 });

    const verdict = tracker.check();
    expect(verdict.action).toBe("halt");
    if (verdict.action === "halt") {
      expect(verdict.reason).toContain("budget");
    }
  });

  it("estimates cost with custom pricing", () => {
    const tracker = createBudgetTracker({
      maxBudgetUsd: 1.0,
      pricePerMillionInput: 3,
      pricePerMillionOutput: 15,
    });

    tracker.record({ inputTokens: 1_000_000, outputTokens: 0 });

    const state = tracker.state();
    expect(state.estimatedCostUsd).toBeCloseTo(3.0);
    expect(tracker.check().action).toBe("halt");
  });

  it("always continues with no config limits", () => {
    const tracker = createBudgetTracker({});

    tracker.record({ inputTokens: 999_999_999, outputTokens: 999_999_999 });

    expect(tracker.check()).toEqual({ action: "continue" });
  });

  it("continues when usage is exactly at the limit", () => {
    const tracker = createBudgetTracker({ maxTotalTokens: 100 });

    tracker.record({ inputTokens: 60, outputTokens: 40 });

    expect(tracker.check()).toEqual({ action: "continue" });
  });
});

describe("runTurn budget integration", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "forge-budget-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("stops the loop when budget is exceeded and emits budget_exceeded event", async () => {
    const session = await SessionStore.create(dir);
    const tools = new Map([["bash", makeTool("bash", async () => ({ output: "ok", isError: false }))]]);
    const gate = new PermissionGate([{ name: "allow-all", evaluate: () => "allow" as const }], vi.fn());

    const provider = new ScriptedProvider([
      [
        { type: "tool_call", id: "1", name: "bash", input: { command: "ls" } },
        { type: "finish", reason: "tool_calls", rawReason: "tool_use", usage: { inputTokens: 500, outputTokens: 200 } },
      ],
      [
        { type: "tool_call", id: "2", name: "bash", input: { command: "ls" } },
        { type: "finish", reason: "tool_calls", rawReason: "tool_use", usage: { inputTokens: 500, outputTokens: 200 } },
      ],
      [
        { type: "text_delta", text: "should not reach here" },
        { type: "finish", reason: "completed", rawReason: "end_turn", usage: { inputTokens: 100, outputTokens: 50 } },
      ],
    ]);

    const events: TurnEvent[] = [];
    const result = await runTurn("loop", {
      provider,
      session,
      tools,
      gate,
      systemPrompt: "",
      toolContext: { cwd: dir },
      maxSteps: 10,
      budget: { maxTotalTokens: 1000 },
      onEvent: (e) => events.push(e),
    });

    expect(result.stoppedReason).toBe("budget_exceeded");
    expect(result.stepsExecuted).toBe(2);

    const budgetEvent = events.find((e) => e.type === "budget_exceeded");
    expect(budgetEvent).toBeDefined();
    if (budgetEvent && budgetEvent.type === "budget_exceeded") {
      expect(budgetEvent.state.totalTokensUsed).toBe(1400);
      expect(budgetEvent.reason).toContain("total");
    }
  });

  it("completes normally when budget is not exceeded", async () => {
    const session = await SessionStore.create(dir);
    const tools = new Map([["bash", makeTool("bash", async () => ({ output: "ok", isError: false }))]]);
    const gate = new PermissionGate([{ name: "allow-all", evaluate: () => "allow" as const }], vi.fn());

    const provider = new ScriptedProvider([
      [
        { type: "tool_call", id: "1", name: "bash", input: { command: "ls" } },
        { type: "finish", reason: "tool_calls", rawReason: "tool_use", usage: { inputTokens: 100, outputTokens: 50 } },
      ],
      [
        { type: "text_delta", text: "done" },
        { type: "finish", reason: "completed", rawReason: "end_turn", usage: { inputTokens: 100, outputTokens: 50 } },
      ],
    ]);

    const result = await runTurn("do it", {
      provider,
      session,
      tools,
      gate,
      systemPrompt: "",
      toolContext: { cwd: dir },
      budget: { maxTotalTokens: 10_000 },
    });

    expect(result.stoppedReason).toBe("completed");
    expect(result.finalText).toBe("done");
  });

  it("stops on USD budget exceeded", async () => {
    const session = await SessionStore.create(dir);
    const tools = new Map([["bash", makeTool("bash", async () => ({ output: "ok", isError: false }))]]);
    const gate = new PermissionGate([{ name: "allow-all", evaluate: () => "allow" as const }], vi.fn());

    const provider = new ScriptedProvider([
      [
        { type: "tool_call", id: "1", name: "bash", input: { command: "ls" } },
        { type: "finish", reason: "tool_calls", rawReason: "tool_use", usage: { inputTokens: 5000, outputTokens: 1000 } },
      ],
      [
        { type: "text_delta", text: "unreachable" },
        { type: "finish", reason: "completed", rawReason: "end_turn" },
      ],
    ]);

    const events: TurnEvent[] = [];
    const result = await runTurn("expensive", {
      provider,
      session,
      tools,
      gate,
      systemPrompt: "",
      toolContext: { cwd: dir },
      budget: { maxBudgetUsd: 0.01, pricePerMillionInput: 3, pricePerMillionOutput: 15 },
      onEvent: (e) => events.push(e),
    });

    // 5000 input * $3/M = $0.015, 1000 output * $15/M = $0.015 => $0.03 > $0.01
    expect(result.stoppedReason).toBe("budget_exceeded");
    expect(result.stepsExecuted).toBe(1);

    const budgetEvent = events.find((e) => e.type === "budget_exceeded");
    expect(budgetEvent).toBeDefined();
  });
});
