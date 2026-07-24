import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildEnvironmentPreamble } from "../../src/agent/preamble.js";

const execFileAsync = promisify(execFile);

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "forge-preamble-"));
});

afterEach(async () => {
  // maxRetries rides out Windows EBUSY: an aborted child (find/git) can still
  // hold the cwd for a beat after the test resolves, locking the directory.
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("buildEnvironmentPreamble", () => {
  it("includes the working directory", async () => {
    const preamble = await buildEnvironmentPreamble({
      cwd: dir,
      toolNames: ["bash", "read_file"],
      maxSteps: 50,
    });

    expect(preamble).toContain(`Working directory: ${dir}`);
  });

  it("includes tool names as a comma-separated list", async () => {
    const preamble = await buildEnvironmentPreamble({
      cwd: dir,
      toolNames: ["bash", "read_file", "write_file", "edit_file", "glob", "grep"],
      maxSteps: 50,
    });

    expect(preamble).toContain("bash, read_file, write_file, edit_file, glob, grep");
    expect(preamble).toContain("## Available tools");
  });

  it("includes the step budget", async () => {
    const preamble = await buildEnvironmentPreamble({
      cwd: dir,
      toolNames: ["bash"],
      maxSteps: 25,
    });

    expect(preamble).toContain("Step budget: 25");
    expect(preamble).toContain("## Constraints");
  });

  it("includes directory tree entries for files in the cwd", async () => {
    await writeFile(join(dir, "hello.ts"), "export const x = 1;", "utf8");
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "src", "index.ts"), "export {};", "utf8");

    const preamble = await buildEnvironmentPreamble({
      cwd: dir,
      toolNames: ["bash"],
      maxSteps: 50,
    });

    expect(preamble).toContain("## Project structure (depth 2)");
    expect(preamble).toContain("hello.ts");
    expect(preamble).toContain("./src");
  });

  it("skips git section gracefully when not in a git repo", async () => {
    const preamble = await buildEnvironmentPreamble({
      cwd: dir,
      toolNames: ["bash"],
      maxSteps: 50,
    });

    expect(preamble).not.toContain("Git branch:");
    expect(preamble).toContain("Working directory:");
  });

  it("includes git branch info when in a git repo", async () => {
    await execFileAsync("git", ["init"], { cwd: dir });
    await execFileAsync("git", ["checkout", "-b", "test-branch"], { cwd: dir });
    await writeFile(join(dir, "file.txt"), "content", "utf8");

    const preamble = await buildEnvironmentPreamble({
      cwd: dir,
      toolNames: ["bash"],
      maxSteps: 50,
    });

    expect(preamble).toContain("Git branch: test-branch");
  });

  it("reports modified file count in git status", async () => {
    await execFileAsync("git", ["init"], { cwd: dir });
    await execFileAsync("git", ["config", "user.email", "test@test.com"], { cwd: dir });
    await execFileAsync("git", ["config", "user.name", "Test"], { cwd: dir });
    await writeFile(join(dir, "a.txt"), "a", "utf8");
    await writeFile(join(dir, "b.txt"), "b", "utf8");
    await execFileAsync("git", ["add", "."], { cwd: dir });
    await execFileAsync("git", ["commit", "-m", "init"], { cwd: dir });
    await writeFile(join(dir, "a.txt"), "modified", "utf8");
    await writeFile(join(dir, "b.txt"), "modified", "utf8");

    const preamble = await buildEnvironmentPreamble({
      cwd: dir,
      toolNames: ["bash"],
      maxSteps: 50,
    });

    expect(preamble).toContain("2 modified files");
  });

  it("bounds the directory tree output to 100 lines", async () => {
    for (let i = 0; i < 150; i++) {
      await writeFile(join(dir, `file-${String(i).padStart(3, "0")}.txt`), "x", "utf8");
    }

    const preamble = await buildEnvironmentPreamble({
      cwd: dir,
      toolNames: ["bash"],
      maxSteps: 50,
    });

    const treeSection = preamble.split("## Project structure (depth 2)")[1]?.split("##")[0] ?? "";
    const treeLines = treeSection.split("\n").filter((l) => l.trim().length > 0);
    expect(treeLines.length).toBeLessThanOrEqual(100);
  });

  it("completes within 2 seconds", async () => {
    const start = performance.now();
    await buildEnvironmentPreamble({
      cwd: dir,
      toolNames: ["bash", "read_file"],
      maxSteps: 50,
    });
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(2000);
  });

  it("respects the abort signal", async () => {
    const controller = new AbortController();
    controller.abort();

    const preamble = await buildEnvironmentPreamble({
      cwd: dir,
      toolNames: ["bash"],
      maxSteps: 50,
      signal: controller.signal,
    });

    expect(preamble).toContain(`Working directory: ${dir}`);
    expect(preamble).toContain("Step budget: 50");
  });
});
