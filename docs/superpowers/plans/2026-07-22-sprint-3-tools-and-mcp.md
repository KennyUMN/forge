# Sprint 3: Plugin/Tool Registry + MCP Client + Built-in Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Forge real tools -- read/write/edit files, run shell commands, search code -- plus a way to load third-party tools (npm plugins and MCP servers) into the same tool map Sprint 2's Tool Dispatcher already consumes.

**Architecture:** Five built-in tools implement Sprint 2's `Tool` interface directly, no new abstraction needed. A `ToolRegistry` collects tools from any source into one `Map<string, Tool>` and can dynamically `import()` an npm-packaged plugin module. A separate MCP client module connects to an MCP server over stdio, lists its tools, and wraps each one as a `Tool`; a small helper function loads all of a server's tools into a `ToolRegistry` without the registry needing to know anything MCP-specific.

**Tech Stack:** TypeScript (Node >=20, ESM/NodeNext), Vitest, `@modelcontextprotocol/sdk@^1.29.0` (MCP client), `glob@^13.0.6` (file/content search) -- both already installed and committed to master. `zod@^4.4.3` is a devDependency, needed only to define the input schema of this sprint's fixture MCP server used in tests.

## Global Constraints

- Node >=20, TypeScript with `strict: true`.
- The only new runtime dependencies for this sprint are `@modelcontextprotocol/sdk` and `glob` (already added). `zod` is a devDependency for test fixtures only -- do not import it from `src/`.
- Every tool's `execute()` reports failure as `{ output, isError: true }`, never by throwing -- this matches Sprint 2's Tool Dispatcher, which already catches thrown errors defensively, but tools should be well-behaved data producers, not rely on that catch.
- `grep` and `glob` exclude `node_modules`, `.git`, and `dist` by default, and cap results at 200 matches -- if the cap is hit, the output must say so explicitly (never silently drop results; this is the same principle SWE-agent's research findings flagged in the kernel design spec).
- Sprint 2's `Tool`, `ToolExecutionContext`, `ToolExecutionResult` interfaces (`src/tool/tool.ts`) are consumed as-is and must not be modified.
- No placeholder/TODO code -- every function does what its tests assert.
- Commit after every task's tests pass.

## Real Sprint 2 Interfaces This Sprint Builds On

```ts
// src/tool/tool.ts
export interface ToolExecutionContext { cwd: string; }
export interface ToolExecutionResult { output: string; isError: boolean; }
export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(input: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult>;
}
```

---

### Task 1: Filesystem tools (read_file, write_file, edit_file)

**Files:**
- Create: `src/tools/read-file.ts`
- Create: `src/tools/write-file.ts`
- Create: `src/tools/edit-file.ts`
- Test: `test/tools/read-file.test.ts`
- Test: `test/tools/write-file.test.ts`
- Test: `test/tools/edit-file.test.ts`

**Interfaces:**
- Consumes: `Tool`, `ToolExecutionContext`, `ToolExecutionResult` (Sprint 2, `src/tool/tool.js`).
- Produces: `readFileTool`, `writeFileTool`, `editFileTool` (each a `Tool` instance) -- Task 4's manual wiring and any future CLI register these directly by name (`read_file`, `write_file`, `edit_file`).

- [ ] **Step 1: Write the failing tests**

Create `test/tools/read-file.test.ts`:

```ts
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
});
```

Create `test/tools/write-file.test.ts`:

```ts
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
});
```

Create `test/tools/edit-file.test.ts`:

```ts
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
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/tools/read-file.test.ts test/tools/write-file.test.ts test/tools/edit-file.test.ts`
Expected: FAIL -- modules not found

- [ ] **Step 3: Implement read_file**

Create `src/tools/read-file.ts`:

```ts
import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type { Tool, ToolExecutionContext, ToolExecutionResult } from "../tool/tool.js";

interface ReadFileInput {
  path: string;
}

function resolvePath(inputPath: string, cwd: string): string {
  return isAbsolute(inputPath) ? inputPath : join(cwd, inputPath);
}

async function execute(input: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult> {
  const { path } = input as ReadFileInput;
  const resolved = resolvePath(path, context.cwd);
  try {
    const content = await readFile(resolved, "utf8");
    return { output: content, isError: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { output: `Could not read "${path}": ${message}`, isError: true };
  }
}

export const readFileTool: Tool = {
  name: "read_file",
  description: "Reads the full text contents of a file at the given path.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path to the file, absolute or relative to the working directory." },
    },
    required: ["path"],
  },
  execute,
};
```

- [ ] **Step 4: Implement write_file**

Create `src/tools/write-file.ts`:

```ts
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import type { Tool, ToolExecutionContext, ToolExecutionResult } from "../tool/tool.js";

interface WriteFileInput {
  path: string;
  content: string;
}

function resolvePath(inputPath: string, cwd: string): string {
  return isAbsolute(inputPath) ? inputPath : join(cwd, inputPath);
}

async function execute(input: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult> {
  const { path, content } = input as WriteFileInput;
  const resolved = resolvePath(path, context.cwd);
  try {
    await mkdir(dirname(resolved), { recursive: true });
    await writeFile(resolved, content, "utf8");
    return { output: `Wrote ${content.length} characters to "${path}".`, isError: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { output: `Could not write "${path}": ${message}`, isError: true };
  }
}

export const writeFileTool: Tool = {
  name: "write_file",
  description:
    "Creates or overwrites a file at the given path with the given content, creating parent directories as needed.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path to the file, absolute or relative to the working directory." },
      content: { type: "string", description: "The full content to write." },
    },
    required: ["path", "content"],
  },
  execute,
};
```

- [ ] **Step 5: Implement edit_file**

Create `src/tools/edit-file.ts`:

```ts
import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type { Tool, ToolExecutionContext, ToolExecutionResult } from "../tool/tool.js";

interface EditFileInput {
  path: string;
  oldText: string;
  newText: string;
}

function resolvePath(inputPath: string, cwd: string): string {
  return isAbsolute(inputPath) ? inputPath : join(cwd, inputPath);
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count++;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

async function execute(input: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult> {
  const { path, oldText, newText } = input as EditFileInput;
  const resolved = resolvePath(path, context.cwd);

  let content: string;
  try {
    content = await readFile(resolved, "utf8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { output: `Could not read "${path}": ${message}`, isError: true };
  }

  const occurrences = countOccurrences(content, oldText);
  if (occurrences === 0) {
    return { output: `Could not edit "${path}": the given oldText was not found in the file.`, isError: true };
  }
  if (occurrences > 1) {
    return {
      output: `Could not edit "${path}": the given oldText appears ${occurrences} times; it must uniquely identify one location. Include more surrounding context.`,
      isError: true,
    };
  }

  const updated = content.replace(oldText, newText);
  try {
    await writeFile(resolved, updated, "utf8");
    return { output: `Edited "${path}".`, isError: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { output: `Could not write "${path}": ${message}`, isError: true };
  }
}

export const editFileTool: Tool = {
  name: "edit_file",
  description:
    "Replaces one uniquely-occurring block of text in a file with new text. Fails if oldText is not found or appears more than once.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path to the file, absolute or relative to the working directory." },
      oldText: { type: "string", description: "The exact text to find. Must appear exactly once in the file." },
      newText: { type: "string", description: "The text to replace it with." },
    },
    required: ["path", "oldText", "newText"],
  },
  execute,
};
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- test/tools/read-file.test.ts test/tools/write-file.test.ts test/tools/edit-file.test.ts`
Expected: PASS (3 + 3 + 4 = 10 tests)

- [ ] **Step 7: Commit**

```bash
git add src/tools/read-file.ts src/tools/write-file.ts src/tools/edit-file.ts test/tools/read-file.test.ts test/tools/write-file.test.ts test/tools/edit-file.test.ts
git commit -m "feat: add read_file, write_file, and edit_file built-in tools"
```

---

### Task 2: bash, grep, and glob tools

**Files:**
- Create: `src/tools/bash.ts`
- Create: `src/tools/grep.ts`
- Create: `src/tools/glob.ts`
- Test: `test/tools/bash.test.ts`
- Test: `test/tools/grep.test.ts`
- Test: `test/tools/glob.test.ts`

**Interfaces:**
- Consumes: `Tool`, `ToolExecutionContext`, `ToolExecutionResult` (Sprint 2, `src/tool/tool.js`); `glob` function from the `glob` package.
- Produces: `bashTool`, `grepTool`, `globTool` (each a `Tool` instance).

- [ ] **Step 1: Write the failing tests**

Create `test/tools/bash.test.ts`:

```ts
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
});
```

Create `test/tools/glob.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { globTool } from "../../src/tools/glob.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "forge-glob-"));
  await mkdir(join(dir, "src"), { recursive: true });
  await mkdir(join(dir, "node_modules", "pkg"), { recursive: true });
  await writeFile(join(dir, "src", "a.ts"), "", "utf8");
  await writeFile(join(dir, "src", "b.js"), "", "utf8");
  await writeFile(join(dir, "node_modules", "pkg", "index.ts"), "", "utf8");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("globTool", () => {
  it("matches files by extension recursively", async () => {
    const result = await globTool.execute({ pattern: "**/*.ts" }, { cwd: dir });

    expect(result.isError).toBe(false);
    expect(result.output).toContain("src/a.ts");
    expect(result.output).not.toContain("b.js");
  });

  it("excludes node_modules by default", async () => {
    const result = await globTool.execute({ pattern: "**/*.ts" }, { cwd: dir });

    expect(result.output).not.toContain("node_modules");
  });

  it("reports when nothing matches without erroring", async () => {
    const result = await globTool.execute({ pattern: "**/*.nonexistent" }, { cwd: dir });

    expect(result.isError).toBe(false);
    expect(result.output).toContain("No files matched");
  });
});
```

Create `test/tools/grep.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/tools/bash.test.ts test/tools/glob.test.ts test/tools/grep.test.ts`
Expected: FAIL -- modules not found

- [ ] **Step 3: Implement bash**

Create `src/tools/bash.ts`:

```ts
import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { Tool, ToolExecutionContext, ToolExecutionResult } from "../tool/tool.js";

const execAsync = promisify(exec);

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_BUFFER_BYTES = 10 * 1024 * 1024;

interface BashInput {
  command: string;
}

async function execute(input: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult> {
  const { command } = input as BashInput;

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: context.cwd,
      timeout: DEFAULT_TIMEOUT_MS,
      maxBuffer: MAX_BUFFER_BYTES,
    });
    const output = [stdout, stderr].filter((part) => part.length > 0).join("\n");
    return { output: output.length > 0 ? output : "(command produced no output)", isError: false };
  } catch (err) {
    const execError = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string; killed?: boolean; signal?: string };
    if (execError.killed && execError.signal === "SIGTERM") {
      return { output: `Command timed out after ${DEFAULT_TIMEOUT_MS}ms: ${command}`, isError: true };
    }
    const combined = [execError.stdout, execError.stderr, execError.message].filter(Boolean).join("\n");
    return { output: combined, isError: true };
  }
}

export const bashTool: Tool = {
  name: "bash",
  description: "Runs a shell command in the working directory and returns its combined stdout/stderr.",
  parameters: {
    type: "object",
    properties: { command: { type: "string", description: "The shell command to run." } },
    required: ["command"],
  },
  execute,
};
```

- [ ] **Step 4: Implement glob**

Create `src/tools/glob.ts`:

```ts
import { glob } from "glob";
import { isAbsolute, join, relative } from "node:path";
import type { Tool, ToolExecutionContext, ToolExecutionResult } from "../tool/tool.js";

const DEFAULT_IGNORE = ["**/node_modules/**", "**/.git/**", "**/dist/**"];
const MAX_RESULTS = 200;

interface GlobInput {
  pattern: string;
  path?: string;
}

function resolveSearchRoot(inputPath: string | undefined, cwd: string): string {
  if (!inputPath) return cwd;
  return isAbsolute(inputPath) ? inputPath : join(cwd, inputPath);
}

async function execute(input: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult> {
  const { pattern, path } = input as GlobInput;
  const root = resolveSearchRoot(path, context.cwd);

  const matches = await glob(pattern, { cwd: root, ignore: DEFAULT_IGNORE, nodir: true, dot: false });
  matches.sort();

  if (matches.length === 0) {
    return { output: "No files matched.", isError: false };
  }

  const truncated = matches.length > MAX_RESULTS;
  const shown = truncated ? matches.slice(0, MAX_RESULTS) : matches;
  const lines = shown.map((match) => relative(context.cwd, join(root, match)));
  const suffix = truncated ? `\n... ${matches.length - MAX_RESULTS} more match(es) not shown; narrow the pattern.` : "";

  return { output: lines.join("\n") + suffix, isError: false };
}

export const globTool: Tool = {
  name: "glob",
  description: 'Finds files matching a glob pattern (e.g. "**/*.ts"), returning up to 200 paths relative to the working directory.',
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string", description: 'Glob pattern to match, e.g. "src/**/*.ts".' },
      path: { type: "string", description: "Directory to search under; defaults to the working directory." },
    },
    required: ["pattern"],
  },
  execute,
};
```

- [ ] **Step 5: Implement grep**

Create `src/tools/grep.ts`:

```ts
import { glob } from "glob";
import { readFile } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import type { Tool, ToolExecutionContext, ToolExecutionResult } from "../tool/tool.js";

const DEFAULT_IGNORE = ["**/node_modules/**", "**/.git/**", "**/dist/**"];
const DEFAULT_FILE_PATTERN = "**/*";
const MAX_MATCHES = 200;

interface GrepInput {
  pattern: string;
  path?: string;
  filePattern?: string;
}

interface Match {
  file: string;
  line: number;
  content: string;
}

function resolveSearchRoot(inputPath: string | undefined, cwd: string): string {
  if (!inputPath) return cwd;
  return isAbsolute(inputPath) ? inputPath : join(cwd, inputPath);
}

async function searchFile(absolutePath: string, relativePath: string, regex: RegExp): Promise<Match[]> {
  let content: string;
  try {
    content = await readFile(absolutePath, "utf8");
  } catch {
    return [];
  }
  const matches: Match[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (regex.test(lines[i])) {
      matches.push({ file: relativePath, line: i + 1, content: lines[i] });
    }
  }
  return matches;
}

async function execute(input: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult> {
  const { pattern, path, filePattern } = input as GrepInput;
  const root = resolveSearchRoot(path, context.cwd);

  let regex: RegExp;
  try {
    regex = new RegExp(pattern);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { output: `Invalid pattern: ${message}`, isError: true };
  }

  const files = await glob(filePattern ?? DEFAULT_FILE_PATTERN, {
    cwd: root,
    ignore: DEFAULT_IGNORE,
    nodir: true,
    dot: false,
  });

  const allMatches: Match[] = [];
  for (const file of files) {
    const absolutePath = join(root, file);
    const relativePath = relative(context.cwd, absolutePath);
    allMatches.push(...(await searchFile(absolutePath, relativePath, regex)));
    if (allMatches.length >= MAX_MATCHES) break;
  }

  if (allMatches.length === 0) {
    return { output: "No matches found.", isError: false };
  }

  const truncated = allMatches.length > MAX_MATCHES;
  const shown = truncated ? allMatches.slice(0, MAX_MATCHES) : allMatches;
  const lines = shown.map((m) => `${m.file}:${m.line}:${m.content}`);
  const suffix = truncated ? `\n... more matches not shown; narrow the pattern or path.` : "";

  return { output: lines.join("\n") + suffix, isError: false };
}

export const grepTool: Tool = {
  name: "grep",
  description: 'Searches file contents for a regular expression pattern, returning up to 200 matches as "path:line:content".',
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Regular expression to search for." },
      path: { type: "string", description: "Directory to search under; defaults to the working directory." },
      filePattern: { type: "string", description: "Glob restricting which files to search; defaults to all files." },
    },
    required: ["pattern"],
  },
  execute,
};
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- test/tools/bash.test.ts test/tools/glob.test.ts test/tools/grep.test.ts`
Expected: PASS (4 + 3 + 5 = 12 tests)

- [ ] **Step 7: Commit**

```bash
git add src/tools/bash.ts src/tools/glob.ts src/tools/grep.ts test/tools/bash.test.ts test/tools/glob.test.ts test/tools/grep.test.ts
git commit -m "feat: add bash, glob, and grep built-in tools"
```

---

### Task 3: Tool Registry (dynamic in-process plugin loading)

**Files:**
- Create: `src/tool/tool-registry.ts`
- Create: `test/fixtures/tool-plugin-fixture.ts`
- Create: `test/fixtures/not-a-plugin.ts`
- Test: `test/tool/tool-registry.test.ts`

**Interfaces:**
- Consumes: `Tool` (Sprint 2, `src/tool/tool.js`).
- Produces: `ToolRegistry` class with `registerTool(tool)`, `loadPlugin(moduleSpecifier): Promise<void>`, `getTool(name): Tool | undefined`, `getAll(): ReadonlyMap<string, Tool>`; `ToolPluginModule { getTools(): Tool[] | Promise<Tool[]> }` -- Task 4's `loadMcpServerIntoRegistry` takes a `ToolRegistry` instance directly. Sprint 4's CLI is where a `ToolRegistry` actually gets constructed, populated with the built-in tools from Tasks 1-2 (via `registerTool`) and any MCP servers (via Task 4's helper), and passed to Sprint 2's `runTurn` via `registry.getAll()` -- that end-to-end wiring is out of scope for this sprint.

- [ ] **Step 1: Write the failing tests**

Create `test/fixtures/tool-plugin-fixture.ts` -- a real plugin module the registry will dynamically `import()` in the test below (not a mock):

```ts
import type { Tool } from "../../src/tool/tool.js";

const fixtureTool: Tool = {
  name: "fixture_tool",
  description:
    "A tool loaded dynamically from a fixture plugin module, used to prove ToolRegistry.loadPlugin() performs a real import().",
  parameters: { type: "object", properties: {}, required: [] },
  async execute() {
    return { output: "fixture tool executed", isError: false };
  },
};

export function getTools(): Tool[] {
  return [fixtureTool];
}
```

Create `test/fixtures/not-a-plugin.ts` -- a module that deliberately does not implement the plugin contract, used to test the registry's error handling:

```ts
export const notATool = "this module intentionally does not export getTools()";
```

Create `test/tool/tool-registry.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ToolRegistry } from "../../src/tool/tool-registry.js";
import type { Tool } from "../../src/tool/tool.js";

const fixtureUrl = new URL("../fixtures/tool-plugin-fixture.ts", import.meta.url);
const badModuleUrl = new URL("../fixtures/not-a-plugin.ts", import.meta.url);

function makeTool(name: string): Tool {
  return {
    name,
    description: name,
    parameters: {},
    async execute() {
      return { output: "ok", isError: false };
    },
  };
}

describe("ToolRegistry", () => {
  it("registers a tool and makes it retrievable by name", () => {
    const registry = new ToolRegistry();
    const tool = makeTool("echo");

    registry.registerTool(tool);

    expect(registry.getTool("echo")).toBe(tool);
    expect(registry.getAll().get("echo")).toBe(tool);
  });

  it("throws when registering two tools with the same name", () => {
    const registry = new ToolRegistry();
    registry.registerTool(makeTool("dup"));

    expect(() => registry.registerTool(makeTool("dup"))).toThrow(/already registered/);
  });

  it("returns undefined for a tool that was never registered", () => {
    const registry = new ToolRegistry();
    expect(registry.getTool("nope")).toBeUndefined();
  });

  it("dynamically imports a real plugin module and registers the tools it exports", async () => {
    const registry = new ToolRegistry();

    await registry.loadPlugin(fixtureUrl.href);

    const tool = registry.getTool("fixture_tool");
    expect(tool).toBeDefined();
    const result = await tool!.execute({}, { cwd: "/tmp" });
    expect(result).toEqual({ output: "fixture tool executed", isError: false });
  });

  it("throws a clear error when a plugin module does not export getTools", async () => {
    const registry = new ToolRegistry();

    await expect(registry.loadPlugin(badModuleUrl.href)).rejects.toThrow(/getTools/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/tool/tool-registry.test.ts`
Expected: FAIL -- `Cannot find module '../../src/tool/tool-registry.js'`

- [ ] **Step 3: Implement the Tool Registry**

Create `src/tool/tool-registry.ts`:

```ts
import type { Tool } from "./tool.js";

export interface ToolPluginModule {
  getTools(): Tool[] | Promise<Tool[]>;
}

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  registerTool(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`A tool named "${tool.name}" is already registered.`);
    }
    this.tools.set(tool.name, tool);
  }

  async loadPlugin(moduleSpecifier: string): Promise<void> {
    const mod = (await import(moduleSpecifier)) as Partial<ToolPluginModule>;
    if (typeof mod.getTools !== "function") {
      throw new Error(`Plugin module "${moduleSpecifier}" does not export a getTools() function.`);
    }
    const tools = await mod.getTools();
    for (const tool of tools) {
      this.registerTool(tool);
    }
  }

  getTool(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  getAll(): ReadonlyMap<string, Tool> {
    return this.tools;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/tool/tool-registry.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/tool/tool-registry.ts test/fixtures/tool-plugin-fixture.ts test/fixtures/not-a-plugin.ts test/tool/tool-registry.test.ts
git commit -m "feat: add ToolRegistry with dynamic import()-based plugin loading"
```

---

### Task 4: MCP client integration

**Files:**
- Create: `src/mcp/mcp-client.ts`
- Create: `test/fixtures/mcp-fixture-server.js` (plain JavaScript -- see note below)
- Test: `test/mcp/mcp-client.test.ts`

**Interfaces:**
- Consumes: `Tool`, `ToolExecutionResult` (Sprint 2, `src/tool/tool.js`); `ToolRegistry` (Task 3, `src/tool/tool-registry.js`); `Client`, `StdioClientTransport` from `@modelcontextprotocol/sdk`.
- Produces: `connectMcpServer(config): Promise<McpConnection>`, `McpServerConfig { name, command, args? }`, `McpConnection { tools, close() }`; `loadMcpServerIntoRegistry(registry, config): Promise<{ close(): Promise<void> }>` -- Sprint 4's CLI will call `loadMcpServerIntoRegistry` for each configured MCP server at startup.

**Note on the fixture server's language**: `test/fixtures/mcp-fixture-server.js` is spawned as its own child process via `node <path>`, and Node 20 (this project's minimum) cannot execute `.ts` files directly without a build step. Since this fixture is a standalone script with no dependency on Forge's own TypeScript source, writing it in plain ESM JavaScript avoids that problem entirely -- no compilation step needed for the test to run it.

- [ ] **Step 1: Write the failing tests**

Create `test/fixtures/mcp-fixture-server.js` -- a minimal real MCP server, used by the test below to prove the client connects over a real stdio transport, not a mock:

```js
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "forge-fixture-server", version: "0.1.0" });

server.registerTool(
  "fixture_echo",
  {
    description: "Echoes the given text back, prefixed with 'echo: '.",
    inputSchema: { text: z.string() },
  },
  async ({ text }) => ({
    content: [{ type: "text", text: `echo: ${text}` }],
  }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
```

Create `test/mcp/mcp-client.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { fileURLToPath } from "node:url";
import { connectMcpServer, loadMcpServerIntoRegistry } from "../../src/mcp/mcp-client.js";
import { ToolRegistry } from "../../src/tool/tool-registry.js";

const fixtureServerPath = fileURLToPath(new URL("../fixtures/mcp-fixture-server.js", import.meta.url));

let cleanup: (() => Promise<void>) | undefined;

afterEach(async () => {
  if (cleanup) {
    await cleanup();
    cleanup = undefined;
  }
});

describe("connectMcpServer", () => {
  it("connects to a real MCP server over stdio and lists its tools", async () => {
    const connection = await connectMcpServer({ name: "fixture", command: "node", args: [fixtureServerPath] });
    cleanup = connection.close;

    expect(connection.tools).toHaveLength(1);
    expect(connection.tools[0].name).toBe("fixture_echo");
  });

  it("calls a real tool on the connected server and returns its text output", async () => {
    const connection = await connectMcpServer({ name: "fixture", command: "node", args: [fixtureServerPath] });
    cleanup = connection.close;

    const tool = connection.tools[0];
    const result = await tool.execute({ text: "hello" }, { cwd: "/tmp" });

    expect(result).toEqual({ output: "echo: hello", isError: false });
  });
});

describe("loadMcpServerIntoRegistry", () => {
  it("registers every tool from a connected MCP server into the given registry", async () => {
    const registry = new ToolRegistry();

    const connection = await loadMcpServerIntoRegistry(registry, {
      name: "fixture",
      command: "node",
      args: [fixtureServerPath],
    });
    cleanup = connection.close;

    const tool = registry.getTool("fixture_echo");
    expect(tool).toBeDefined();
    const result = await tool!.execute({ text: "hi" }, { cwd: "/tmp" });
    expect(result).toEqual({ output: "echo: hi", isError: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/mcp/mcp-client.test.ts`
Expected: FAIL -- `Cannot find module '../../src/mcp/mcp-client.js'`

- [ ] **Step 3: Implement the MCP client**

Create `src/mcp/mcp-client.ts`:

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Tool, ToolExecutionResult } from "../tool/tool.js";
import type { ToolRegistry } from "../tool/tool-registry.js";

export interface McpServerConfig {
  name: string;
  command: string;
  args?: string[];
}

export interface McpConnection {
  tools: Tool[];
  close(): Promise<void>;
}

function extractOutput(result: Awaited<ReturnType<Client["callTool"]>>): string {
  if ("content" in result && Array.isArray(result.content)) {
    const text = result.content
      .filter((block): block is { type: "text"; text: string } => block.type === "text")
      .map((block) => block.text)
      .join("\n");
    return text.length > 0 ? text : "(tool returned no text content)";
  }
  if ("toolResult" in result) {
    return JSON.stringify(result.toolResult);
  }
  return "(tool returned an unrecognized result shape)";
}

function toForgeTool(
  client: Client,
  mcpTool: { name: string; description?: string; inputSchema: Record<string, unknown> },
): Tool {
  return {
    name: mcpTool.name,
    description: mcpTool.description ?? "",
    parameters: mcpTool.inputSchema,
    async execute(input): Promise<ToolExecutionResult> {
      const result = await client.callTool({
        name: mcpTool.name,
        arguments: input as Record<string, unknown> | undefined,
      });
      const isError = "isError" in result && Boolean(result.isError);
      return { output: extractOutput(result), isError };
    },
  };
}

export async function connectMcpServer(config: McpServerConfig): Promise<McpConnection> {
  const transport = new StdioClientTransport({ command: config.command, args: config.args ?? [] });
  const client = new Client({ name: "forge", version: "0.1.0" }, { capabilities: {} });
  await client.connect(transport);

  const { tools: mcpTools } = await client.listTools();
  const tools = mcpTools.map((mcpTool) => toForgeTool(client, mcpTool));

  return {
    tools,
    close: () => client.close(),
  };
}

export async function loadMcpServerIntoRegistry(
  registry: ToolRegistry,
  config: McpServerConfig,
): Promise<{ close(): Promise<void> }> {
  const connection = await connectMcpServer(config);
  for (const tool of connection.tools) {
    registry.registerTool(tool);
  }
  return { close: connection.close };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/mcp/mcp-client.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/mcp/mcp-client.ts test/fixtures/mcp-fixture-server.js test/mcp/mcp-client.test.ts
git commit -m "feat: add MCP client integration"
```

- [ ] **Step 6 (manual, gated on network + npx access): smoke-test against a real third-party MCP server**

Not an automated test -- run once by hand to confirm real-world connectivity beyond the local fixture, using the official reference filesystem server (`@modelcontextprotocol/server-filesystem`, a real third-party package, not written by us):

```bash
node --input-type=module -e "
import { connectMcpServer } from './src/mcp/mcp-client.js';
const connection = await connectMcpServer({
  name: 'fs',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-filesystem', process.cwd()],
});
console.log('Tools:', connection.tools.map((t) => t.name));
const result = await connection.tools.find((t) => t.name.includes('list'))?.execute({ path: '.' }, { cwd: process.cwd() });
console.log('Sample call result:', result);
await connection.close();
"
```

Expected: prints a non-empty list of tool names (e.g. `read_file`, `list_directory`, ...) and a successful sample call result, confirming Forge's MCP client works against a real, independently-authored MCP server -- not just the in-repo fixture.

---

### Task 5: End-to-end integration -- built-in tools through the full agent loop

Tasks 1-4 test each piece in isolation. This task closes the gap explicitly: it proves the real `write_file`/`read_file`/`bash` tools (not fakes) work through Sprint 2's actual `runTurn`, with real filesystem side effects asserted, not just session-log entries. There is no new production source code in this task -- every piece it wires together already exists from Sprints 1-2 and Sprint 3 Tasks 1-4. Only the model is faked (a scripted provider), matching Sprint 2's own testing approach, since Sprint 4 -- not this sprint -- wires in the real `AnthropicProvider`.

**Files:**
- Test: `test/integration/full-loop.test.ts`

**Interfaces:**
- Consumes: `SessionStore` (Sprint 1); `PermissionGate`, `autoAllowReadOnlyPolicy`, `askBeforeWriteOrBashPolicy` (Sprint 2); `runTurn` (Sprint 2); `ModelProvider`, `StreamContext`, `StreamEvent` (Sprint 1); `ToolRegistry` (Task 3); `readFileTool`, `writeFileTool`, `bashTool` (Tasks 1-2).
- Produces: nothing new -- this is a pure integration test.

- [ ] **Step 1: Write the integration test**

Create `test/integration/full-loop.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile as fsReadFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionStore } from "../../src/session/session-store.js";
import { PermissionGate } from "../../src/permission/permission-gate.js";
import { autoAllowReadOnlyPolicy, askBeforeWriteOrBashPolicy } from "../../src/permission/permission-policies.js";
import { runTurn } from "../../src/agent/turn-orchestrator.js";
import { ToolRegistry } from "../../src/tool/tool-registry.js";
import { readFileTool } from "../../src/tools/read-file.js";
import { writeFileTool } from "../../src/tools/write-file.js";
import { bashTool } from "../../src/tools/bash.js";
import type { ModelProvider, StreamContext } from "../../src/provider/model-provider.js";
import type { StreamEvent } from "../../src/types/message.js";

class ScriptedProvider implements ModelProvider {
  readonly name = "scripted";
  private callCount = 0;

  constructor(private readonly script: StreamEvent[][]) {}

  async *stream(_context: StreamContext): AsyncIterable<StreamEvent> {
    const batch = this.script[Math.min(this.callCount, this.script.length - 1)];
    this.callCount++;
    for (const event of batch) yield event;
  }
}

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "forge-full-loop-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("full agent loop with real built-in tools", () => {
  it("writes a real file, reads it back, and lists the directory via bash, all through runTurn", async () => {
    const session = await SessionStore.create(dir);
    const registry = new ToolRegistry();
    registry.registerTool(writeFileTool);
    registry.registerTool(readFileTool);
    registry.registerTool(bashTool);

    const gate = new PermissionGate([autoAllowReadOnlyPolicy, askBeforeWriteOrBashPolicy], async () => true);

    const provider = new ScriptedProvider([
      [
        { type: "tool_call", id: "1", name: "write_file", input: { path: "notes.txt", content: "hello forge" } },
        { type: "finish", reason: "tool_calls", rawReason: "tool_use" },
      ],
      [
        { type: "tool_call", id: "2", name: "read_file", input: { path: "notes.txt" } },
        { type: "finish", reason: "tool_calls", rawReason: "tool_use" },
      ],
      [
        { type: "tool_call", id: "3", name: "bash", input: { command: "ls" } },
        { type: "finish", reason: "tool_calls", rawReason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "Done: wrote, read, and listed notes.txt" },
        { type: "finish", reason: "completed", rawReason: "end_turn" },
      ],
    ]);

    const result = await runTurn("create notes.txt, read it back, then list the directory", {
      provider,
      session,
      tools: registry.getAll(),
      gate,
      systemPrompt: "",
      toolContext: { cwd: dir },
    });

    expect(result.stoppedReason).toBe("completed");
    expect(result.finalText).toBe("Done: wrote, read, and listed notes.txt");

    // Real filesystem assertion -- not just checking session log entries.
    expect(await fsReadFile(join(dir, "notes.txt"), "utf8")).toBe("hello forge");

    const toolResults = session
      .getEntries()
      .filter((e) => e.type === "tool_result")
      .map((e) => e.payload as { output: string; isError: boolean });

    expect(toolResults.every((r) => r.isError === false)).toBe(true);
    expect(toolResults[1].output).toBe("hello forge"); // read_file result
    expect(toolResults[2].output).toContain("notes.txt"); // bash `ls` result
  });
});
```

- [ ] **Step 2: Run it**

Run: `npm test -- test/integration/full-loop.test.ts`
Expected: PASS (1 test). If it fails, the failure points at an integration seam between Sprint 2's loop and Sprint 3's tools -- not at code this task itself writes, since there is none.

- [ ] **Step 3: Run the full test suite and both typecheck paths**

Run: `npm test && npm run typecheck && npm run typecheck:test`
Expected: all tests pass (Sprint 1's 20 + Sprint 2's 41 + Sprint 3's new tests: Task 1 = 10, Task 2 = 12, Task 3 = 5, Task 4 = 3, Task 5 = 1; 10+12+5+3+1 = 31 new = 92 total), both typechecks report no errors.

- [ ] **Step 4: Commit**

```bash
git add test/integration/full-loop.test.ts
git commit -m "test: verify built-in tools work through the full agent loop end-to-end"
```

---

## Sprint 3 Definition of Done

- [ ] All automated tests across Tasks 1-5 pass (`npm test`), full suite green including Sprints 1-2's tests.
- [ ] `npm run typecheck` and `npm run typecheck:test` both report no errors.
- [ ] Forge can read, edit, and write a real file and run a real shell command **through the full agent loop** (Task 5's integration test proves this via a real `SessionStore` + `PermissionGate` + `runTurn`, with a real filesystem assertion, not just isolated tool-level tests or session-log inspection).
- [ ] At least one real third-party MCP server's tools are connected and callable (Task 4's automated test proves this against a local fixture server; its Step 6 manual smoke test proves it against a real independently-authored server).
- [ ] `grep`/`glob` results are capped and the cap is visibly reported, never silently dropped.

Once this Definition of Done is met, move to Sprint 4 (CLI wiring + integration testing) -- see [ROADMAP.md](../../ROADMAP.md).
