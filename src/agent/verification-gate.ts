import { exec } from "node:child_process";
import { promisify } from "node:util";
import { readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { resolveShell } from "../tools/shell.js";

const execAsync = promisify(exec);

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_BUFFER_BYTES = 10 * 1024 * 1024;
const MAX_OUTPUT_LINES = 100;

export interface VerificationConfig {
  command: string;
  timeout?: number;
  maxRetries?: number;
}

export type VerificationVerdict =
  | { action: "pass" }
  | { action: "fail"; output: string; attempt: number }
  | { action: "skip"; reason: string };

function boundOutput(output: string): string {
  const lines = output.split("\n");
  if (lines.length <= MAX_OUTPUT_LINES) return output;
  return lines.slice(-MAX_OUTPUT_LINES).join("\n");
}

export async function runVerification(
  config: VerificationConfig,
  context: { cwd: string; signal?: AbortSignal },
  attempt: number = 1,
): Promise<VerificationVerdict> {
  if (!config.command || config.command.trim().length === 0) {
    return { action: "skip", reason: "empty command" };
  }

  const timeout = config.timeout ?? DEFAULT_TIMEOUT_MS;

  try {
    await execAsync(config.command, {
      cwd: context.cwd,
      timeout,
      maxBuffer: MAX_BUFFER_BYTES,
      shell: resolveShell(),
      signal: context.signal,
    });
    return { action: "pass" };
  } catch (err) {
    const execError = err as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      killed?: boolean;
      signal?: string;
    };

    if (execError.killed && execError.signal === "SIGTERM") {
      return {
        action: "fail",
        output: `Verification command timed out after ${timeout}ms: ${config.command}`,
        attempt,
      };
    }

    const combined = [execError.stdout, execError.stderr]
      .filter((part): part is string => Boolean(part && part.length > 0))
      .join("\n");
    const output = combined.length > 0 ? combined : execError.message;
    return { action: "fail", output: boundOutput(output), attempt };
  }
}

export function formatVerificationFailure(
  config: VerificationConfig,
  verdict: Extract<VerificationVerdict, { action: "fail" }>,
  maxRetries: number,
): string {
  return [
    "[VERIFICATION FAILED] The following command must pass before you can finish:",
    `Command: ${config.command}`,
    `Attempt: ${verdict.attempt}/${maxRetries}`,
    "",
    "Output:",
    verdict.output,
    "",
    "Fix the issues and try again. Do not stop until verification passes.",
  ].join("\n");
}

export async function detectVerificationCommand(cwd: string): Promise<string | null> {
  try {
    const raw = await readFile(join(cwd, "package.json"), "utf-8");
    const pkg = JSON.parse(raw) as { scripts?: Record<string, string> };
    if (pkg.scripts?.test) return "npm test";
  } catch {
    // no package.json or unparseable
  }

  try {
    await access(join(cwd, "tsconfig.json"));
    return "npx tsc --noEmit";
  } catch {
    // no tsconfig.json
  }

  return null;
}
