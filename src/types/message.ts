export type ThinkingEffort = "none" | "low" | "high" | "max";

export interface TextContent {
  type: "text";
  text: string;
}

export interface ToolCallContent {
  type: "tool_call";
  id: string;
  name: string;
  input: unknown;
}

export interface ToolResultContent {
  type: "tool_result";
  toolCallId: string;
  output: string;
  isError: boolean;
}

export type MessageContent = TextContent | ToolCallContent | ToolResultContent;

export interface Message {
  role: "user" | "assistant" | "tool";
  content: MessageContent[];
}

export interface ToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export type FinishReason = "completed" | "tool_calls" | "truncated" | "filtered" | "other";

export type StreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_call"; id: string; name: string; input: unknown }
  | { type: "finish"; reason: FinishReason; rawReason: string };
