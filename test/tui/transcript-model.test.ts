import { describe, it, expect } from "vitest";
import {
  EMPTY_TRANSCRIPT,
  appendNotice,
  appendUserMessage,
  reduceTranscript,
  settlePendingCalls,
} from "../../src/tui/transcript-model.js";
import type { TranscriptState } from "../../src/tui/transcript-model.js";
import type { TurnEvent } from "../../src/agent/turn-events.js";

const call = { id: "c1", name: "read_file", input: { path: "a.ts" } };
const otherCall = { id: "c2", name: "grep", input: { pattern: "x" } };

function reduceAll(events: TurnEvent[], initial: TranscriptState = EMPTY_TRANSCRIPT): TranscriptState {
  return events.reduce(reduceTranscript, initial);
}

describe("reduceTranscript", () => {
  // One paragraph per response, not one row per streamed token.
  it("merges consecutive text deltas into a single assistant item", () => {
    const state = reduceAll([
      { type: "text_delta", text: "hello " },
      { type: "text_delta", text: "world" },
    ]);

    expect(state.items).toEqual([{ kind: "assistant", text: "hello world" }]);
  });

  // Merging only while the assistant item is still trailing: text after a tool
  // call is a new paragraph, not a continuation of what came before it.
  it("starts a new assistant item for text that follows a tool call", () => {
    const state = reduceAll([
      { type: "text_delta", text: "looking" },
      { type: "tool_call", call },
      { type: "tool_result", call, result: { toolCallId: "c1", output: "ok", isError: false } },
      { type: "text_delta", text: "found it" },
    ]);

    expect(state.items.map((i) => i.kind)).toEqual(["assistant", "tool", "assistant"]);
    expect(state.items[2]).toEqual({ kind: "assistant", text: "found it" });
  });

  // One row for the whole lifecycle so the renderer can swap a spinner for an
  // outcome in place, rather than the result appearing as a separate row.
  it("attaches a result to its pending call instead of appending a row", () => {
    const state = reduceAll([
      { type: "tool_call", call },
      { type: "tool_result", call, result: { toolCallId: "c1", output: "contents", isError: false } },
    ]);

    expect(state.items).toEqual([
      { kind: "tool", call, result: { toolCallId: "c1", output: "contents", isError: false } },
    ]);
  });

  it("keeps two concurrent calls apart when their results arrive out of order", () => {
    const state = reduceAll([
      { type: "tool_call", call },
      { type: "tool_call", call: otherCall },
      { type: "tool_result", call: otherCall, result: { toolCallId: "c2", output: "second", isError: false } },
      { type: "tool_result", call, result: { toolCallId: "c1", output: "first", isError: false } },
    ]);

    expect(state.items).toEqual([
      { kind: "tool", call, result: { toolCallId: "c1", output: "first", isError: false } },
      { kind: "tool", call: otherCall, result: { toolCallId: "c2", output: "second", isError: false } },
    ]);
  });

  // The same tool called twice in one turn shares a name but not an outcome,
  // and matching from the end pairs each result with its own pending call.
  it("attaches to the most recent pending call when the same id is reused", () => {
    const state = reduceAll([
      { type: "tool_call", call },
      { type: "tool_result", call, result: { toolCallId: "c1", output: "first", isError: false } },
      { type: "tool_call", call },
      { type: "tool_result", call, result: { toolCallId: "c1", output: "second", isError: false } },
    ]);

    expect(state.items).toHaveLength(2);
    expect(state.items[0]).toMatchObject({ result: { output: "first" } });
    expect(state.items[1]).toMatchObject({ result: { output: "second" } });
  });

  // Dropping an unmatched result would hide an outcome entirely; showing it
  // unattached is the lesser failure.
  it("shows a result with no pending call rather than discarding it", () => {
    const state = reduceAll([
      { type: "tool_result", call, result: { toolCallId: "c1", output: "orphan", isError: true } },
    ]);

    expect(state.items).toHaveLength(1);
    expect(state.items[0]).toMatchObject({ kind: "tool", result: { output: "orphan" } });
  });

  it("accumulates thinking separately from the transcript", () => {
    const state = reduceAll([
      { type: "thinking_delta", text: "weighing " },
      { type: "thinking_delta", text: "options" },
    ]);

    expect(state.thinking).toBe("weighing options");
    expect(state.items).toEqual([]);
  });

  // Per step, so the panel shows what the model is considering now rather than
  // everything it has thought since the turn began.
  it("clears thinking at the start of each step", () => {
    const state = reduceAll([{ type: "thinking_delta", text: "old" }, { type: "step_start", step: 2 }]);

    expect(state.thinking).toBe("");
  });

  // Clearing on start alone leaves the final step's reasoning on screen
  // underneath the answer it produced, where it reads as part of the reply.
  it("clears thinking when a step ends, not only when the next one starts", () => {
    const state = reduceAll([
      { type: "thinking_delta", text: "considering" },
      { type: "text_delta", text: "the answer" },
      { type: "step_end", step: 1, finishReason: "completed" },
    ]);

    expect(state.thinking).toBe("");
    expect(state.items).toEqual([{ kind: "assistant", text: "the answer" }]);
  });
});

describe("appendUserMessage", () => {
  it("adds the user's line and clears any leftover thinking", () => {
    const state = appendUserMessage({ items: [], thinking: "stale" }, "do the thing");

    expect(state.items).toEqual([{ kind: "user", text: "do the thing" }]);
    expect(state.thinking).toBe("");
  });
});

describe("appendNotice", () => {
  it("adds an out-of-band notice", () => {
    expect(appendNotice(EMPTY_TRANSCRIPT, "interrupted").items).toEqual([{ kind: "notice", text: "interrupted" }]);
  });
});

describe("settlePendingCalls", () => {
  // An interrupted turn leaves calls that will never resolve; left alone their
  // spinners run forever.
  it("marks every unresolved call with the reason", () => {
    const state = settlePendingCalls(
      { items: [{ kind: "tool", call }, { kind: "tool", call: otherCall }], thinking: "x" },
      "interrupted",
    );

    expect(state.items).toEqual([
      { kind: "tool", call, result: { toolCallId: "c1", output: "interrupted", isError: true } },
      { kind: "tool", call: otherCall, result: { toolCallId: "c2", output: "interrupted", isError: true } },
    ]);
    expect(state.thinking).toBe("");
  });

  it("leaves calls that already resolved untouched", () => {
    const done = { toolCallId: "c1", output: "done", isError: false };
    const state = settlePendingCalls({ items: [{ kind: "tool", call, result: done }], thinking: "" }, "interrupted");

    expect(state.items[0]).toMatchObject({ result: done });
  });
});
