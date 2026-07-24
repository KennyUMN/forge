import type { ToolCallRequest, ToolResult } from "../types/tool-call.js";

export const DOOM_LOOP_THRESHOLD = 3;

const FILE_EDIT_THRESHOLD = 5;
const ALTERNATING_MIN_LENGTH = 6;
const REPEATED_ERROR_THRESHOLD = 3;

const FILE_EDIT_TOOLS = new Set(["edit_file", "write_file"]);

export type DoomLoopVerdict =
  | { action: "allow" }
  | { action: "steer"; message: string }
  | { action: "block"; reason: string };

function serializeCall(call: ToolCallRequest): string {
  return `${call.name}:${JSON.stringify(call.input)}`;
}

// Returns true when `call` would be the Nth consecutive identical (name +
// input) tool call, per DOOM_LOOP_THRESHOLD, based on the calls already
// recorded in `history` (most recent last). Does not mutate history -- the
// caller decides when and whether to record the call.
export function isDoomLoop(history: readonly ToolCallRequest[], call: ToolCallRequest): boolean {
  const requiredPriorRepeats = DOOM_LOOP_THRESHOLD - 1;
  if (history.length < requiredPriorRepeats) return false;

  const recent = history.slice(-requiredPriorRepeats);
  const signature = serializeCall(call);
  return recent.every((entry) => serializeCall(entry) === signature);
}

export function checkDoomLoop(
  history: readonly ToolCallRequest[],
  results: readonly ToolResult[],
  call: ToolCallRequest,
): DoomLoopVerdict {
  const block = checkIdenticalCalls(history, call);
  if (block) return block;

  const alternating = checkAlternatingCycle(history, call);
  if (alternating) return alternating;

  const repeatedError = checkRepeatedErrors(history, results, call);
  if (repeatedError) return repeatedError;

  const fileEdit = checkFileEditCounter(history, call);
  if (fileEdit) return fileEdit;

  return { action: "allow" };
}

function checkIdenticalCalls(
  history: readonly ToolCallRequest[],
  call: ToolCallRequest,
): DoomLoopVerdict | null {
  if (!isDoomLoop(history, call)) return null;
  return { action: "block", reason: "repeated identical tool call (doom-loop guard)" };
}

function checkAlternatingCycle(
  history: readonly ToolCallRequest[],
  call: ToolCallRequest,
): DoomLoopVerdict | null {
  const needed = ALTERNATING_MIN_LENGTH - 1;
  if (history.length < needed) return null;

  const recent = history.slice(-needed);
  const sequence = [...recent, call];

  const nameA = sequence[0].name;
  const nameB = sequence[1].name;
  if (nameA === nameB) return null;

  for (let i = 0; i < sequence.length; i++) {
    const expected = i % 2 === 0 ? nameA : nameB;
    if (sequence[i].name !== expected) return null;
  }

  return {
    action: "steer",
    message: `You appear to be alternating between ${nameA} and ${nameB}. Consider a different approach.`,
  };
}

function checkRepeatedErrors(
  history: readonly ToolCallRequest[],
  results: readonly ToolResult[],
  call: ToolCallRequest,
): DoomLoopVerdict | null {
  const errorCounts = new Map<string, number>();

  for (const result of results) {
    if (!result.isError) continue;
    const sourceCall = history.find((h) => h.id === result.toolCallId);
    if (!sourceCall || sourceCall.name !== call.name) continue;
    const key = `${sourceCall.name}:${result.output}`;
    errorCounts.set(key, (errorCounts.get(key) ?? 0) + 1);
  }

  for (const [key, count] of errorCounts) {
    if (count >= REPEATED_ERROR_THRESHOLD) {
      return {
        action: "steer",
        message: `The same error has occurred ${count} times. Consider investigating the root cause rather than retrying.`,
      };
    }
  }

  return null;
}

function extractFilePath(call: ToolCallRequest): string | null {
  if (!FILE_EDIT_TOOLS.has(call.name)) return null;
  const input = call.input as Record<string, unknown> | null;
  if (!input || typeof input.path !== "string") return null;
  return input.path;
}

function checkFileEditCounter(
  history: readonly ToolCallRequest[],
  call: ToolCallRequest,
): DoomLoopVerdict | null {
  const targetPath = extractFilePath(call);
  if (!targetPath) return null;

  let count = 0;
  for (const entry of history) {
    if (extractFilePath(entry) === targetPath) count++;
  }

  const total = count + 1;
  if (total <= FILE_EDIT_THRESHOLD) return null;

  return {
    action: "steer",
    message: `You have edited ${targetPath} ${total} times. Consider whether the approach needs rethinking.`,
  };
}
