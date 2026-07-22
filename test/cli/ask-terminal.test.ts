import { describe, it, expect, vi } from "vitest";
import { createInterface } from "node:readline/promises";
import { parseYesNo, formatAskPrompt, askTerminal } from "../../src/cli/ask-terminal.js";
import type { Interface } from "node:readline/promises";

// Mocked so the "does not create its own readline interface" test below can
// assert createInterface is never called by askTerminal -- native ESM
// built-ins can't be vi.spyOn'd in place (their exports aren't configurable),
// so the module itself must be mocked instead.
vi.mock("node:readline/promises", () => ({
  createInterface: vi.fn(),
}));

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

describe("askTerminal", () => {
  // Regression tests for a defect where askTerminal created its own
  // readline Interface on process.stdin even though the CLI's main loop
  // already keeps one alive for the whole session. Two Interfaces sharing
  // one input stream corrupts real TTY input (duplicate-echoed keystrokes)
  // and closing either one disables raw mode for the other. askTerminal
  // must reuse the caller's Interface instead of creating its own.

  it("asks the question through the provided readline interface and returns the parsed answer", async () => {
    const question = vi.fn().mockResolvedValue("y");
    const fakeRl = { question } as unknown as Interface;
    const call = { id: "1", name: "bash", input: { command: "ls" } };

    const approved = await askTerminal(call, fakeRl);

    expect(approved).toBe(true);
    expect(question).toHaveBeenCalledWith(formatAskPrompt(call));
  });

  it("parses a 'n' answer from the provided interface as denied", async () => {
    const question = vi.fn().mockResolvedValue("n");
    const fakeRl = { question } as unknown as Interface;

    const approved = await askTerminal({ id: "1", name: "bash", input: {} }, fakeRl);

    expect(approved).toBe(false);
  });

  it("does not create its own readline interface (must reuse the caller's, to avoid a second Interface on process.stdin)", async () => {
    const question = vi.fn().mockResolvedValue("y");
    const fakeRl = { question } as unknown as Interface;

    await askTerminal({ id: "1", name: "bash", input: {} }, fakeRl);

    expect(createInterface).not.toHaveBeenCalled();
  });

  it("creates its own readline interface when none is provided (preserves the original single-argument contract)", async () => {
    const question = vi.fn().mockResolvedValue("y");
    const close = vi.fn();
    vi.mocked(createInterface).mockReturnValue({ question, close } as unknown as Interface);

    const approved = await askTerminal({ id: "1", name: "bash", input: {} });

    expect(createInterface).toHaveBeenCalled();
    expect(approved).toBe(true);
    expect(close).toHaveBeenCalled();
  });
});
