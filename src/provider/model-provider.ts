import type { Message, StreamEvent, ThinkingEffort, ToolSchema } from "../types/message.js";

export interface StreamContext {
  systemPrompt: string;
  messages: Message[];
  tools: ToolSchema[];
  // Aborted when the user interrupts the turn. Without it, Ctrl-C during a
  // long response stops the loop but leaves the request streaming to nowhere.
  signal?: AbortSignal;
}

export interface ModelProvider {
  readonly name: string;
  stream(context: StreamContext): AsyncIterable<StreamEvent>;
  withThinking?(effort: ThinkingEffort): ModelProvider;
  withMaxTokens?(max: number): ModelProvider;
}
