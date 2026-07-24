import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { createWorktree, mergeWorktree } from "../../src/agent/worktree.js";

const execAsync = promisify(exec);

async function initGitRepo(dir: string): Promise<void> {
  await execAsync("git init", { cwd: dir });
  await execAsync("git config user.email test@test.com", { cwd: dir });
  await execAsync("git config user.name Test", { cwd: dir });
  await writeFile(join(dir, "README.md"), "# Test\n", "utf8");
  await execAsync("git add -A && git commit -m init", { cwd: dir });
}

describe("worktree", () => {
  let repoDir: string;

  beforeEach(async () => {
    repoDir = await mkdtemp(join(tmpdir(), "forge-wt-"));
    await initGitRepo(repoDir);
  });

  afterEach(async () => {
    await rm(repoDir, { recursive: true, force: true });
  });

  describe("createWorktree", () => {
    it("creates a worktree with a new branch and returns a handle", async () => {
      const handle = await createWorktree(repoDir, "task-a");

      expect(handle).not.toBeNull();
      expect(handle!.path).toContain(".forge/worktrees/task-a");
      expect(handle!.branch).toBe("forge/task-a");

      const { stdout } = await execAsync("git branch --list forge/task-a", { cwd: repoDir });
      expect(stdout.trim()).toContain("forge/task-a");
    });

    it("returns null for a non-git directory", async () => {
      const nonGit = await mkdtemp(join(tmpdir(), "forge-nongit-"));
      try {
        const handle = await createWorktree(nonGit, "x");
        expect(handle).toBeNull();
      } finally {
        await rm(nonGit, { recursive: true, force: true });
      }
    });

    it("cleanup removes the worktree and branch", async () => {
      const handle = await createWorktree(repoDir, "cleanup-test");
      expect(handle).not.toBeNull();

      await handle!.cleanup();

      const { stdout } = await execAsync("git branch --list forge/cleanup-test", { cwd: repoDir });
      expect(stdout.trim()).toBe("");
    });
  });

  describe("mergeWorktree", () => {
    it("merges changes from the worktree branch back into the main branch", async () => {
      const handle = await createWorktree(repoDir, "merge-test");
      expect(handle).not.toBeNull();

      await writeFile(join(handle!.path, "new-file.txt"), "content\n", "utf8");
      await execAsync('git add -A && git commit -m "add file"', { cwd: handle!.path });

      const result = await mergeWorktree(repoDir, handle!);

      expect(result.success).toBe(true);
      expect(result.conflicts).toBeUndefined();

      const { stdout } = await execAsync("cat new-file.txt", { cwd: repoDir });
      expect(stdout).toContain("content");
    });

    it("returns conflicts without forcing when merge conflicts occur", async () => {
      const handle = await createWorktree(repoDir, "conflict-test");
      expect(handle).not.toBeNull();

      await writeFile(join(handle!.path, "README.md"), "worktree version\n", "utf8");
      await execAsync('git add -A && git commit -m "wt change"', { cwd: handle!.path });

      await writeFile(join(repoDir, "README.md"), "main version\n", "utf8");
      await execAsync('git add -A && git commit -m "main change"', { cwd: repoDir });

      const result = await mergeWorktree(repoDir, handle!);

      expect(result.success).toBe(false);
      expect(result.conflicts).toBeDefined();
      expect(result.conflicts!.length).toBeGreaterThan(0);

      await execAsync("git merge --abort", { cwd: repoDir }).catch(() => {});
      await handle!.cleanup();
    });
  });
});
