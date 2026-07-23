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

// Self-contained terminal ask: opens its own readline Interface for this one
// question and closes it afterward. Suitable for one-off use. The CLI's
// interactive loop uses createSharedAskFn instead, since opening a second
// Interface on process.stdin while its own loop already keeps one alive
// corrupts real TTY input.
export async function askTerminal(call: ToolCallRequest): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(formatAskPrompt(call));
    return parseYesNo(answer);
  } finally {
    rl.close();
  }
}

// rl.question() rejects with "readline was closed" when the interface has
// already closed, which is the ordinary end of piped input: stdin ends while a
// turn is still running, so the next iteration asks a dead interface. Racing
// against the caller's `closed` signal only covers a close that happens
// *during* the question, not one that already happened -- so both are needed,
// and both mean the same thing: no more input, resolve to null.
export async function questionOrNull(
  rl: Interface,
  closed: Promise<null>,
  prompt: string,
): Promise<string | null> {
  try {
    return await Promise.race([rl.question(prompt), closed]);
  } catch (err) {
    if (err instanceof Error && /readline was closed/i.test(err.message)) return null;
    throw err;
  }
}

// Builds an ask function that reuses an already-open readline Interface
// instead of creating its own, and races its question against the same
// `closed` signal the caller's own prompt loop uses -- so a permission
// question pending when stdin hits EOF resolves to "denied" instead of
// hanging forever (which would otherwise leave runTurn permanently pending
// and orphan any configured MCP subprocess). Reuses the caller's already-
// hoisted `closed` listener rather than registering a new one per call, so
// it cannot accumulate listeners across many permission prompts in one
// session the way a fresh once(rl, "close") per call would.
export function createSharedAskFn(
  rl: Interface,
  closed: Promise<null>,
): (call: ToolCallRequest) => Promise<boolean> {
  return async (call) => {
    const answer = await Promise.race([rl.question(formatAskPrompt(call)), closed]);
    if (answer === null) return false;
    return parseYesNo(answer);
  };
}
