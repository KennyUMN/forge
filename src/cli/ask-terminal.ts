import type { Interface } from "node:readline/promises";
import type { ToolCallRequest } from "../types/tool-call.js";

export function parseYesNo(input: string): boolean {
  const normalized = input.trim().toLowerCase();
  return normalized === "y" || normalized === "yes";
}

export function formatAskPrompt(call: ToolCallRequest): string {
  return `Allow tool call "${call.name}" with input ${JSON.stringify(call.input)}? [y/N] `;
}

// Takes the caller's own readline Interface rather than creating a second one
// on process.stdin. Two independent Interfaces sharing one input stream is
// what causes real TTY input corruption: both attach their own keypress
// listeners (duplicate-echoed keystrokes) and closing either one un-sets raw
// mode on the shared stream out from under the other, disabling raw-mode
// input for the rest of the session. Reusing the caller's Interface (the
// same one it already uses for its own prompt loop) avoids that entirely.
export async function askTerminal(call: ToolCallRequest, rl: Interface): Promise<boolean> {
  const answer = await rl.question(formatAskPrompt(call));
  return parseYesNo(answer);
}
