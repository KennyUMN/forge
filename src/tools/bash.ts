import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { Tool, ToolExecutionContext, ToolExecutionResult } from "../tool/tool.js";
import { resolveShell } from "./shell.js";

const execAsync = promisify(exec);

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_BUFFER_BYTES = 10 * 1024 * 1024;

interface BashInput {
  command: string;
}

async function execute(input: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult> {
  const { command } = (input ?? {}) as Partial<BashInput>;
  if (typeof command !== "string") {
    return { output: `Invalid input: "command" must be a string.`, isError: true };
  }

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: context.cwd,
      timeout: DEFAULT_TIMEOUT_MS,
      maxBuffer: MAX_BUFFER_BYTES,
      // undefined means "use exec()'s per-platform default"; on Windows this
      // resolves to Git Bash so the model writes POSIX commands everywhere.
      shell: resolveShell(),
      signal: context.signal,
    });
    const output = [stdout, stderr].filter((part) => part.length > 0).join("\n");
    return { output: output.length > 0 ? output : "(command produced no output)", isError: false };
  } catch (err) {
    const execError = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string; killed?: boolean; signal?: string };
    // Checked before the timeout branch: an abort also kills the child with
    // SIGTERM, so the two are indistinguishable by signal alone and a
    // user-interrupted command would otherwise be reported as a timeout.
    if (context.signal?.aborted) {
      return { output: `Command interrupted: ${command}`, isError: true };
    }
    if (execError.killed && execError.signal === "SIGTERM") {
      return { output: `Command timed out after ${DEFAULT_TIMEOUT_MS}ms: ${command}`, isError: true };
    }
    const combined = [execError.stdout, execError.stderr, execError.message].filter(Boolean).join("\n");
    return { output: combined, isError: true };
  }
}

export const bashTool: Tool = {
  name: "bash",
  description: "Runs a shell command in the working directory and returns its combined stdout/stderr.",
  parameters: {
    type: "object",
    properties: { command: { type: "string", description: "The shell command to run." } },
    required: ["command"],
  },
  execute,
};
