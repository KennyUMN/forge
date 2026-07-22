import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileTool } from "../../src/tools/write-file.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "forge-write-file-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("writeFileTool", () => {
  it("creates a new file with the given content", async () => {
    const result = await writeFileTool.execute({ path: "new.txt", content: "hello" }, { cwd: dir });

    expect(result.isError).toBe(false);
    expect(await readFile(join(dir, "new.txt"), "utf8")).toBe("hello");
  });

  it("overwrites an existing file", async () => {
    await writeFileTool.execute({ path: "over.txt", content: "first" }, { cwd: dir });
    await writeFileTool.execute({ path: "over.txt", content: "second" }, { cwd: dir });

    expect(await readFile(join(dir, "over.txt"), "utf8")).toBe("second");
  });

  it("creates parent directories that do not yet exist", async () => {
    const result = await writeFileTool.execute({ path: "nested/deep/file.txt", content: "x" }, { cwd: dir });

    expect(result.isError).toBe(false);
    expect(await readFile(join(dir, "nested/deep/file.txt"), "utf8")).toBe("x");
  });

  it("returns an error instead of throwing when path is missing or not a string", async () => {
    const result = await writeFileTool.execute({ content: "x" }, { cwd: dir });

    expect(result.isError).toBe(true);
  });

  it("returns an error instead of throwing when content is missing or not a string", async () => {
    const result = await writeFileTool.execute({ path: "new.txt" }, { cwd: dir });

    expect(result.isError).toBe(true);
  });
});
