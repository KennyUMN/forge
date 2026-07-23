export interface ToolExecutionContext {
  cwd: string;
  // Aborted when the user interrupts the turn (Ctrl-C). Tools that can take
  // arbitrarily long -- bash above all -- must honour it, or an interrupt only
  // stops the agent loop while the command it started keeps running.
  signal?: AbortSignal;
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
