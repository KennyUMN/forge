import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { minimatch } from "minimatch";
import { resolveShell } from "../tools/shell.js";

export interface HookConfig {
  event: "pre_tool" | "post_tool";
  matcher?: string;
  command: string;
  paths?: string[];
}

export interface HookResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  blocked?: boolean;
}

export interface HookContext {
  toolName: string;
  input: unknown;
  cwd: string;
}

const HOOK_TIMEOUT_MS = 30_000;

export async function loadHooks(cwd: string): Promise<HookConfig[]> {
  const hooksPath = join(cwd, ".forge", "hooks.json");
  let raw: string;
  try {
    raw = await readFile(hooksPath, "utf8");
  } catch {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as { hooks?: unknown };
    if (!Array.isArray(parsed.hooks)) return [];
    return parsed.hooks.filter(isValidHookConfig);
  } catch {
    return [];
  }
}

function isValidHookConfig(value: unknown): value is HookConfig {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  if (obj.event !== "pre_tool" && obj.event !== "post_tool") return false;
  if (typeof obj.command !== "string" || obj.command.length === 0) return false;
  if (obj.matcher !== undefined && typeof obj.matcher !== "string") return false;
  if (obj.paths !== undefined && !Array.isArray(obj.paths)) return false;
  return true;
}

export function matchesHook(hook: HookConfig, toolName: string, input: unknown): boolean {
  if (hook.matcher && !minimatch(toolName, hook.matcher)) {
    return false;
  }

  if (hook.paths && hook.paths.length > 0) {
    const targetPath = extractPath(input);
    if (!targetPath) return false;
    return hook.paths.some((pattern) => minimatch(targetPath, pattern));
  }

  return true;
}

function extractPath(input: unknown): string | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const obj = input as Record<string, unknown>;
  if (typeof obj.path === "string") return obj.path;
  if (typeof obj.file_path === "string") return obj.file_path;
  return undefined;
}

// Single-quote a value for safe shell interpolation — prevents metacharacter injection.
function shellEscape(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export async function runHook(hook: HookConfig, context: HookContext): Promise<HookResult> {
  const targetPath = extractPath(context.input);
  const command = targetPath
    ? hook.command.replace(/\$FILE_PATH/g, shellEscape(targetPath))
    : hook.command;

  return new Promise<HookResult>((resolve) => {
    execFile(
      resolveShell() ?? "/bin/sh",
      ["-c", command],
      { cwd: context.cwd, timeout: HOOK_TIMEOUT_MS, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        const exitCode = error ? (typeof (error as { code?: unknown }).code === "number" ? (error as { code: number }).code : 1) : 0;
        const blocked = hook.event === "pre_tool" && exitCode !== 0 ? true : undefined;
        resolve({ exitCode, stdout, stderr, blocked });
      },
    );
  });
}
