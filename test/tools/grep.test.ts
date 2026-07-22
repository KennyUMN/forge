import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { grepTool } from "../../src/tools/grep.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "forge-grep-"));
  await writeFile(join(dir, "a.ts"), "const x = 1;\nfunction foo() {}\n", "utf8");
  await writeFile(join(dir, "b.ts"), "no match here\n", "utf8");
  await mkdir(join(dir, "node_modules"), { recursive: true });
  await writeFile(join(dir, "node_modules", "c.ts"), "function foo() {}\n", "utf8");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("grepTool", () => {
  it("finds matching lines with file and line number", async () => {
    const result = await grepTool.execute({ pattern: "function foo" }, { cwd: dir });

    expect(result.isError).toBe(false);
    expect(result.output).toContain("a.ts:2:function foo() {}");
  });

  it("excludes node_modules by default", async () => {
    const result = await grepTool.execute({ pattern: "function foo" }, { cwd: dir });

    expect(result.output).not.toContain("node_modules");
  });

  it("reports no matches without erroring", async () => {
    const result = await grepTool.execute({ pattern: "does-not-exist-anywhere" }, { cwd: dir });

    expect(result.isError).toBe(false);
    expect(result.output).toContain("No matches found");
  });

  it("returns an error result for an invalid regular expression", async () => {
    const result = await grepTool.execute({ pattern: "(unclosed" }, { cwd: dir });

    expect(result.isError).toBe(true);
    expect(result.output).toContain("Invalid pattern");
  });

  it("restricts the search to files matching filePattern", async () => {
    await writeFile(join(dir, "note.md"), "function foo mentioned in prose\n", "utf8");

    const result = await grepTool.execute({ pattern: "function foo", filePattern: "**/*.ts" }, { cwd: dir });

    expect(result.output).not.toContain("note.md");
  });
});
