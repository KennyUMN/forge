import { describe, it, expect } from "vitest";
import { sessionEntriesToMessages } from "../../src/agent/session-bridge.js";
import type { SessionEntry } from "../../src/types/session.js";

function entry(partial: Pick<SessionEntry, "type" | "payload">): SessionEntry {
  return { id: "id", parentId: null, timestamp: "2026-01-01T00:00:00.000Z", ...partial };
}

describe("sessionEntriesToMessages", () => {
  it("maps a user_message entry to a user message with text content", () => {
    const entries = [entry({ type: "user_message", payload: { text: "hi" } })];
    expect(sessionEntriesToMessages(entries)).toEqual([{ role: "user", content: [{ type: "text", text: "hi" }] }]);
  });

  it("coalesces an assistant_message followed by tool_call entries into one assistant message", () => {
    const entries: SessionEntry[] = [
      entry({ type: "assistant_message", payload: { text: "let me check" } }),
      entry({ type: "tool_call", payload: { id: "call1", name: "read_file", input: { path: "a.ts" } } }),
    ];

    expect(sessionEntriesToMessages(entries)).toEqual([
      {
        role: "assistant",
        content: [
          { type: "text", text: "let me check" },
          { type: "tool_call", id: "call1", name: "read_file", input: { path: "a.ts" } },
        ],
      },
    ]);
  });

  it("coalesces consecutive tool_result entries into one tool message", () => {
    const entries: SessionEntry[] = [
      entry({ type: "tool_result", payload: { toolCallId: "call1", output: "contents", isError: false } }),
      entry({ type: "tool_result", payload: { toolCallId: "call2", output: "oops", isError: true } }),
    ];

    expect(sessionEntriesToMessages(entries)).toEqual([
      {
        role: "tool",
        content: [
          { type: "tool_result", toolCallId: "call1", output: "contents", isError: false },
          { type: "tool_result", toolCallId: "call2", output: "oops", isError: true },
        ],
      },
    ]);
  });

  it("starts a new message when the role changes, e.g. an assistant tool_call followed by its tool_result", () => {
    const entries: SessionEntry[] = [
      entry({ type: "tool_call", payload: { id: "call1", name: "bash", input: {} } }),
      entry({ type: "tool_result", payload: { toolCallId: "call1", output: "done", isError: false } }),
    ];

    const messages = sessionEntriesToMessages(entries);

    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("assistant");
    expect(messages[1].role).toBe("tool");
  });

  it("does not mutate its input array", () => {
    const entries: SessionEntry[] = [entry({ type: "user_message", payload: { text: "hi" } })];
    const snapshot = JSON.stringify(entries);
    sessionEntriesToMessages(entries);
    expect(JSON.stringify(entries)).toBe(snapshot);
  });
});
