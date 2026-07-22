import type { ToolCallRequest } from "../types/tool-call.js";

export const DOOM_LOOP_THRESHOLD = 3;

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
