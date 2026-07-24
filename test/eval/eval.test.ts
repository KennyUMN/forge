import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatReport, formatSummary } from "../../eval/report.js";
import { loadTaskFiles, runEvalSuite } from "../../eval/run-eval.js";
import type { EvalResult, EvalTask, EvalTaskFile } from "../../eval/run-eval.js";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    execFile: vi.fn(),
  };
});

import { execFile } from "node:child_process";

const mockedExecFile = vi.mocked(execFile);

function makeResult(overrides: Partial<EvalResult> = {}): EvalResult {
  return {
    task: "test-task",
    passed: true,
    steps: 3,
    inputTokens: 1000,
    outputTokens: 500,
    durationMs: 2500,
    ...overrides,
  };
}

describe("eval report", () => {
  describe("formatSummary", () => {
    it("formats a summary line with pass count, tokens, and avg steps", () => {
      const results = [
        makeResult({ task: "a", passed: true, steps: 2, inputTokens: 100, outputTokens: 50 }),
        makeResult({ task: "b", passed: false, steps: 4, inputTokens: 200, outputTokens: 100 }),
        makeResult({ task: "c", passed: true, steps: 3, inputTokens: 150, outputTokens: 75 }),
      ];

      const summary = formatSummary(results);
      expect(summary).toBe("2/3 passed, 675 total tokens, avg 3.0 steps");
    });

    it("handles empty results", () => {
      expect(formatSummary([])).toBe("0/0 passed, 0 total tokens, avg 0 steps");
    });
  });

  describe("formatReport", () => {
    it("produces a markdown table with all results", () => {
      const results = [
        makeResult({ task: "fix-type-error", passed: true, steps: 2, inputTokens: 500, outputTokens: 200, durationMs: 1500 }),
        makeResult({ task: "add-function", passed: false, steps: 5, inputTokens: 800, outputTokens: 400, durationMs: 3000, error: "grep: no match" }),
      ];

      const report = formatReport(results);

      expect(report).toContain("# Eval Results");
      expect(report).toContain("| fix-type-error | PASS | 2 | 500 | 200 | 1500ms |");
      expect(report).toContain("| add-function | FAIL | 5 | 800 | 400 | 3000ms |");
      expect(report).toContain("1/2 passed, 1900 total tokens, avg 3.5 steps");
    });

    it("includes failure details section when tasks fail", () => {
      const results = [
        makeResult({ task: "broken", passed: false, error: "command not found" }),
      ];

      const report = formatReport(results);
      expect(report).toContain("## Failures");
      expect(report).toContain("### broken");
      expect(report).toContain("command not found");
    });

    it("omits failures section when all pass", () => {
      const results = [makeResult({ passed: true })];
      const report = formatReport(results);
      expect(report).not.toContain("## Failures");
    });
  });
});

describe("eval task parsing", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "forge-eval-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("loads and parses task JSON files from a directory", async () => {
    const task: EvalTaskFile = {
      name: "sample-task",
      setup: ["echo hello > file.txt"],
      prompt: "Fix the file",
      verify: "cat file.txt",
      maxTokens: 10000,
    };
    await writeFile(join(dir, "sample-task.json"), JSON.stringify(task));

    const loaded = loadTaskFiles(dir);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].name).toBe("sample-task");
    expect(loaded[0].setup).toEqual(["echo hello > file.txt"]);
    expect(loaded[0].prompt).toBe("Fix the file");
    expect(loaded[0].verify).toBe("cat file.txt");
    expect(loaded[0].maxTokens).toBe(10000);
  });

  it("sorts task files alphabetically", async () => {
    await writeFile(join(dir, "b-task.json"), JSON.stringify({ name: "b", setup: [], prompt: "p", verify: "true" }));
    await writeFile(join(dir, "a-task.json"), JSON.stringify({ name: "a", setup: [], prompt: "p", verify: "true" }));
    await writeFile(join(dir, "not-json.txt"), "ignore me");

    const loaded = loadTaskFiles(dir);
    expect(loaded).toHaveLength(2);
    expect(loaded[0].name).toBe("a");
    expect(loaded[1].name).toBe("b");
  });
});

describe("runEvalSuite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns failure result when forge binary fails", async () => {
    mockedExecFile.mockImplementation((_file: any, _args: any, _opts: any, cb?: any) => {
      const callback = typeof _opts === "function" ? _opts : cb;
      if (callback) {
        callback(new Error("spawn ENOENT"), "", "");
      }
      return undefined as any;
    });

    const tasks: EvalTask[] = [
      { name: "fail-task", prompt: "do something", verify: "true" },
    ];

    const results = await runEvalSuite(tasks, "/nonexistent/forge");
    expect(results).toHaveLength(1);
    expect(results[0].passed).toBe(false);
    expect(results[0].error).toContain("ENOENT");
  });

  it("collects results from multiple tasks", async () => {
    let callCount = 0;
    mockedExecFile.mockImplementation((_file: any, args: any, _opts: any, cb?: any) => {
      const callback = typeof _opts === "function" ? _opts : cb;
      callCount++;
      if (callback) {
        const forgeOutput = JSON.stringify({
          result: "done",
          steps: 2,
          stoppedReason: "completed",
          usage: { inputTokens: 100, outputTokens: 50 },
        });
        callback(null, forgeOutput, "");
      }
      return undefined as any;
    });

    const tasks: EvalTask[] = [
      { name: "task-a", prompt: "prompt a", verify: "true" },
      { name: "task-b", prompt: "prompt b", verify: "true" },
    ];

    const results = await runEvalSuite(tasks, "/usr/bin/node");
    expect(results).toHaveLength(2);
    expect(results[0].task).toBe("task-a");
    expect(results[1].task).toBe("task-b");
  });
});
