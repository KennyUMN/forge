import { describe, it, expect } from "vitest";
import { isDoomLoop, checkDoomLoop } from "../../src/agent/doom-loop.js";
import type { ToolCallRequest, ToolResult } from "../../src/types/tool-call.js";

const call = (input: unknown): ToolCallRequest => ({ id: "x", name: "bash", input });

function makeCall(id: string, name: string, input: unknown): ToolCallRequest {
  return { id, name, input };
}

function makeResult(toolCallId: string, output: string, isError = false): ToolResult {
  return { toolCallId, output, isError };
}

describe("isDoomLoop", () => {
  it("returns false when history is empty", () => {
    expect(isDoomLoop([], call({ command: "ls" }))).toBe(false);
  });

  it("returns false when fewer than threshold-1 prior identical calls exist", () => {
    const history = [call({ command: "ls" })];
    expect(isDoomLoop(history, call({ command: "ls" }))).toBe(false);
  });

  it("returns true when the same call would be the 3rd consecutive identical call", () => {
    const history = [call({ command: "ls" }), call({ command: "ls" })];
    expect(isDoomLoop(history, call({ command: "ls" }))).toBe(true);
  });

  it("returns false when the two most recent calls differ in input", () => {
    const history = [call({ command: "ls" }), call({ command: "pwd" })];
    expect(isDoomLoop(history, call({ command: "ls" }))).toBe(false);
  });

  it("returns false when the two most recent calls have the same input but a different tool name", () => {
    const history = [
      { id: "a", name: "bash", input: { command: "ls" } },
      { id: "b", name: "grep", input: { command: "ls" } },
    ];
    expect(isDoomLoop(history, call({ command: "ls" }))).toBe(false);
  });

  it("does not mutate the history array", () => {
    const history = [call({ command: "ls" }), call({ command: "ls" })];
    const snapshot = JSON.stringify(history);
    isDoomLoop(history, call({ command: "ls" }));
    expect(JSON.stringify(history)).toBe(snapshot);
  });
});

describe("checkDoomLoop", () => {
  describe("allow", () => {
    it("returns allow when history is empty", () => {
      const verdict = checkDoomLoop([], [], call({ command: "ls" }));
      expect(verdict).toEqual({ action: "allow" });
    });

    it("returns allow for varied calls with no pattern", () => {
      const history = [
        makeCall("1", "bash", { command: "ls" }),
        makeCall("2", "read_file", { path: "a.ts" }),
        makeCall("3", "bash", { command: "pwd" }),
      ];
      const verdict = checkDoomLoop(history, [], makeCall("4", "grep", { pattern: "foo" }));
      expect(verdict).toEqual({ action: "allow" });
    });
  });

  describe("block (identical consecutive calls)", () => {
    it("returns block on the 3rd consecutive identical call", () => {
      const history = [
        makeCall("1", "bash", { command: "ls" }),
        makeCall("2", "bash", { command: "ls" }),
      ];
      const verdict = checkDoomLoop(history, [], makeCall("3", "bash", { command: "ls" }));
      expect(verdict.action).toBe("block");
    });

    it("does not block when only 2 identical calls exist", () => {
      const history = [makeCall("1", "bash", { command: "ls" })];
      const verdict = checkDoomLoop(history, [], makeCall("2", "bash", { command: "ls" }));
      expect(verdict.action).not.toBe("block");
    });

    it("includes a reason in the block verdict", () => {
      const history = [
        makeCall("1", "bash", { command: "ls" }),
        makeCall("2", "bash", { command: "ls" }),
      ];
      const verdict = checkDoomLoop(history, [], makeCall("3", "bash", { command: "ls" }));
      expect(verdict.action).toBe("block");
      if (verdict.action === "block") {
        expect(verdict.reason).toBeTruthy();
      }
    });
  });

  describe("steer (alternating cycles)", () => {
    it("detects A→B→A→B alternating pattern", () => {
      const history = [
        makeCall("1", "edit_file", { path: "a.ts", oldText: "x", newText: "y" }),
        makeCall("2", "bash", { command: "npm test" }),
        makeCall("3", "edit_file", { path: "a.ts", oldText: "y", newText: "z" }),
        makeCall("4", "bash", { command: "npm test" }),
        makeCall("5", "edit_file", { path: "a.ts", oldText: "z", newText: "w" }),
      ];
      const current = makeCall("6", "bash", { command: "npm test" });
      const verdict = checkDoomLoop(history, [], current);
      expect(verdict.action).toBe("steer");
      if (verdict.action === "steer") {
        expect(verdict.message).toContain("alternating");
        expect(verdict.message).toContain("edit_file");
        expect(verdict.message).toContain("bash");
      }
    });

    it("does not trigger for only 2 alternations (A→B→A)", () => {
      const history = [
        makeCall("1", "edit_file", { path: "a.ts", oldText: "x", newText: "y" }),
        makeCall("2", "bash", { command: "npm test" }),
      ];
      const current = makeCall("3", "edit_file", { path: "a.ts", oldText: "y", newText: "z" });
      const verdict = checkDoomLoop(history, [], current);
      expect(verdict.action).toBe("allow");
    });

    it("does not trigger when three distinct tools rotate (A→B→C→A→B→C)", () => {
      const history = [
        makeCall("1", "edit_file", { path: "a.ts", oldText: "x", newText: "y" }),
        makeCall("2", "bash", { command: "npm test" }),
        makeCall("3", "read_file", { path: "b.ts" }),
        makeCall("4", "edit_file", { path: "a.ts", oldText: "y", newText: "z" }),
        makeCall("5", "bash", { command: "npm test" }),
      ];
      const current = makeCall("6", "read_file", { path: "b.ts" });
      const verdict = checkDoomLoop(history, [], current);
      expect(verdict.action).toBe("allow");
    });
  });

  describe("steer (repeated identical errors)", () => {
    it("detects the same tool returning the same error 3+ times", () => {
      const history = [
        makeCall("1", "bash", { command: "npm test" }),
        makeCall("2", "bash", { command: "npm test --fix" }),
        makeCall("3", "bash", { command: "npm run test" }),
      ];
      const results = [
        makeResult("1", "Error: Cannot find module 'foo'", true),
        makeResult("2", "Error: Cannot find module 'foo'", true),
        makeResult("3", "Error: Cannot find module 'foo'", true),
      ];
      const current = makeCall("4", "bash", { command: "npx jest" });
      const verdict = checkDoomLoop(history, results, current);
      expect(verdict.action).toBe("steer");
      if (verdict.action === "steer") {
        expect(verdict.message).toContain("3");
        expect(verdict.message).toContain("root cause");
      }
    });

    it("does not trigger when errors differ", () => {
      const history = [
        makeCall("1", "bash", { command: "npm test" }),
        makeCall("2", "bash", { command: "npm test --fix" }),
        makeCall("3", "bash", { command: "npm run test" }),
      ];
      const results = [
        makeResult("1", "Error: Cannot find module 'foo'", true),
        makeResult("2", "Error: Cannot find module 'bar'", true),
        makeResult("3", "Error: Cannot find module 'baz'", true),
      ];
      const current = makeCall("4", "bash", { command: "npx jest" });
      const verdict = checkDoomLoop(history, results, current);
      expect(verdict.action).toBe("allow");
    });

    it("does not trigger for fewer than 3 repeated errors", () => {
      const history = [
        makeCall("1", "bash", { command: "npm test" }),
        makeCall("2", "bash", { command: "npm test --fix" }),
      ];
      const results = [
        makeResult("1", "Error: Cannot find module 'foo'", true),
        makeResult("2", "Error: Cannot find module 'foo'", true),
      ];
      const current = makeCall("3", "bash", { command: "npm run test" });
      const verdict = checkDoomLoop(history, results, current);
      expect(verdict.action).toBe("allow");
    });

    it("does not trigger when the current call targets a different tool", () => {
      const history = [
        makeCall("1", "bash", { command: "npm test" }),
        makeCall("2", "bash", { command: "npm test --fix" }),
        makeCall("3", "bash", { command: "npm run test" }),
      ];
      const results = [
        makeResult("1", "Error: Cannot find module 'foo'", true),
        makeResult("2", "Error: Cannot find module 'foo'", true),
        makeResult("3", "Error: Cannot find module 'foo'", true),
      ];
      const current = makeCall("4", "read_file", { path: "package.json" });
      const verdict = checkDoomLoop(history, results, current);
      expect(verdict.action).toBe("allow");
    });

    it("ignores non-error results", () => {
      const history = [
        makeCall("1", "bash", { command: "npm test" }),
        makeCall("2", "bash", { command: "npm test --watch" }),
        makeCall("3", "bash", { command: "npm run test" }),
      ];
      const results = [
        makeResult("1", "All tests passed", false),
        makeResult("2", "All tests passed", false),
        makeResult("3", "All tests passed", false),
      ];
      const current = makeCall("4", "bash", { command: "npx jest" });
      const verdict = checkDoomLoop(history, results, current);
      expect(verdict.action).toBe("allow");
    });
  });

  describe("steer (per-file soft counter)", () => {
    function editHistory(filePath: string, count: number): ToolCallRequest[] {
      return Array.from({ length: count }, (_, i) =>
        makeCall(`e${i}`, "edit_file", { path: filePath, oldText: `old${i}`, newText: `new${i}` }),
      );
    }

    it("steers after 5 edits to the same file via edit_file", () => {
      const history = editHistory("src/app.ts", 5);
      const current = makeCall("e5", "edit_file", { path: "src/app.ts", oldText: "a", newText: "b" });
      const verdict = checkDoomLoop(history, [], current);
      expect(verdict.action).toBe("steer");
      if (verdict.action === "steer") {
        expect(verdict.message).toContain("src/app.ts");
        expect(verdict.message).toContain("6");
      }
    });

    it("steers after 5 edits to the same file via write_file", () => {
      const history = Array.from({ length: 5 }, (_, i) =>
        makeCall(`w${i}`, "write_file", { path: "src/app.ts", content: `v${i}` }),
      );
      const current = makeCall("w5", "write_file", { path: "src/app.ts", content: "v5" });
      const verdict = checkDoomLoop(history, [], current);
      expect(verdict.action).toBe("steer");
      if (verdict.action === "steer") {
        expect(verdict.message).toContain("src/app.ts");
      }
    });

    it("counts mixed edit_file and write_file calls to the same path", () => {
      const history = [
        makeCall("1", "edit_file", { path: "src/app.ts", oldText: "a", newText: "b" }),
        makeCall("2", "write_file", { path: "src/app.ts", content: "full" }),
        makeCall("3", "edit_file", { path: "src/app.ts", oldText: "b", newText: "c" }),
        makeCall("4", "write_file", { path: "src/app.ts", content: "full2" }),
        makeCall("5", "edit_file", { path: "src/app.ts", oldText: "c", newText: "d" }),
      ];
      const current = makeCall("6", "edit_file", { path: "src/app.ts", oldText: "d", newText: "e" });
      const verdict = checkDoomLoop(history, [], current);
      expect(verdict.action).toBe("steer");
    });

    it("does not steer at 4 prior edits (below threshold)", () => {
      const history = editHistory("src/app.ts", 4);
      const current = makeCall("e4", "edit_file", { path: "src/app.ts", oldText: "a", newText: "b" });
      const verdict = checkDoomLoop(history, [], current);
      expect(verdict.action).toBe("allow");
    });

    it("does not steer when edits target different files", () => {
      const history = [
        makeCall("1", "edit_file", { path: "src/a.ts", oldText: "a", newText: "b" }),
        makeCall("2", "edit_file", { path: "src/b.ts", oldText: "a", newText: "b" }),
        makeCall("3", "edit_file", { path: "src/c.ts", oldText: "a", newText: "b" }),
        makeCall("4", "edit_file", { path: "src/d.ts", oldText: "a", newText: "b" }),
        makeCall("5", "edit_file", { path: "src/e.ts", oldText: "a", newText: "b" }),
      ];
      const current = makeCall("6", "edit_file", { path: "src/f.ts", oldText: "a", newText: "b" });
      const verdict = checkDoomLoop(history, [], current);
      expect(verdict.action).toBe("allow");
    });

    it("does not count non-edit tool calls toward the file counter", () => {
      const history = [
        makeCall("1", "read_file", { path: "src/app.ts" }),
        makeCall("2", "read_file", { path: "src/app.ts", offset: 10 }),
        makeCall("3", "read_file", { path: "src/app.ts", offset: 20 }),
        makeCall("4", "read_file", { path: "src/app.ts", offset: 30 }),
        makeCall("5", "read_file", { path: "src/app.ts", offset: 40 }),
      ];
      const current = makeCall("6", "read_file", { path: "src/app.ts", offset: 50 });
      const verdict = checkDoomLoop(history, [], current);
      expect(verdict.action).toBe("allow");
    });
  });

  describe("steer does not block execution", () => {
    it("steer verdict has action 'steer' not 'block'", () => {
      const history = [
        makeCall("1", "edit_file", { path: "a.ts", oldText: "x", newText: "y" }),
        makeCall("2", "bash", { command: "npm test" }),
        makeCall("3", "edit_file", { path: "a.ts", oldText: "y", newText: "z" }),
        makeCall("4", "bash", { command: "npm test" }),
        makeCall("5", "edit_file", { path: "a.ts", oldText: "z", newText: "w" }),
      ];
      const current = makeCall("6", "bash", { command: "npm test" });
      const verdict = checkDoomLoop(history, [], current);
      expect(verdict.action).toBe("steer");
      expect(verdict.action).not.toBe("block");
    });
  });

  describe("purity", () => {
    it("does not mutate history or results", () => {
      const history = [
        makeCall("1", "bash", { command: "ls" }),
        makeCall("2", "bash", { command: "ls" }),
      ];
      const results = [makeResult("1", "ok", false), makeResult("2", "ok", false)];
      const historySnapshot = JSON.stringify(history);
      const resultsSnapshot = JSON.stringify(results);
      checkDoomLoop(history, results, makeCall("3", "bash", { command: "ls" }));
      expect(JSON.stringify(history)).toBe(historySnapshot);
      expect(JSON.stringify(results)).toBe(resultsSnapshot);
    });
  });
});
