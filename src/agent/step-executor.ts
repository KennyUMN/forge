import type { ModelProvider, StreamContext } from "../provider/model-provider.js";
import type { FinishReason } from "../types/message.js";
import type { ToolCallRequest } from "../types/tool-call.js";

export interface StepResult {
  text: string;
  toolCalls: ToolCallRequest[];
  finishReason: FinishReason;
}

// Runs exactly one model round-trip: streams the provider's response and
// accumulates it into a single result. Does not dispatch tool calls or touch
// the session log -- that's the Tool Dispatcher's and Turn Orchestrator's
// job, kept separate so each unit is independently testable.
export async function executeStep(provider: ModelProvider, context: StreamContext): Promise<StepResult> {
  let text = "";
  const toolCalls: ToolCallRequest[] = [];
  let finishReason: FinishReason = "other";

  for await (const event of provider.stream(context)) {
    if (event.type === "text_delta") {
      text += event.text;
    } else if (event.type === "tool_call") {
      toolCalls.push({ id: event.id, name: event.name, input: event.input });
    } else if (event.type === "finish") {
      finishReason = event.reason;
    }
    // thinking_delta is intentionally ignored -- not part of Sprint 2's contract.
  }

  return { text, toolCalls, finishReason };
}
