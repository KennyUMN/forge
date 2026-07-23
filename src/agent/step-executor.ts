import type { ModelProvider, StreamContext } from "../provider/model-provider.js";
import type { FinishReason, TokenUsage } from "../types/message.js";
import type { ToolCallRequest } from "../types/tool-call.js";
import type { TurnEventHandler } from "./turn-events.js";

export interface StepResult {
  text: string;
  toolCalls: ToolCallRequest[];
  finishReason: FinishReason;
  usage?: TokenUsage;
}

export interface StepCallbacks {
  onEvent?: TurnEventHandler;
}

// Runs exactly one model round-trip: streams the provider's response and
// accumulates it into a single result. Does not dispatch tool calls or touch
// the session log -- that's the Tool Dispatcher's and Turn Orchestrator's
// job, kept separate so each unit is independently testable. The optional
// onEvent handler lets a caller (e.g. the CLI) render the response as it
// streams in, without changing what this function returns.
export async function executeStep(
  provider: ModelProvider,
  context: StreamContext,
  callbacks: StepCallbacks = {},
): Promise<StepResult> {
  let text = "";
  const toolCalls: ToolCallRequest[] = [];
  let finishReason: FinishReason = "other";
  let usage: TokenUsage | undefined;

  for await (const event of provider.stream(context)) {
    if (event.type === "text_delta") {
      text += event.text;
      callbacks.onEvent?.({ type: "text_delta", text: event.text });
    } else if (event.type === "thinking_delta") {
      // Forwarded but not accumulated into `text`: reasoning is not part of
      // the assistant message that goes back to the model on the next step.
      callbacks.onEvent?.({ type: "thinking_delta", text: event.text });
    } else if (event.type === "tool_call") {
      toolCalls.push({ id: event.id, name: event.name, input: event.input });
    } else if (event.type === "finish") {
      finishReason = event.reason;
      usage = event.usage;
    }
  }

  return { text, toolCalls, finishReason, usage };
}
