import type { ModelProvider } from "../provider/model-provider.js";
import type { SessionStore } from "../session/session-store.js";
import type { Tool, ToolExecutionContext } from "../tool/tool.js";
import type { PermissionGate } from "../permission/permission-gate.js";
import type { ToolCallRequest, ToolResult } from "../types/tool-call.js";
import type { ToolSchema } from "../types/message.js";
import { sessionEntriesToMessages } from "./session-bridge.js";
import { executeStep } from "./step-executor.js";
import { dispatchToolCalls } from "./tool-dispatcher.js";

const DEFAULT_MAX_STEPS = 50;

export interface TurnOrchestratorOptions {
  provider: ModelProvider;
  session: SessionStore;
  tools: ReadonlyMap<string, Tool>;
  gate: PermissionGate;
  systemPrompt: string;
  toolContext: ToolExecutionContext;
  maxSteps?: number;
}

export type TurnStoppedReason = "completed" | "max_steps_reached";

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
  const { provider, session, tools, gate, systemPrompt, toolContext } = options;
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
  const toolSchemas = toolsToSchemas(tools);

  await session.append("user_message", { text: userText });

  let callHistory: ToolCallRequest[] = [];

  for (let step = 1; step <= maxSteps; step++) {
    const messages = sessionEntriesToMessages(session.getEntries());
    const stepResult = await executeStep(provider, { systemPrompt, messages, tools: toolSchemas });

    if (stepResult.text) {
      await session.append("assistant_message", { text: stepResult.text });
    }

    if (stepResult.toolCalls.length === 0) {
      return { finalText: stepResult.text, stepsExecuted: step, stoppedReason: "completed" };
    }

    for (const call of stepResult.toolCalls) {
      await session.append("tool_call", call);
    }

    let results: ToolResult[];
    if (stepResult.finishReason === "truncated") {
      results = failTruncatedToolCalls(stepResult.toolCalls);
    } else {
      const outcome = await dispatchToolCalls(stepResult.toolCalls, tools, gate, callHistory, toolContext);
      results = outcome.results;
      callHistory = outcome.callHistory;
    }

    for (const result of results) {
      await session.append("tool_result", result);
    }
  }

  return { finalText: "", stepsExecuted: maxSteps, stoppedReason: "max_steps_reached" };
}
