import type { Tool, ToolExecutionContext } from "../tool/tool.js";
import type { PermissionGate } from "../permission/permission-gate.js";
import type { ToolCallRequest, ToolResult } from "../types/tool-call.js";
import type { TurnEventHandler } from "./turn-events.js";
import type { HookConfig } from "../hooks/hooks.js";
import { checkDoomLoop } from "./doom-loop.js";
import { taintToolOutput } from "../tool/taint.js";
import { boundOutputBytes } from "../tool/output-bounds.js";
import { matchesHook, runHook } from "../hooks/hooks.js";

export interface DispatchOutcome {
  results: ToolResult[];
  callHistory: ToolCallRequest[];
}

export type CheckpointFn = (toolName: string, entryId: string) => Promise<void>;

const MUTATING_TOOLS: ReadonlySet<string> = new Set(["write_file", "edit_file", "bash"]);

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
  checkpoint?: CheckpointFn,
  hooks?: HookConfig[],
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
    const verdict = checkDoomLoop(history, results, call);
    const forceAsk = verdict.action === "block";
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

    if (hooks && hooks.length > 0) {
      const hookCtx = { toolName: call.name, input: call.input, cwd: context.cwd };
      const preHooks = hooks.filter((h) => h.event === "pre_tool" && matchesHook(h, call.name, call.input));
      let blocked = false;
      for (const hook of preHooks) {
        const result = await runHook(hook, hookCtx);
        if (result.blocked) {
          record(call, { toolCallId: call.id, output: `Blocked by hook: ${result.stderr || `exit code ${result.exitCode}`}`, isError: true });
          blocked = true;
          break;
        }
      }
      if (blocked) continue;
    }

    if (checkpoint && MUTATING_TOOLS.has(call.name)) {
      await checkpoint(call.name, call.id);
    }

    try {
      const executed = await tool.execute(call.input, context);
      // Taint and bound BOTH success and error output: an injected instruction
      // or a runaway dump can arrive on stderr just as easily as on stdout, so
      // an error result must not bypass the untrusted-content wrapper or the
      // byte/line cap. boundOutputBytes also guards a single newline-free blob
      // that the line-based cap alone would let through.
      let output = taintToolOutput(executed.output, call.name, call.input);
      output = boundOutputBytes(output);
      if (verdict.action === "steer") {
        output = `${output}\n\n[system note: ${verdict.message}]`;
      }
      record(call, { toolCallId: call.id, output, isError: executed.isError });

      if (hooks && hooks.length > 0) {
        const hookCtx = { toolName: call.name, input: call.input, cwd: context.cwd };
        const postHooks = hooks.filter((h) => h.event === "post_tool" && matchesHook(h, call.name, call.input));
        for (const hook of postHooks) {
          runHook(hook, hookCtx).catch(() => {});
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      record(call, { toolCallId: call.id, output: `Tool "${call.name}" threw: ${message}`, isError: true });
    }
  }

  return { results, callHistory: history };
}
