import { describe, it, expect } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bashTool } from "../../src/tools/bash.js";

describe("bashTool", () => {
  it("runs a command and returns its stdout", async () => {
    const result = await bashTool.execute({ command: "echo hello" }, { cwd: process.cwd() });

    expect(result.isError).toBe(false);
    expect(result.output).toContain("hello");
  });

  it("runs the command in the given cwd", async () => {
    const dir = await mkdtemp(join(tmpdir(), "forge-bash-"));
    try {
      await writeFile(join(dir, "marker.txt"), "x", "utf8");
      const result = await bashTool.execute({ command: "ls" }, { cwd: dir });
      expect(result.output).toContain("marker.txt");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reports a non-zero exit code as an error result instead of throwing", async () => {
    const result = await bashTool.execute({ command: "exit 1" }, { cwd: process.cwd() });

    expect(result.isError).toBe(true);
  });

  it("captures stderr output on failure", async () => {
    const result = await bashTool.execute({ command: "echo failure-message 1>&2; exit 1" }, { cwd: process.cwd() });

    expect(result.isError).toBe(true);
    expect(result.output).toContain("failure-message");
  });

  it("returns an error result instead of throwing when input is null or undefined", async () => {
    await expect(bashTool.execute(null, { cwd: process.cwd() })).resolves.toEqual(
      expect.objectContaining({ isError: true }),
    );
    await expect(bashTool.execute(undefined, { cwd: process.cwd() })).resolves.toEqual(
      expect.objectContaining({ isError: true }),
    );
  });
});
