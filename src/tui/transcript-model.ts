import type { TurnEvent } from "../agent/turn-events.js";
import type { ToolCallRequest, ToolResult } from "../types/tool-call.js";

export type TranscriptItem =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  // One item for the whole lifecycle of a call rather than a separate row for
  // the call and its result: the renderer draws a spinner while `result` is
  // absent and swaps it for an outcome in place, instead of the row jumping.
  | { kind: "tool"; call: ToolCallRequest; result?: ToolResult }
  | { kind: "notice"; text: string };

export interface TranscriptState {
  items: TranscriptItem[];
  // Reasoning is shown live while a step runs and then dropped, since it is not
  // part of the conversation the model sees on the next step and keeping every
  // token of it would dominate the scrollback.
  thinking: string;
}

export const EMPTY_TRANSCRIPT: TranscriptState = { items: [], thinking: "" };

function appendAssistantText(items: TranscriptItem[], text: string): TranscriptItem[] {
  const last = items[items.length - 1];
  // Text arrives one delta at a time. Merging into the trailing assistant item
  // keeps one paragraph per response rather than one row per token -- but only
  // when it is still trailing, so text after a tool call starts a new item.
  if (last?.kind === "assistant") {
    return [...items.slice(0, -1), { kind: "assistant", text: last.text + text }];
  }
  return [...items, { kind: "assistant", text }];
}

function attachResult(items: TranscriptItem[], call: ToolCallRequest, result: ToolResult): TranscriptItem[] {
  // Matched by call id from the end: the same tool can legitimately be called
  // more than once in a turn, and the most recent pending one is the match.
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item.kind === "tool" && item.call.id === call.id && !item.result) {
      return [...items.slice(0, i), { ...item, result }, ...items.slice(i + 1)];
    }
  }
  // A result with no pending call should not happen, but dropping it would
  // hide an outcome; showing it unattached is better than showing nothing.
  return [...items, { kind: "tool", call, result }];
}

export function reduceTranscript(state: TranscriptState, event: TurnEvent): TranscriptState {
  switch (event.type) {
    case "text_delta":
      return { ...state, items: appendAssistantText(state.items, event.text) };
    case "thinking_delta":
      return { ...state, thinking: state.thinking + event.text };
    case "tool_call":
      return { ...state, items: [...state.items, { kind: "tool", call: event.call }] };
    case "tool_result":
      return { ...state, items: attachResult(state.items, event.call, event.result) };
    // Cleared at both ends of a step so the panel only ever shows reasoning
    // for a step that is actually running. Clearing on start alone leaves the
    // final step's reasoning on screen underneath the answer it produced,
    // where it reads as part of the reply.
    case "step_start":
    case "step_end":
      return { ...state, thinking: "" };
  }
}

export function appendUserMessage(state: TranscriptState, text: string): TranscriptState {
  return { ...state, items: [...state.items, { kind: "user", text }], thinking: "" };
}

export function appendNotice(state: TranscriptState, text: string): TranscriptState {
  return { ...state, items: [...state.items, { kind: "notice", text }] };
}

// Any call still without a result once a turn ends never will get one -- the
// turn was interrupted or errored mid-flight. Left as-is they would spin
// forever, so they are settled explicitly.
export function settlePendingCalls(state: TranscriptState, reason: string): TranscriptState {
  return {
    ...state,
    thinking: "",
    items: state.items.map((item) =>
      item.kind === "tool" && !item.result
        ? { ...item, result: { toolCallId: item.call.id, output: reason, isError: true } }
        : item,
    ),
  };
}
