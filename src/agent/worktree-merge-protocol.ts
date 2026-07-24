import { exec, spawn } from "node:child_process";
import { promisify } from "node:util";
import type { WorktreeHandle } from "./worktree.js";

const execAsync = promisify(exec);

const MAX_BUFFER = 10 * 1024 * 1024;

function applyCheck(patch: string, cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["apply", "--check"], { cwd, stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `git apply --check exited with code ${code}`));
    });
    child.stdin.write(patch);
    child.stdin.end();
  });
}

export interface MergeProtocolResult {
  accepted: boolean;
  reason: string;
  verificationOutput?: string;
}

export async function mergeWithVerification(
  cwd: string,
  handle: WorktreeHandle,
  verifyCommand?: string,
): Promise<MergeProtocolResult> {
  const baseBranch = await resolveBaseBranch(cwd);
  const preMergeHead = await resolveHead(cwd);

  let patch: string;
  try {
    const diffResult = await execAsync(
      `git --no-pager diff ${baseBranch}...${handle.branch}`,
      { cwd, maxBuffer: MAX_BUFFER },
    );
    patch = diffResult.stdout;
  } catch (err) {
    await handle.cleanup();
    const message = err instanceof Error ? err.message : String(err);
    return { accepted: false, reason: `failed to generate diff: ${message}` };
  }

  if (patch.trim().length === 0) {
    await handle.cleanup();
    return { accepted: false, reason: "no changes in worktree branch" };
  }

  try {
    await applyCheck(patch, cwd);
  } catch (err) {
    await handle.cleanup();
    const message = err instanceof Error ? err.message : String(err);
    return { accepted: false, reason: `dry-run apply failed (conflict): ${message.trim()}` };
  }

  try {
    await execAsync(`git merge "${handle.branch}" --no-edit`, { cwd });
  } catch (err) {
    await execAsync("git merge --abort", { cwd }).catch(() => {});
    await handle.cleanup();
    const execErr = err as { stderr?: string; message?: string };
    const detail = execErr.stderr || execErr.message || "merge failed";
    return { accepted: false, reason: `merge failed (conflict): ${detail.trim()}` };
  }

  if (!verifyCommand) {
    await handle.cleanup();
    return { accepted: true, reason: "dry-run passed, merged without verification" };
  }

  try {
    await execAsync(verifyCommand, { cwd, maxBuffer: MAX_BUFFER });
  } catch (err) {
    const execErr = err as { stdout?: string; stderr?: string; message?: string };
    const output = [execErr.stdout, execErr.stderr].filter(Boolean).join("\n").trim()
      || execErr.message
      || "verification failed";

    await execAsync(`git reset --hard ${preMergeHead}`, { cwd }).catch(() => {});
    await handle.cleanup();
    return { accepted: false, reason: "verification failed after merge", verificationOutput: output };
  }

  await handle.cleanup();
  return { accepted: true, reason: "merge accepted, verification passed" };
}

async function resolveBaseBranch(cwd: string): Promise<string> {
  const { stdout } = await execAsync("git rev-parse --abbrev-ref HEAD", { cwd });
  return stdout.trim();
}

async function resolveHead(cwd: string): Promise<string> {
  const { stdout } = await execAsync("git rev-parse HEAD", { cwd });
  return stdout.trim();
}
