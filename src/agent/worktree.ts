import { exec } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";

const execAsync = promisify(exec);

export interface WorktreeHandle {
  path: string;
  branch: string;
  cleanup(): Promise<void>;
}

export async function createWorktree(
  cwd: string,
  name: string,
): Promise<WorktreeHandle | null> {
  // Forward slashes on every platform: git for Windows accepts them, Node's
  // child_process honours them as a cwd, and it keeps handle.path stable across
  // OSes (win32 join() would otherwise emit backslashes only on Windows).
  const worktreePath = join(cwd, ".forge", "worktrees", name).replace(/\\/g, "/");
  const branch = `forge/${name}`;

  try {
    await execAsync(`git worktree add "${worktreePath}" -b "${branch}"`, { cwd });
  } catch {
    return null;
  }

  return {
    path: worktreePath,
    branch,
    async cleanup() {
      await execAsync(`git worktree remove "${worktreePath}" --force`, { cwd }).catch(() => {});
      await execAsync(`git branch -D "${branch}"`, { cwd }).catch(() => {});
    },
  };
}

export async function mergeWorktree(
  cwd: string,
  handle: WorktreeHandle,
): Promise<{ success: boolean; conflicts?: string[] }> {
  try {
    await execAsync(`git merge "${handle.branch}" --no-edit`, { cwd });
  } catch (err) {
    const execErr = err as { stdout?: string; stderr?: string };
    const output = [execErr.stdout, execErr.stderr].filter(Boolean).join("\n");
    const conflicts = output
      .split("\n")
      .filter((line) => line.startsWith("CONFLICT") || line.includes("Merge conflict"))
      .map((line) => line.trim());

    await execAsync("git merge --abort", { cwd }).catch(() => {});
    return {
      success: false,
      conflicts: conflicts.length > 0 ? conflicts : ["merge failed (unknown conflict)"],
    };
  }

  await handle.cleanup();
  return { success: true };
}
