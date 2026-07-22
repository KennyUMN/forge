export interface ToolCallRequest {
  id: string;
  name: string;
  input: unknown;
}

export interface ToolResult {
  toolCallId: string;
  output: string;
  isError: boolean;
}
