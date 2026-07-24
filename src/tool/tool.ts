import type { ParallelTask, ParallelResult } from "../agent/parallel-dispatch.js";
import type { BestOfNConfig, BestOfNResult } from "../agent/best-of-n.js";
import type { LspClient } from "../lsp/lsp-client.js";
import type { Executor } from "./executor.js";

export interface AskQuestionPayload {
  question: string;
  options: string[];
  context?: string;
}

export type OracleFn = (prompt: string) => Promise<string>;

export type BestOfNFn = (task: string, config: BestOfNConfig) => Promise<BestOfNResult>;

export interface SubagentConfig {
  mode: "worker" | "advisory";
  maxSteps?: number;
  model?: string;
}

export interface SubagentResult {
  summary: string;
  stepsExecuted: number;
  stoppedReason: string;
  toolCallsMade: number;
}

export type SubagentFn = (task: string, config: SubagentConfig) => Promise<SubagentResult>;

export interface ToolExecutionContext {
  cwd: string;
  // Aborted when the user interrupts the turn (Ctrl-C). Tools that can take
  // arbitrarily long -- bash above all -- must honour it, or an interrupt only
  // stops the agent loop while the command it started keeps running.
  signal?: AbortSignal;
  executor?: Executor;
  askQuestion?: (payload: AskQuestionPayload) => Promise<string>;
  oracle?: OracleFn;
  parallelDispatch?: (tasks: ParallelTask[], cwd: string) => Promise<ParallelResult[]>;
  subagent?: SubagentFn;
  bestOfN?: BestOfNFn;
  lsp?: LspClient;
  loadSkill?: (name: string) => Promise<string>;
}

export interface ToolExecutionResult {
  output: string;
  isError: boolean;
}

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(input: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult>;
}
