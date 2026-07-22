import { describe, it, expect } from "vitest";
import { parseYesNo, formatAskPrompt } from "../../src/cli/ask-terminal.js";

describe("parseYesNo", () => {
  it("returns true for 'y'", () => {
    expect(parseYesNo("y")).toBe(true);
  });

  it("returns true for 'yes' case-insensitively", () => {
    expect(parseYesNo("Yes")).toBe(true);
    expect(parseYesNo("YES")).toBe(true);
  });

  it("returns false for 'n'", () => {
    expect(parseYesNo("n")).toBe(false);
  });

  it("returns false for empty input", () => {
    expect(parseYesNo("")).toBe(false);
  });

  it("returns false for anything else", () => {
    expect(parseYesNo("sure")).toBe(false);
  });

  it("trims whitespace before comparing", () => {
    expect(parseYesNo("  y  ")).toBe(true);
  });
});

describe("formatAskPrompt", () => {
  it("includes the tool name and JSON-stringified input", () => {
    const prompt = formatAskPrompt({ id: "1", name: "bash", input: { command: "ls" } });
    expect(prompt).toContain("bash");
    expect(prompt).toContain('{"command":"ls"}');
  });
});
