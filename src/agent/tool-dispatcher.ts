import type { Tool, ToolExecutionContext } from "../tool/tool.js";
import type { PermissionGate } from "../permission/permission-gate.js";
import type { ToolCallRequest, ToolResult } from "../types/tool-call.js";
import type { TurnEventHandler } from "./turn-events.js";
import { isDoomLoop } from "./doom-loop.js";

export interface DispatchOutcome {
  results: ToolResult[];
  callHistory: ToolCallRequest[];
}

// Dispatches a batch of tool calls: for each one, checks the doom-loop guard,
// evaluates permission, and executes the tool if approved. Returns one
// ToolResult per call, in order, regardless of individual outcomes -- a
// denial, an unknown tool, or a thrown error never propagates as an
// exception, it becomes an error ToolResult so the model can see and adapt to
// it. Returns the updated call history rather than mutating the one it's
// given, so the Turn Orchestrator can thread it across multiple steps of the
// same turn immutably.
export async function dispatchToolCalls(
  calls: readonly ToolCallRequest[],
  tools: ReadonlyMap<string, Tool>,
  gate: PermissionGate,
  callHistory: readonly ToolCallRequest[],
  context: ToolExecutionContext,
  onEvent?: TurnEventHandler,
): Promise<DispatchOutcome> {
  const results: ToolResult[] = [];
  let history = [...callHistory];

  // Emitted for every result, whatever produced it, so a renderer showing a
  // pending call always sees it resolve -- a denial or an unknown tool is as
  // much an outcome as a successful execution.
  const record = (call: ToolCallRequest, result: ToolResult): void => {
    results.push(result);
    onEvent?.({ type: "tool_result", call, result });
  };

  for (const call of calls) {
    const forceAsk = isDoomLoop(history, call);
    history = [...history, call];
    onEvent?.({ type: "tool_call", call });

    const tool = tools.get(call.name);
    if (!tool) {
      record(call, { toolCallId: call.id, output: `Unknown tool: "${call.name}"`, isError: true });
      continue;
    }

    const permission = await gate.evaluate(call, { forceAsk });
    if (permission.decision === "deny") {
      record(call, { toolCallId: call.id, output: `Tool call denied: ${permission.reason}`, isError: true });
      continue;
    }

    try {
      const executed = await tool.execute(call.input, context);
      record(call, { toolCallId: call.id, output: executed.output, isError: executed.isError });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      record(call, { toolCallId: call.id, output: `Tool "${call.name}" threw: ${message}`, isError: true });
    }
  }

  return { results, callHistory: history };
}
