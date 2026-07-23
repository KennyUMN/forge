import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const DETACHED_SHA_LENGTH = 7;

// Reads .git/HEAD directly rather than spawning `git`. The status line redraws
// on every keystroke, and a subprocess per repaint is both slower and racier
// than a single small read -- and this is the only git fact the line shows.
//
// Walks upward because forge is regularly run from a subdirectory of a repo,
// where .git is several levels above the working directory.
export function findGitBranch(cwd: string, readFile: (path: string) => string = defaultRead): string | undefined {
  let dir = cwd;
  for (;;) {
    const head = tryRead(join(dir, ".git", "HEAD"), readFile);
    if (head !== undefined) return parseHead(head);

    const parent = dirname(dir);
    // dirname() of a filesystem root returns the root itself, which is the
    // only reliable cross-platform way to know the walk is finished.
    if (parent === dir) return undefined;
    dir = parent;
  }
}

export function parseHead(head: string): string | undefined {
  const trimmed = head.trim();
  const match = /^ref:\s*refs\/heads\/(.+)$/.exec(trimmed);
  if (match) return match[1];
  // A detached HEAD holds a raw sha. Showing a short prefix is more useful
  // than showing nothing, and the caller has no other way to tell the states
  // apart than that this is not a branch name.
  if (/^[0-9a-f]{40}$/i.test(trimmed)) return trimmed.slice(0, DETACHED_SHA_LENGTH);
  return undefined;
}

function defaultRead(path: string): string {
  return readFileSync(path, "utf8");
}

function tryRead(path: string, readFile: (path: string) => string): string | undefined {
  try {
    return readFile(path);
  } catch {
    return undefined;
  }
}
