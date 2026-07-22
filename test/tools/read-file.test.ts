import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileTool } from "../../src/tools/read-file.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "forge-read-file-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("readFileTool", () => {
  it("reads a file's contents given a relative path", async () => {
    await writeFile(join(dir, "a.txt"), "hello world", "utf8");

    const result = await readFileTool.execute({ path: "a.txt" }, { cwd: dir });

    expect(result).toEqual({ output: "hello world", isError: false });
  });

  it("reads a file's contents given an absolute path", async () => {
    const absolutePath = join(dir, "b.txt");
    await writeFile(absolutePath, "absolute content", "utf8");

    const result = await readFileTool.execute({ path: absolutePath }, { cwd: "/some/unrelated/cwd" });

    expect(result).toEqual({ output: "absolute content", isError: false });
  });

  it("returns an error result for a missing file instead of throwing", async () => {
    const result = await readFileTool.execute({ path: "does-not-exist.txt" }, { cwd: dir });

    expect(result.isError).toBe(true);
    expect(result.output).toContain("does-not-exist.txt");
  });

  it("returns an error instead of throwing when path is missing or not a string", async () => {
    const result = await readFileTool.execute({}, { cwd: dir });

    expect(result.isError).toBe(true);
  });
});
