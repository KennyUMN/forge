import { runSubagent } from "../agent/subagent.js";
import type { SubagentContext } from "../agent/subagent.js";
import { dispatchParallel } from "../agent/parallel-dispatch.js";
import type { ParallelTask, ParallelResult } from "../agent/parallel-dispatch.js";
import { runBestOfN } from "../agent/best-of-n.js";
import type { BestOfNConfig, BestOfNResult } from "../agent/best-of-n.js";
import type { ModelProvider } from "../provider/model-provider.js";
import type { Tool, SubagentFn, BestOfNFn } from "../tool/tool.js";
import type { PermissionGate } from "../permission/permission-gate.js";
import type { SessionStore } from "../session/session-store.js";

// The pieces every entrypoint already has on hand to run a nested turn. The
// same shape drives all three multi-agent primitives, so they share one parent
// context rather than each rebuilding it.
export interface AgentWiringDeps {
  provider: ModelProvider;
  tools: ReadonlyMap<string, Tool>;
  session: SessionStore;
  gate: PermissionGate;
  systemPrompt: string;
  cwd: string;
  signal?: AbortSignal;
}

export interface AgentFns {
  subagent: SubagentFn;
  parallelDispatch: (tasks: ParallelTask[], cwd: string) => Promise<ParallelResult[]>;
  bestOfN: BestOfNFn;
}

// Builds the three multi-agent tool callbacks (spawn_agent, spawn_agents,
// best_of_n) from one parent context. Each entrypoint calls this once and drops
// the result into its ToolExecutionContext; without it those tools return
// "not available in this execution context" and the whole subsystem is inert.
export function buildAgentFns(deps: AgentWiringDeps): AgentFns {
  const contextFor = (cwd: string): SubagentContext => ({
    parentProvider: deps.provider,
    parentTools: deps.tools,
    parentSession: deps.session,
    parentGate: deps.gate,
    systemPrompt: deps.systemPrompt,
    cwd,
    signal: deps.signal,
  });

  const subagent: SubagentFn = (task, config) => runSubagent(task, config, contextFor(deps.cwd));

  const parallelDispatch = (tasks: ParallelTask[], cwd: string): Promise<ParallelResult[]> =>
    dispatchParallel(
      tasks,
      async (task, mode, taskCwd) => {
        const result = await runSubagent(task, { mode }, contextFor(taskCwd));
        return result.summary;
      },
      cwd,
      deps.signal,
    );

  const bestOfN: BestOfNFn = (task, config: BestOfNConfig): Promise<BestOfNResult> =>
    runBestOfN(task, config, async (candidate) => {
      const result = await runSubagent(candidate, { mode: "worker" }, contextFor(deps.cwd));
      return { output: result.summary, steps: result.stepsExecuted };
    });

  return { subagent, parallelDispatch, bestOfN };
}
