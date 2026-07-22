import { createInterface } from "node:readline/promises";
import type { Interface } from "node:readline/promises";
import type { ToolCallRequest } from "../types/tool-call.js";

export function parseYesNo(input: string): boolean {
  const normalized = input.trim().toLowerCase();
  return normalized === "y" || normalized === "yes";
}

export function formatAskPrompt(call: ToolCallRequest): string {
  return `Allow tool call "${call.name}" with input ${JSON.stringify(call.input)}? [y/N] `;
}

// Reuses the caller's readline Interface when given one (the CLI's main
// loop passes its own shared Interface here for exactly this reason): two
// independent Interfaces sharing one input stream corrupts real TTY input
// (duplicate-echoed keystrokes), and closing either one disables raw mode
// for the other. When no Interface is supplied, falls back to creating
// (and closing) a private one, preserving the original single-argument
// contract for any other caller.
export async function askTerminal(call: ToolCallRequest, rl?: Interface): Promise<boolean> {
  if (rl) {
    const answer = await rl.question(formatAskPrompt(call));
    return parseYesNo(answer);
  }

  const ownRl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await ownRl.question(formatAskPrompt(call));
    return parseYesNo(answer);
  } finally {
    ownRl.close();
  }
}
