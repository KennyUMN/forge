import { describe, it, expect } from "vitest";
import { compactEntries } from "../../src/agent/compaction.js";
import type { CompactionConfig } from "../../src/agent/compaction.js";
import { sessionEntriesToMessages } from "../../src/agent/session-bridge.js";
import type { SessionEntry } from "../../src/types/session.js";

let idCounter = 0;
function entry(partial: Pick<SessionEntry, "type" | "payload">): SessionEntry {
  return { id: `id-${idCounter++}`, parentId: null, timestamp: "2026-01-01T00:00:00.000Z", ...partial };
}

function toolResultEntry(output: string): SessionEntry {
  return entry({ type: "tool_result", payload: { toolCallId: `call-${idCounter}`, output, isError: false } });
}

function largeOutput(chars: number): string {
  return "x".repeat(chars);
}

describe("compactEntries", () => {
  it("returns entries unchanged when under threshold", () => {
    const entries = [
      entry({ type: "user_message", payload: { text: "hi" } }),
      entry({ type: "tool_result", payload: { toolCallId: "c1", output: "small", isError: false } }),
    ];

    const result = compactEntries(entries, { maxTokens: 150000 });

    expect(result.compacted).toBe(false);
    expect(result.entries).toBe(entries);
    expect(result.originalTokenEstimate).toBe(result.compactedTokenEstimate);
  });

  it("stubs tool_results older than keepRecentCount when over threshold", () => {
    const big = largeOutput(8000);
    const entries: SessionEntry[] = [];
    for (let i = 0; i < 5; i++) {
      entries.push(toolResultEntry(big));
    }

    const result = compactEntries(entries, { maxTokens: 100, keepRecentCount: 2 });

    expect(result.compacted).toBe(true);
    const stubbed = result.entries.slice(0, 3);
    for (const e of stubbed) {
      const payload = e.payload as { output: string };
      expect(payload.output).toBe("[output compacted]");
    }
  });

  it("preserves the most recent keepRecentCount tool_results", () => {
    const big = largeOutput(8000);
    const entries: SessionEntry[] = [];
    for (let i = 0; i < 5; i++) {
      entries.push(toolResultEntry(big));
    }

    const result = compactEntries(entries, { maxTokens: 100, keepRecentCount: 2 });

    const kept = result.entries.slice(3);
    for (let i = 0; i < kept.length; i++) {
      const payload = kept[i].payload as { output: string };
      expect(payload.output).toBe(big);
    }
  });

  it("never compacts user_message entries", () => {
    const big = largeOutput(8000);
    const entries: SessionEntry[] = [
      entry({ type: "user_message", payload: { text: big } }),
      toolResultEntry(big),
      toolResultEntry(big),
    ];

    const result = compactEntries(entries, { maxTokens: 100, keepRecentCount: 1 });

    const userPayload = result.entries[0].payload as { text: string };
    expect(userPayload.text).toBe(big);
  });

  it("never compacts assistant_message entries", () => {
    const big = largeOutput(8000);
    const entries: SessionEntry[] = [
      entry({ type: "assistant_message", payload: { text: big } }),
      toolResultEntry(big),
      toolResultEntry(big),
    ];

    const result = compactEntries(entries, { maxTokens: 100, keepRecentCount: 1 });

    const assistantPayload = result.entries[0].payload as { text: string };
    expect(assistantPayload.text).toBe(big);
  });

  it("never compacts tool_call entries", () => {
    const big = largeOutput(8000);
    const entries: SessionEntry[] = [
      entry({ type: "tool_call", payload: { id: "c1", name: "bash", input: { cmd: big } } }),
      toolResultEntry(big),
      toolResultEntry(big),
    ];

    const result = compactEntries(entries, { maxTokens: 100, keepRecentCount: 1 });

    const callPayload = result.entries[0].payload as { input: { cmd: string } };
    expect(callPayload.input.cmd).toBe(big);
  });

  it("does not mutate the original entries", () => {
    const big = largeOutput(8000);
    const entries: SessionEntry[] = [toolResultEntry(big), toolResultEntry(big), toolResultEntry(big)];
    const snapshot = JSON.stringify(entries);

    compactEntries(entries, { maxTokens: 100, keepRecentCount: 1 });

    expect(JSON.stringify(entries)).toBe(snapshot);
  });

  it("estimates tokens as JSON length / 4", () => {
    const entries = [entry({ type: "user_message", payload: { text: "abcd" } })];
    const result = compactEntries(entries, { maxTokens: 999999 });

    const expected = Math.ceil(JSON.stringify(entries[0].payload).length / 4);
    expect(result.originalTokenEstimate).toBe(expected);
  });

  it("reports originalTokenEstimate > compactedTokenEstimate when compaction triggers", () => {
    const big = largeOutput(8000);
    const entries: SessionEntry[] = [];
    for (let i = 0; i < 5; i++) {
      entries.push(toolResultEntry(big));
    }

    const result = compactEntries(entries, { maxTokens: 100, keepRecentCount: 2 });

    expect(result.compacted).toBe(true);
    expect(result.originalTokenEstimate).toBeGreaterThan(result.compactedTokenEstimate);
  });

  it("handles an empty entries array", () => {
    const result = compactEntries([], { maxTokens: 100 });

    expect(result.compacted).toBe(false);
    expect(result.entries).toEqual([]);
    expect(result.originalTokenEstimate).toBe(0);
    expect(result.compactedTokenEstimate).toBe(0);
  });

  it("uses a custom stubText when provided", () => {
    const big = largeOutput(8000);
    const entries: SessionEntry[] = [toolResultEntry(big), toolResultEntry(big)];

    const result = compactEntries(entries, { maxTokens: 100, keepRecentCount: 1, stubText: "[redacted]" });

    const payload = result.entries[0].payload as { output: string };
    expect(payload.output).toBe("[redacted]");
  });

  it("integrates with sessionEntriesToMessages", () => {
    const big = largeOutput(8000);
    const entries: SessionEntry[] = [
      entry({ type: "user_message", payload: { text: "do stuff" } }),
      entry({ type: "tool_call", payload: { id: "c1", name: "bash", input: {} } }),
      toolResultEntry(big),
      entry({ type: "tool_call", payload: { id: "c2", name: "bash", input: {} } }),
      toolResultEntry(big),
    ];

    const messages = sessionEntriesToMessages(entries, { maxTokens: 100, keepRecentCount: 1 });

    const toolMessages = messages.filter((m) => m.role === "tool");
    const allResults = toolMessages.flatMap((m) => m.content);
    const firstResult = allResults[0] as { output: string };
    const lastResult = allResults[allResults.length - 1] as { output: string };

    expect(firstResult.output).toBe("[output compacted]");
    expect(lastResult.output).toBe(big);
  });
});
