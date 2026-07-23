import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findGitBranch, parseHead } from "../../src/tui/git.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "forge-git-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("parseHead", () => {
  it("reads the branch name from a symbolic ref", () => {
    expect(parseHead("ref: refs/heads/main\n")).toBe("main");
  });

  it("keeps slashes in a namespaced branch name", () => {
    expect(parseHead("ref: refs/heads/feat/forge-cli\n")).toBe("feat/forge-cli");
  });

  // A detached HEAD holds a raw sha; a short prefix is more useful than
  // showing nothing at all.
  it("shortens a detached HEAD to a sha prefix", () => {
    expect(parseHead("a1b2c3d4e5f60718293a4b5c6d7e8f9012345678")).toBe("a1b2c3d");
  });

  it("returns undefined for content it does not recognise", () => {
    expect(parseHead("something else")).toBeUndefined();
    expect(parseHead("")).toBeUndefined();
  });
});

describe("findGitBranch", () => {
  it("finds the branch when .git is in the working directory", async () => {
    await mkdir(join(dir, ".git"), { recursive: true });
    await writeFile(join(dir, ".git", "HEAD"), "ref: refs/heads/main\n", "utf8");

    expect(findGitBranch(dir)).toBe("main");
  });

  // forge is regularly run from a subdirectory of a repo, where .git is
  // several levels up.
  it("walks upward from a subdirectory", async () => {
    await mkdir(join(dir, ".git"), { recursive: true });
    await writeFile(join(dir, ".git", "HEAD"), "ref: refs/heads/dev\n", "utf8");
    const nested = join(dir, "src", "deep", "nested");
    await mkdir(nested, { recursive: true });

    expect(findGitBranch(nested)).toBe("dev");
  });

  it("returns undefined outside any repository", () => {
    expect(findGitBranch(dir)).toBeUndefined();
  });

  // The walk terminates at the filesystem root; without that check it loops
  // forever, since dirname() of a root returns the root.
  it("terminates rather than looping when no repository is ever found", () => {
    let reads = 0;
    const branch = findGitBranch(join(dir, "a", "b", "c"), () => {
      reads++;
      throw new Error("ENOENT");
    });

    expect(branch).toBeUndefined();
    expect(reads).toBeGreaterThan(0);
    expect(reads).toBeLessThan(100);
  });
});
