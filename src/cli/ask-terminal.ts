import { createInterface } from "node:readline/promises";
import type { ToolCallRequest } from "../types/tool-call.js";

export function parseYesNo(input: string): boolean {
  const normalized = input.trim().toLowerCase();
  return normalized === "y" || normalized === "yes";
}

export function formatAskPrompt(call: ToolCallRequest): string {
  return `Allow tool call "${call.name}" with input ${JSON.stringify(call.input)}? [y/N] `;
}

export async function askTerminal(call: ToolCallRequest): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(formatAskPrompt(call));
    return parseYesNo(answer);
  } finally {
    rl.close();
  }
}
