import type { ModelProvider } from "../provider/model-provider.js";
import type { SessionStore } from "../session/session-store.js";
import type { Tool, ToolExecutionContext } from "../tool/tool.js";
import type { PermissionGate } from "../permission/permission-gate.js";
import type { ToolCallRequest, ToolResult } from "../types/tool-call.js";
import type { ToolSchema } from "../types/message.js";
import { sessionEntriesToMessages } from "./session-bridge.js";
import { compactEntries } from "./compaction.js";
import type { CompactionConfig } from "./compaction.js";
import { executeStep } from "./step-executor.js";
import { dispatchToolCalls } from "./tool-dispatcher.js";
import type { CheckpointFn } from "./tool-dispatcher.js";
import { createBudgetTracker } from "./budget.js";
import type { BudgetConfig } from "./budget.js";
import type { TurnEventHandler } from "./turn-events.js";
import { runVerification, formatVerificationFailure } from "./verification-gate.js";
import type { VerificationConfig } from "./verification-gate.js";
import { reasoningForStep, reasoningToEffort } from "./reasoning-sandwich.js";
import type { ReasoningLevel, ReasoningSandwichConfig } from "./reasoning-sandwich.js";

const DEFAULT_MAX_STEPS = 50;

export interface TurnOrchestratorOptions {
  provider: ModelProvider;
  session: SessionStore;
  tools: ReadonlyMap<string, Tool>;
  gate: PermissionGate;
  systemPrompt: string;
  toolContext: ToolExecutionContext;
  maxSteps?: number;
  budget?: BudgetConfig;
  compaction?: CompactionConfig;
  verification?: VerificationConfig;
  reasoningSandwich?: ReasoningSandwichConfig;
  reasoningLevel?: ReasoningLevel;
  checkpoint?: CheckpointFn;
  onEvent?: TurnEventHandler;
  // Aborted when the user interrupts. Threaded into the provider stream and
  // the tool context so an interrupt reaches whatever is actually blocking,
  // and checked between steps so the loop stops rather than starting another
  // model round-trip after the request it was waiting on was cancelled.
  signal?: AbortSignal;
}

export type TurnStoppedReason = "completed" | "max_steps_reached" | "aborted" | "budget_exceeded" | "verification_failed";

export interface TurnResult {
  finalText: string;
  stepsExecuted: number;
  stoppedReason: TurnStoppedReason;
}

function toolsToSchemas(tools: ReadonlyMap<string, Tool>): ToolSchema[] {
  return [...tools.values()].map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));
}

function failTruncatedToolCalls(calls: readonly ToolCallRequest[]): ToolResult[] {
  return calls.map((call) => ({
    toolCallId: call.id,
    output:
      "Tool call not executed: the model's response was truncated before its arguments could be safely determined.",
    isError: true,
  }));
}

// The outer loop of one user turn: appends the user's message, repeatedly
// calls the Step Executor for a model round-trip, and -- when the model
// requests tool calls -- either fails them (a truncated response) or routes
// them through the Tool Dispatcher, appending every step's results to the
// session log as it goes. Stops when the model returns a plain text response
// with no further tool calls, or when maxSteps is exhausted as a safety bound
// against a runaway tool-calling loop.
export async function runTurn(userText: string, options: TurnOrchestratorOptions): Promise<TurnResult> {
  const { provider, session, tools, gate, systemPrompt, toolContext, onEvent, signal, budget, compaction, verification, checkpoint, reasoningSandwich, reasoningLevel } = options;
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
  const toolSchemas = toolsToSchemas(tools);
  const tracker = budget ? createBudgetTracker(budget) : undefined;
  const maxRetries = verification?.maxRetries ?? 3;

  await session.append("user_message", { text: userText });

  // The tool context the caller supplied may predate the turn, so the turn's
  // own signal is what tools must see -- otherwise an interrupt reaches the
  // provider but not the bash command it is waiting on.
  const contextWithSignal = signal ? { ...toolContext, signal } : toolContext;

  let callHistory: ToolCallRequest[] = [];
  let verificationAttempt = 0;

  for (let step = 1; step <= maxSteps; step++) {
    if (signal?.aborted) {
      return { finalText: "", stepsExecuted: step - 1, stoppedReason: "aborted" };
    }
    onEvent?.({ type: "step_start", step });

    const rawEntries = session.getEntries();
    let messages;
    if (compaction) {
      const compactResult = compactEntries(rawEntries, compaction);
      if (compactResult.compacted) {
        const entriesCompacted = compactResult.entries.filter(
          (e, i) => e !== rawEntries[i],
        ).length;
        onEvent?.({
          type: "context_compacted",
          originalTokens: compactResult.originalTokenEstimate,
          compactedTokens: compactResult.compactedTokenEstimate,
          entriesCompacted,
        });
      }
      messages = sessionEntriesToMessages(compactResult.entries);
    } else {
      messages = sessionEntriesToMessages(rawEntries);
    }

    let stepProvider = provider;
    if (reasoningLevel && provider.withThinking) {
      stepProvider = provider.withThinking(reasoningToEffort(reasoningLevel));
    } else if (reasoningSandwich && provider.withThinking) {
      const level = reasoningForStep(step, maxSteps, verificationAttempt > 0, reasoningSandwich);
      stepProvider = provider.withThinking(reasoningToEffort(level));
    }

    const stepResult = await executeStep(
      stepProvider,
      { systemPrompt, messages, tools: toolSchemas, signal },
      { onEvent },
    );
    onEvent?.({ type: "step_end", step, finishReason: stepResult.finishReason, usage: stepResult.usage });

    if (tracker && stepResult.usage) {
      const state = tracker.record(stepResult.usage);
      const verdict = tracker.check();
      if (verdict.action === "halt") {
        onEvent?.({ type: "budget_exceeded", state, reason: verdict.reason });
        return { finalText: stepResult.text, stepsExecuted: step, stoppedReason: "budget_exceeded" };
      }
    }

    if (stepResult.text) {
      await session.append("assistant_message", { text: stepResult.text });
    }

    if (stepResult.toolCalls.length === 0) {
      if (!verification || !verification.command) {
        return { finalText: stepResult.text, stepsExecuted: step, stoppedReason: "completed" };
      }

      verificationAttempt++;
      onEvent?.({ type: "verification_start", command: verification.command, attempt: verificationAttempt });

      const verdict = await runVerification(verification, { cwd: toolContext.cwd, signal }, verificationAttempt);

      if (verdict.action === "pass") {
        onEvent?.({ type: "verification_pass" });
        return { finalText: stepResult.text, stepsExecuted: step, stoppedReason: "completed" };
      }

      if (verdict.action === "skip") {
        return { finalText: stepResult.text, stepsExecuted: step, stoppedReason: "completed" };
      }

      onEvent?.({ type: "verification_fail", output: verdict.output, attempt: verificationAttempt, maxRetries });

      if (verificationAttempt >= maxRetries) {
        return { finalText: stepResult.text, stepsExecuted: step, stoppedReason: "verification_failed" };
      }

      const feedback = formatVerificationFailure(verification, verdict, maxRetries);
      await session.append("user_message", { text: feedback });
      continue;
    }

    for (const call of stepResult.toolCalls) {
      await session.append("tool_call", call);
    }

    let results: ToolResult[];
    if (stepResult.finishReason === "truncated") {
      results = failTruncatedToolCalls(stepResult.toolCalls);
    } else {
      const outcome = await dispatchToolCalls(
        stepResult.toolCalls,
        tools,
        gate,
        callHistory,
        contextWithSignal,
        onEvent,
        checkpoint,
      );
      results = outcome.results;
      callHistory = outcome.callHistory;
    }

    for (const result of results) {
      await session.append("tool_result", result);
    }
  }

  return { finalText: "", stepsExecuted: maxSteps, stoppedReason: "max_steps_reached" };
}
