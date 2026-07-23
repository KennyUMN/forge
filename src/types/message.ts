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

export interface TokenUsage {
  // What the model actually read for this request -- the whole conversation so
  // far, not just the latest message. This is the number that fills a context
  // window, so it is what a usage indicator has to show.
  inputTokens: number;
  outputTokens: number;
}

export type StreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "thinking_delta"; text: string }
  | { type: "tool_call"; id: string; name: string; input: unknown }
  // usage is optional because not every compatible server reports it, and a
  // missing count must degrade to "unknown" rather than to a wrong zero.
  | { type: "finish"; reason: FinishReason; rawReason: string; usage?: TokenUsage };
