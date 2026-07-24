import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolveShell } from "../tools/shell.js";

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface Executor {
  readonly name: string;
  executeCommand(command: string, options: { cwd: string; signal?: AbortSignal; timeout?: number }): Promise<CommandResult>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_BUFFER_BYTES = 10 * 1024 * 1024;

export class LocalExecutor implements Executor {
  readonly name = "local";

  executeCommand(command: string, options: { cwd: string; signal?: AbortSignal; timeout?: number }): Promise<CommandResult> {
    const { cwd, signal, timeout = DEFAULT_TIMEOUT_MS } = options;

    return new Promise<CommandResult>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error("Aborted"));
        return;
      }

      const child = execFile(
        resolveShell() ?? "/bin/sh",
        ["-c", command],
        { cwd, timeout, maxBuffer: MAX_BUFFER_BYTES },
        (error, stdout, stderr) => {
          if (signal?.aborted) {
            reject(new Error("Aborted"));
            return;
          }
          if (!error) {
            resolve({ stdout, stderr, exitCode: 0 });
            return;
          }
          const execErr = error as Error & { code?: number | string; killed?: boolean; signal?: string };
          if (execErr.killed && execErr.signal === "SIGTERM") {
            reject(new Error(`Command timed out after ${timeout}ms`));
            return;
          }
          const exitCode = typeof execErr.code === "number" ? execErr.code : 1;
          resolve({ stdout, stderr, exitCode });
        },
      );

      if (signal) {
        // Reject as soon as the signal fires rather than waiting for the exec
        // callback: on Windows, kill() terminates the shell but a grandchild
        // (e.g. Git Bash's `sleep`) keeps the stdout pipe open, so the callback
        // would not fire until that grandchild exits on its own. Kill is
        // best-effort cleanup; the promise settles immediately either way.
        const onAbort = () => {
          child.kill("SIGTERM");
          reject(new Error("Aborted"));
        };
        signal.addEventListener("abort", onAbort, { once: true });
        child.on("close", () => signal.removeEventListener("abort", onAbort));
      }
    });
  }

  async readFile(path: string): Promise<string> {
    return readFile(path, "utf8");
  }

  async writeFile(path: string, content: string): Promise<void> {
    await writeFile(path, content, "utf8");
  }
}
