import type { FinishReason, TokenUsage } from "../types/message.js";
import type { ToolCallRequest, ToolResult } from "../types/tool-call.js";
import type { BudgetState } from "./budget.js";
import type { AgentRunState } from "./parallel-dispatch.js";

// One stream of events describing a turn as it happens, rather than a callback
// per interesting moment. A renderer consumes it as a stream and decides what
// to show; adding a new event never changes the signature every caller passes.
//
// Before this existed the only observable thing in a turn was assistant text,
// so a tool call that a policy auto-allowed ran completely invisibly -- the
// user saw the terminal pause and then text appear, with no indication that
// anything had been read or run in between.
export type TurnEvent =
  | { type: "step_start"; step: number }
  | { type: "text_delta"; text: string }
  // Emitted by providers that expose a reasoning stream. Carries no commitment
  // that a renderer shows it; several models emit far more of this than text.
  | { type: "thinking_delta"; text: string }
  | { type: "tool_call"; call: ToolCallRequest }
  // Carries the originating call, not just the id, so a renderer can label the
  // result without keeping its own map of in-flight calls.
  | { type: "tool_result"; call: ToolCallRequest; result: ToolResult }
  // usage is absent when the provider did not report any; a renderer must show
  // that as unknown rather than as zero tokens used.
  | { type: "step_end"; step: number; finishReason: FinishReason; usage?: TokenUsage }
  | { type: "budget_exceeded"; state: BudgetState; reason: string }
  | { type: "context_compacted"; originalTokens: number; compactedTokens: number; entriesCompacted: number }
  | { type: "verification_start"; command: string; attempt: number }
  | { type: "verification_pass" }
  | { type: "verification_fail"; output: string; attempt: number; maxRetries: number }
  | { type: "subagent_start"; id: string; task: string; mode: string }
  | { type: "subagent_end"; id: string; state: AgentRunState; summary?: string };

export type TurnEventHandler = (event: TurnEvent) => void;
