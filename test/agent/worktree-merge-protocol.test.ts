import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { createWorktree } from "../../src/agent/worktree.js";
import { mergeWithVerification } from "../../src/agent/worktree-merge-protocol.js";

const execAsync = promisify(exec);

async function initGitRepo(dir: string): Promise<void> {
  await execAsync("git init", { cwd: dir });
  await execAsync("git config user.email test@test.com", { cwd: dir });
  await execAsync("git config user.name Test", { cwd: dir });
  await writeFile(join(dir, "README.md"), "# Test\n", "utf8");
  await execAsync("git add -A && git commit -m init", { cwd: dir });
}

describe("mergeWithVerification", () => {
  let repoDir: string;

  beforeEach(async () => {
    repoDir = await mkdtemp(join(tmpdir(), "forge-merge-proto-"));
    await initGitRepo(repoDir);
  });

  afterEach(async () => {
    await rm(repoDir, { recursive: true, force: true });
  });

  it("accepts a merge when verification passes", async () => {
    const handle = await createWorktree(repoDir, "verify-pass");
    expect(handle).not.toBeNull();

    await writeFile(join(handle!.path, "feature.txt"), "hello\n", "utf8");
    await execAsync("git add -A && git commit -m 'add feature'", { cwd: handle!.path });

    const result = await mergeWithVerification(repoDir, handle!, "true");

    expect(result.accepted).toBe(true);
    expect(result.reason).toContain("passed");

    const content = await readFile(join(repoDir, "feature.txt"), "utf8");
    expect(content).toBe("hello\n");
  }, 30_000);

  it("rejects and restores working tree when verification fails", async () => {
    const handle = await createWorktree(repoDir, "verify-fail");
    expect(handle).not.toBeNull();

    await writeFile(join(handle!.path, "bad.txt"), "bad content\n", "utf8");
    await execAsync("git add -A && git commit -m 'add bad file'", { cwd: handle!.path });

    const result = await mergeWithVerification(repoDir, handle!, "false");

    expect(result.accepted).toBe(false);
    expect(result.reason).toContain("verification");
    expect(result.verificationOutput).toBeDefined();

    const { stdout } = await execAsync("git status --porcelain", { cwd: repoDir });
    expect(stdout.trim()).toBe("");

    const { stdout: log } = await execAsync("git log --oneline -1", { cwd: repoDir });
    expect(log).toContain("init");
  }, 30_000);

  it("rejects when dry-run apply fails due to conflicts", async () => {
    const handle = await createWorktree(repoDir, "dry-run-fail");
    expect(handle).not.toBeNull();

    await writeFile(join(handle!.path, "README.md"), "worktree version\n", "utf8");
    await execAsync("git add -A && git commit -m 'wt change'", { cwd: handle!.path });

    await writeFile(join(repoDir, "README.md"), "main version\n", "utf8");
    await execAsync("git add -A && git commit -m 'main change'", { cwd: repoDir });

    const result = await mergeWithVerification(repoDir, handle!);

    expect(result.accepted).toBe(false);
    expect(result.reason).toContain("conflict");

    const content = await readFile(join(repoDir, "README.md"), "utf8");
    expect(content).toBe("main version\n");
  }, 30_000);

  it("merges without verification when no verifyCommand is provided", async () => {
    const handle = await createWorktree(repoDir, "no-verify");
    expect(handle).not.toBeNull();

    await writeFile(join(handle!.path, "simple.txt"), "data\n", "utf8");
    await execAsync("git add -A && git commit -m 'add simple'", { cwd: handle!.path });

    const result = await mergeWithVerification(repoDir, handle!);

    expect(result.accepted).toBe(true);
    expect(result.reason).toContain("dry-run");

    const content = await readFile(join(repoDir, "simple.txt"), "utf8");
    expect(content).toBe("data\n");
  }, 30_000);
});
