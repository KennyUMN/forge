import { describe, it, expect } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalExecutor } from "../../src/tool/executor.js";

describe("LocalExecutor", () => {
  const executor = new LocalExecutor();

  describe("executeCommand", () => {
    it("runs a command and captures stdout", async () => {
      const result = await executor.executeCommand("echo hello", { cwd: tmpdir() });
      expect(result.stdout.trim()).toBe("hello");
      expect(result.exitCode).toBe(0);
    });

    it("captures stderr", async () => {
      const result = await executor.executeCommand("echo err-msg >&2", { cwd: tmpdir() });
      expect(result.stderr.trim()).toBe("err-msg");
      expect(result.exitCode).toBe(0);
    });

    it("captures non-zero exit codes", async () => {
      const result = await executor.executeCommand("exit 42", { cwd: tmpdir() });
      expect(result.exitCode).toBe(42);
    });

    it("runs in the specified cwd", async () => {
      const dir = await mkdtemp(join(tmpdir(), "forge-exec-"));
      try {
        // Reading a cwd-relative file proves the cwd was honoured without
        // depending on how the shell prints paths -- Git Bash's `pwd` reports an
        // MSYS-translated path on Windows that never equals the win32 dir.
        await writeFile(join(dir, "marker.txt"), "in-cwd", "utf8");
        const result = await executor.executeCommand("cat marker.txt", { cwd: dir });
        expect(result.stdout.trim()).toBe("in-cwd");
        expect(result.exitCode).toBe(0);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it("respects abort signal", async () => {
      const controller = new AbortController();
      controller.abort();
      await expect(
        executor.executeCommand("sleep 10", { cwd: tmpdir(), signal: controller.signal }),
      ).rejects.toThrow("Aborted");
    });

    it("aborts a running command", async () => {
      const controller = new AbortController();
      const promise = executor.executeCommand("sleep 30", { cwd: tmpdir(), signal: controller.signal });
      setTimeout(() => controller.abort(), 50);
      await expect(promise).rejects.toThrow("Aborted");
    });

    it("rejects on timeout", async () => {
      await expect(
        executor.executeCommand("sleep 10", { cwd: tmpdir(), timeout: 100 }),
      ).rejects.toThrow("timed out");
    });
  });

  describe("readFile", () => {
    it("reads file contents", async () => {
      const dir = await mkdtemp(join(tmpdir(), "forge-exec-"));
      try {
        const filePath = join(dir, "test.txt");
        const { writeFile } = await import("node:fs/promises");
        await writeFile(filePath, "file-content", "utf8");
        const content = await executor.readFile(filePath);
        expect(content).toBe("file-content");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it("rejects for a missing file", async () => {
      await expect(executor.readFile("/nonexistent/path/file.txt")).rejects.toThrow();
    });
  });

  describe("writeFile", () => {
    it("writes content to a file", async () => {
      const dir = await mkdtemp(join(tmpdir(), "forge-exec-"));
      try {
        const filePath = join(dir, "out.txt");
        await executor.writeFile(filePath, "written-by-executor");
        const content = await readFile(filePath, "utf8");
        expect(content).toBe("written-by-executor");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  });
});
