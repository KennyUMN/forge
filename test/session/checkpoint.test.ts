import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile, mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCheckpoint, rewindToCheckpoint } from "../../src/session/checkpoint.js";

const execFileAsync = promisify(execFile);

async function gitInit(dir: string): Promise<void> {
  await execFileAsync("git", ["init"], { cwd: dir });
  await execFileAsync("git", ["config", "user.email", "test@forge.dev"], { cwd: dir });
  await execFileAsync("git", ["config", "user.name", "Forge Test"], { cwd: dir });
}

describe("checkpoint", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "forge-cp-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe("createCheckpoint", () => {
    it("returns null for a non-git directory", async () => {
      const result = await createCheckpoint(dir, "sess-1", "entry-1", "write_file");
      expect(result).toBeNull();
    });

    it("creates a checkpoint commit on the shadow branch", async () => {
      await gitInit(dir);
      await writeFile(join(dir, "hello.txt"), "initial");
      await execFileAsync("git", ["add", "-A"], { cwd: dir });
      await execFileAsync("git", ["commit", "-m", "initial"], { cwd: dir });

      const cp = await createCheckpoint(dir, "sess-1", "entry-1", "write_file");

      expect(cp).not.toBeNull();
      expect(cp!.sessionId).toBe("sess-1");
      expect(cp!.entryId).toBe("entry-1");
      expect(cp!.toolName).toBe("write_file");
      expect(cp!.commitHash).toMatch(/^[0-9a-f]{40}$/);

      const { stdout } = await execFileAsync("git", ["log", "--oneline", "-1", cp!.commitHash], { cwd: dir });
      expect(stdout).toContain("forge-checkpoint: write_file [entry-1]");
    }, 15_000);

    it("does not disturb the user's current branch", async () => {
      await gitInit(dir);
      await writeFile(join(dir, "file.txt"), "content");
      await execFileAsync("git", ["add", "-A"], { cwd: dir });
      await execFileAsync("git", ["commit", "-m", "initial"], { cwd: dir });

      await createCheckpoint(dir, "sess-1", "entry-1", "bash");

      const { stdout } = await execFileAsync("git", ["branch", "--show-current"], { cwd: dir });
      expect(stdout.trim()).not.toBe("forge/checkpoints");
    }, 15_000);
  });

  describe("rewindToCheckpoint", () => {
    it("restores the working tree to the checkpoint state", async () => {
      await gitInit(dir);
      await writeFile(join(dir, "app.ts"), "version 1");
      await execFileAsync("git", ["add", "-A"], { cwd: dir });
      await execFileAsync("git", ["commit", "-m", "initial"], { cwd: dir });

      const cp = await createCheckpoint(dir, "sess-1", "entry-1", "write_file");
      expect(cp).not.toBeNull();

      await writeFile(join(dir, "app.ts"), "version 2 - mutated");
      await writeFile(join(dir, "extra.txt"), "should be removed");
      await execFileAsync("git", ["add", "-A"], { cwd: dir });

      await rewindToCheckpoint(dir, cp!);

      const content = await readFile(join(dir, "app.ts"), "utf8");
      expect(content).toBe("version 1");
      // A file created after the checkpoint must be gone: rewind restores the
      // snapshot exactly, it is not a partial file-content revert.
      await expect(readFile(join(dir, "extra.txt"), "utf8")).rejects.toThrow();
    }, 15_000);
  });

  it("preserves the user's pre-existing staged index while checkpointing", async () => {
    await gitInit(dir);
    await writeFile(join(dir, "committed.txt"), "v1");
    await execFileAsync("git", ["add", "-A"], { cwd: dir });
    await execFileAsync("git", ["commit", "-m", "initial"], { cwd: dir });

    // The user stages a change but has not committed it.
    await writeFile(join(dir, "staged.txt"), "user staged this");
    await execFileAsync("git", ["add", "staged.txt"], { cwd: dir });

    await createCheckpoint(dir, "sess-1", "entry-1", "write_file");

    // Checkpointing must not touch the real index: staged.txt stays staged.
    const { stdout } = await execFileAsync("git", ["diff", "--cached", "--name-only"], { cwd: dir });
    expect(stdout).toContain("staged.txt");
  }, 15_000);
});
