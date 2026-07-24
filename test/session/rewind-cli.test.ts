import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCheckpoint, listCheckpoints, rewindToCheckpoint } from "../../src/session/checkpoint.js";

const execFileAsync = promisify(execFile);

const GIT_TIMEOUT = 30_000;

async function gitInit(dir: string): Promise<void> {
  await execFileAsync("git", ["init"], { cwd: dir });
  await execFileAsync("git", ["config", "user.email", "test@forge.dev"], { cwd: dir });
  await execFileAsync("git", ["config", "user.name", "Forge Test"], { cwd: dir });
}

describe("rewind CLI", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "forge-rewind-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe("listCheckpoints", () => {
    it("returns an empty array when no checkpoints exist", async () => {
      await gitInit(dir);
      await writeFile(join(dir, "file.txt"), "content");
      await execFileAsync("git", ["add", "-A"], { cwd: dir });
      await execFileAsync("git", ["commit", "-m", "initial"], { cwd: dir });

      const checkpoints = await listCheckpoints(dir);
      expect(checkpoints).toEqual([]);
    }, GIT_TIMEOUT);

    it("returns an empty array for a non-git directory", async () => {
      const checkpoints = await listCheckpoints(dir);
      expect(checkpoints).toEqual([]);
    });

    it("lists checkpoints in most-recent-first order", async () => {
      await gitInit(dir);
      await writeFile(join(dir, "file.txt"), "v1");
      await execFileAsync("git", ["add", "-A"], { cwd: dir });
      await execFileAsync("git", ["commit", "-m", "initial"], { cwd: dir });

      await createCheckpoint(dir, "sess-1", "entry-1", "write_file");
      await writeFile(join(dir, "file.txt"), "v2");
      await execFileAsync("git", ["add", "-A"], { cwd: dir });
      await execFileAsync("git", ["commit", "-m", "second"], { cwd: dir });
      await createCheckpoint(dir, "sess-1", "entry-2", "bash");

      const checkpoints = await listCheckpoints(dir);
      expect(checkpoints).toHaveLength(2);
      expect(checkpoints[0].toolName).toBe("bash");
      expect(checkpoints[0].entryId).toBe("entry-2");
      expect(checkpoints[1].toolName).toBe("write_file");
      expect(checkpoints[1].entryId).toBe("entry-1");
    }, GIT_TIMEOUT);

    it("parses commit hash and metadata correctly", async () => {
      await gitInit(dir);
      await writeFile(join(dir, "file.txt"), "v1");
      await execFileAsync("git", ["add", "-A"], { cwd: dir });
      await execFileAsync("git", ["commit", "-m", "initial"], { cwd: dir });

      const created = await createCheckpoint(dir, "sess-1", "entry-1", "write_file");
      const checkpoints = await listCheckpoints(dir);

      expect(checkpoints).toHaveLength(1);
      expect(checkpoints[0].commitHash).toBe(created!.commitHash);
      expect(checkpoints[0].sessionId).toBe("sess-1");
      expect(checkpoints[0].entryId).toBe("entry-1");
      expect(checkpoints[0].toolName).toBe("write_file");
    }, GIT_TIMEOUT);
  });

  describe("rewind to most recent checkpoint", () => {
    it("restores working tree to the latest checkpoint state", async () => {
      await gitInit(dir);
      await writeFile(join(dir, "app.ts"), "version 1");
      await execFileAsync("git", ["add", "-A"], { cwd: dir });
      await execFileAsync("git", ["commit", "-m", "initial"], { cwd: dir });

      await createCheckpoint(dir, "sess-1", "entry-1", "write_file");

      await writeFile(join(dir, "app.ts"), "version 2 - mutated");
      await execFileAsync("git", ["add", "-A"], { cwd: dir });
      await execFileAsync("git", ["commit", "-m", "mutation"], { cwd: dir });

      const checkpoints = await listCheckpoints(dir);
      expect(checkpoints.length).toBeGreaterThan(0);
      await rewindToCheckpoint(dir, checkpoints[0]);

      const content = await readFile(join(dir, "app.ts"), "utf8");
      expect(content).toBe("version 1");
    }, GIT_TIMEOUT);
  });

  describe("rewind N checkpoints back", () => {
    it("restores working tree to the Nth checkpoint", async () => {
      await gitInit(dir);
      await writeFile(join(dir, "app.ts"), "version 1");
      await execFileAsync("git", ["add", "-A"], { cwd: dir });
      await execFileAsync("git", ["commit", "-m", "initial"], { cwd: dir });

      await createCheckpoint(dir, "sess-1", "entry-1", "write_file");

      await writeFile(join(dir, "app.ts"), "version 2");
      await execFileAsync("git", ["add", "-A"], { cwd: dir });
      await execFileAsync("git", ["commit", "-m", "v2"], { cwd: dir });
      await createCheckpoint(dir, "sess-1", "entry-2", "bash");

      await writeFile(join(dir, "app.ts"), "version 3");
      await execFileAsync("git", ["add", "-A"], { cwd: dir });
      await execFileAsync("git", ["commit", "-m", "v3"], { cwd: dir });
      await createCheckpoint(dir, "sess-1", "entry-3", "write_file");

      const checkpoints = await listCheckpoints(dir);
      expect(checkpoints).toHaveLength(3);

      await rewindToCheckpoint(dir, checkpoints[1]);
      const content = await readFile(join(dir, "app.ts"), "utf8");
      expect(content).toBe("version 2");
    }, GIT_TIMEOUT);
  });

  describe("error when no checkpoints exist", () => {
    it("listCheckpoints returns empty and rewind cannot proceed", async () => {
      await gitInit(dir);
      await writeFile(join(dir, "file.txt"), "content");
      await execFileAsync("git", ["add", "-A"], { cwd: dir });
      await execFileAsync("git", ["commit", "-m", "initial"], { cwd: dir });

      const checkpoints = await listCheckpoints(dir);
      expect(checkpoints).toHaveLength(0);
    }, GIT_TIMEOUT);
  });
});
