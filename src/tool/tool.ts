export interface ToolExecutionContext {
  cwd: string;
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
