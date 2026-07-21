import type { Message, StreamEvent, ThinkingEffort, ToolSchema } from "../types/message.js";

export interface StreamContext {
  systemPrompt: string;
  messages: Message[];
  tools: ToolSchema[];
}

export interface ModelProvider {
  readonly name: string;
  stream(context: StreamContext): AsyncIterable<StreamEvent>;
  withThinking?(effort: ThinkingEffort): ModelProvider;
  withMaxTokens?(max: number): ModelProvider;
}
