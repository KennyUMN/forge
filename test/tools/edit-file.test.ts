import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { editFileTool } from "../../src/tools/edit-file.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "forge-edit-file-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("editFileTool", () => {
  it("replaces a uniquely-occurring block of text", async () => {
    await writeFile(join(dir, "a.ts"), "const x = 1;\nconst y = 2;\n", "utf8");

    const result = await editFileTool.execute(
      { path: "a.ts", oldText: "const x = 1;", newText: "const x = 100;" },
      { cwd: dir },
    );

    expect(result.isError).toBe(false);
    expect(await readFile(join(dir, "a.ts"), "utf8")).toBe("const x = 100;\nconst y = 2;\n");
  });

  it("fails when oldText is not found", async () => {
    await writeFile(join(dir, "a.ts"), "const x = 1;\n", "utf8");

    const result = await editFileTool.execute(
      { path: "a.ts", oldText: "const z = 99;", newText: "irrelevant" },
      { cwd: dir },
    );

    expect(result.isError).toBe(true);
    expect(result.output).toContain("not found");
  });

  it("fails when oldText appears more than once", async () => {
    await writeFile(join(dir, "a.ts"), "dup\ndup\n", "utf8");

    const result = await editFileTool.execute({ path: "a.ts", oldText: "dup", newText: "x" }, { cwd: dir });

    expect(result.isError).toBe(true);
    expect(result.output).toContain("2 times");
  });

  it("returns an error for a missing file instead of throwing", async () => {
    const result = await editFileTool.execute({ path: "missing.ts", oldText: "a", newText: "b" }, { cwd: dir });

    expect(result.isError).toBe(true);
  });

  it("does not interpret $-patterns in newText as special replacement sequences", async () => {
    await writeFile(join(dir, "a.ts"), "before X after", "utf8");

    const result = await editFileTool.execute(
      { path: "a.ts", oldText: "X", newText: "value $& end" },
      { cwd: dir },
    );

    expect(result.isError).toBe(false);
    expect(await readFile(join(dir, "a.ts"), "utf8")).toBe("before value $& end after");
  });

  it("returns an error instead of throwing when path is missing or not a string", async () => {
    const result = await editFileTool.execute({ oldText: "a", newText: "b" }, { cwd: dir });

    expect(result.isError).toBe(true);
  });

  it("returns an error instead of throwing when oldText is missing or not a string", async () => {
    await writeFile(join(dir, "a.ts"), "content", "utf8");

    const result = await editFileTool.execute({ path: "a.ts", newText: "b" }, { cwd: dir });

    expect(result.isError).toBe(true);
  });

  it("returns an error instead of silently inserting the literal text 'undefined' when newText is missing", async () => {
    await writeFile(join(dir, "a.ts"), "content", "utf8");

    const result = await editFileTool.execute({ path: "a.ts", oldText: "content" }, { cwd: dir });

    expect(result.isError).toBe(true);
    expect(await readFile(join(dir, "a.ts"), "utf8")).toBe("content");
  });
});
