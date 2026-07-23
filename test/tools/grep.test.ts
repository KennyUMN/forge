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

  // The model feeds reported paths straight back into glob patterns, which are
  // POSIX-only, so a nested match must not come back as "nested\d.ts". Every
  // other fixture in this file sits at the root, where relative() emits no
  // separator at all and a platform-native path would go unnoticed.
  it("reports nested paths with forward slashes on every platform", async () => {
    await mkdir(join(dir, "nested"), { recursive: true });
    await writeFile(join(dir, "nested", "d.ts"), "function foo() {}\n", "utf8");

    const result = await grepTool.execute({ pattern: "function foo" }, { cwd: dir });

    expect(result.output).toContain("nested/d.ts:1:");
    expect(result.output).not.toContain("nested\\d.ts");
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

  it("returns an error result instead of throwing when filePattern is the wrong type", async () => {
    await expect(
      grepTool.execute({ pattern: "function foo", filePattern: 123 }, { cwd: dir }),
    ).resolves.toEqual(expect.objectContaining({ isError: true }));
  });

  it("returns an error result instead of throwing when path is the wrong type", async () => {
    await expect(
      grepTool.execute({ pattern: "function foo", path: 123 }, { cwd: dir }),
    ).resolves.toEqual(expect.objectContaining({ isError: true }));
  });

  it("returns an error result instead of throwing when input is null or undefined", async () => {
    await expect(grepTool.execute(null, { cwd: dir })).resolves.toEqual(
      expect.objectContaining({ isError: true }),
    );
    await expect(grepTool.execute(undefined, { cwd: dir })).resolves.toEqual(
      expect.objectContaining({ isError: true }),
    );
  });

  it("reports truncation even when the running match count lands exactly on the cap partway through the file list", async () => {
    const bigDir = await mkdtemp(join(tmpdir(), "forge-grep-cap-"));
    try {
      // 205 files, each contributing exactly one match. Whatever order the
      // underlying glob() enumerates files in (it is not guaranteed to be
      // alphabetical), the running total will land exactly on the 200-match
      // cap after some file and then keep climbing on the files after it.
      // A truncation check that only fires on "> cap" (not ">= cap") must
      // still notice those extra matches and report truncation instead of
      // silently dropping them.
      const fileCount = 205;
      await Promise.all(
        Array.from({ length: fileCount }, (_, i) => writeFile(join(bigDir, `f${i}.txt`), "target\n", "utf8")),
      );

      const result = await grepTool.execute({ pattern: "target" }, { cwd: bigDir });

      expect(result.isError).toBe(false);
      expect(result.output).toContain("more matches not shown");
    } finally {
      await rm(bigDir, { recursive: true, force: true });
    }
  });
});
