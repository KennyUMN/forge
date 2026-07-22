import { describe, it, expect } from "vitest";
import { isDoomLoop } from "../../src/agent/doom-loop.js";

const call = (input: unknown) => ({ id: "x", name: "bash", input });

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
