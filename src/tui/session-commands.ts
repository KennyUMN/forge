import { PERMISSION_MODES } from "../permission/permission-policies.js";
import type { PermissionMode } from "../permission/permission-policies.js";

// In-session slash commands: lines the user types at the TUI prompt that Forge
// handles itself instead of sending to the model. Kept as a pure module -- it
// parses input and returns display lines plus a described effect -- so the App
// only has to render the lines and apply the effect, and the whole surface is
// unit-testable without a terminal.

export interface SlashContext {
  provider: string;
  model: string;
  cwd: string;
  branch?: string;
  mode: PermissionMode;
  // Undefined until the provider reports a count; several OpenAI-compatible
  // servers never report usage at all, so "unknown" is a real state.
  usedTokens?: number;
  contextWindow: number;
  models: readonly string[];
  // Capability flags: the App sets these from which callbacks it was given, so
  // a command degrades to an honest "not available" line instead of a no-op.
  canSwitchModel: boolean;
  canCompact: boolean;
  canRunAgent: boolean;
}

export type SlashEffect =
  | { kind: "none" }
  | { kind: "exit" }
  | { kind: "clear" }
  | { kind: "set_mode"; mode: PermissionMode }
  | { kind: "switch_model"; model: string }
  | { kind: "compact" }
  | { kind: "run_agent"; task: string };

export interface SlashResult {
  lines: string[];
  effect: SlashEffect;
}

export interface SlashCommandSpec {
  name: string;
  usage: string;
  description: string;
}

export const SESSION_COMMANDS: readonly SlashCommandSpec[] = [
  { name: "help", usage: "/help", description: "list these commands" },
  { name: "usage", usage: "/usage", description: "show context-token usage" },
  { name: "config", usage: "/config", description: "show the active provider, model, mode and paths" },
  { name: "model", usage: "/model [id]", description: "show or switch the active model" },
  { name: "mode", usage: "/mode [ask|accept-edits|auto]", description: "show or set the permission mode" },
  { name: "compact", usage: "/compact", description: "compact the conversation context" },
  { name: "agent", usage: "/agent <task>", description: "run a task in an isolated subagent" },
  { name: "clear", usage: "/clear", description: "clear the screen (the model keeps full context)" },
  { name: "exit", usage: "/exit", description: "quit forge" },
];

export function isSlashInput(text: string): boolean {
  return text.trimStart().startsWith("/");
}

export interface ParsedSlash {
  name: string;
  args: string[];
  // Everything after the command name, unsplit -- for commands like /agent
  // whose argument is a free-form sentence, not a token list.
  rest: string;
}

export function parseSlashInput(text: string): ParsedSlash | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return null;
  const body = trimmed.slice(1);
  const parts = body.split(/\s+/).filter(Boolean);
  const name = (parts[0] ?? "").toLowerCase();
  const args = parts.slice(1);
  const rest = body.slice(parts[0]?.length ?? 0).trim();
  return { name, args, rest };
}

function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}

function helpLines(): string[] {
  const width = Math.max(...SESSION_COMMANDS.map((c) => c.usage.length));
  return [
    "commands:",
    ...SESSION_COMMANDS.map((c) => `  ${c.usage.padEnd(width)}  ${c.description}`),
  ];
}

function usageLines(ctx: SlashContext): string[] {
  if (ctx.usedTokens === undefined) {
    return ["context usage: unknown (the provider has not reported token counts yet)"];
  }
  const pct = ctx.contextWindow > 0 ? Math.round((ctx.usedTokens / ctx.contextWindow) * 100) : 0;
  return [`context: ${formatCount(ctx.usedTokens)} / ${formatCount(ctx.contextWindow)} tokens (${pct}%)`];
}

function configLines(ctx: SlashContext): string[] {
  return [
    `provider: ${ctx.provider}`,
    `model:    ${ctx.model}`,
    `mode:     ${ctx.mode}`,
    `cwd:      ${ctx.cwd}`,
    `branch:   ${ctx.branch ?? "(none)"}`,
    `context:  ${formatCount(ctx.contextWindow)} tokens`,
  ];
}

function modelCommand(parsed: ParsedSlash, ctx: SlashContext): SlashResult {
  const target = parsed.args[0];
  if (!target) {
    const lines = [`current model: ${ctx.model}`];
    if (ctx.models.length > 0) lines.push(`available: ${ctx.models.join(", ")}`);
    return { lines, effect: { kind: "none" } };
  }
  if (!ctx.canSwitchModel) {
    return { lines: ["switching models is not supported in this build"], effect: { kind: "none" } };
  }
  if (target === ctx.model) {
    return { lines: [`already on ${target}`], effect: { kind: "none" } };
  }
  const lines = [`switching model to ${target}...`];
  // A model outside the known catalog can still be valid (the catalog is not
  // exhaustive); switch anyway but flag it so a typo is obvious.
  if (ctx.models.length > 0 && !ctx.models.includes(target)) {
    lines.unshift(`note: ${target} is not in the known catalog`);
  }
  return { lines, effect: { kind: "switch_model", model: target } };
}

function modeCommand(parsed: ParsedSlash, ctx: SlashContext): SlashResult {
  const target = parsed.args[0]?.toLowerCase();
  if (!target) {
    return {
      lines: [`current mode: ${ctx.mode}`, `available: ${PERMISSION_MODES.join(", ")}`],
      effect: { kind: "none" },
    };
  }
  if (!(PERMISSION_MODES as readonly string[]).includes(target)) {
    return {
      lines: [`unknown mode: ${target}. available: ${PERMISSION_MODES.join(", ")}`],
      effect: { kind: "none" },
    };
  }
  if (target === ctx.mode) {
    return { lines: [`already in ${target} mode`], effect: { kind: "none" } };
  }
  return { lines: [`mode -> ${target}`], effect: { kind: "set_mode", mode: target as PermissionMode } };
}

function compactCommand(ctx: SlashContext): SlashResult {
  if (!ctx.canCompact) {
    return { lines: ["compaction is not available in this build"], effect: { kind: "none" } };
  }
  return { lines: ["compacting context..."], effect: { kind: "compact" } };
}

function agentCommand(parsed: ParsedSlash, ctx: SlashContext): SlashResult {
  if (!ctx.canRunAgent) {
    return { lines: ["subagents are not available in this build"], effect: { kind: "none" } };
  }
  if (!parsed.rest) {
    return { lines: ["usage: /agent <task>"], effect: { kind: "none" } };
  }
  return { lines: [`spawning subagent: ${parsed.rest}`], effect: { kind: "run_agent", task: parsed.rest } };
}

export function runSlashCommand(text: string, ctx: SlashContext): SlashResult {
  const parsed = parseSlashInput(text);
  if (!parsed || parsed.name === "") {
    return { lines: ["type /help for a list of commands"], effect: { kind: "none" } };
  }

  switch (parsed.name) {
    case "help":
      return { lines: helpLines(), effect: { kind: "none" } };
    case "usage":
      return { lines: usageLines(ctx), effect: { kind: "none" } };
    case "config":
      return { lines: configLines(ctx), effect: { kind: "none" } };
    case "model":
      return modelCommand(parsed, ctx);
    case "mode":
      return modeCommand(parsed, ctx);
    case "compact":
      return compactCommand(ctx);
    case "agent":
      return agentCommand(parsed, ctx);
    case "clear":
      return { lines: [], effect: { kind: "clear" } };
    case "exit":
    case "quit":
      return { lines: [], effect: { kind: "exit" } };
    default:
      return { lines: [`unknown command: /${parsed.name} (type /help)`], effect: { kind: "none" } };
  }
}
