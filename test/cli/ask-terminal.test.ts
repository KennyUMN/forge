import { describe, it, expect, vi } from "vitest";
import { createInterface } from "node:readline/promises";
import { parseYesNo, formatAskPrompt, askTerminal, createSharedAskFn } from "../../src/cli/ask-terminal.js";
import type { Interface } from "node:readline/promises";

// Mocked so askTerminal's own createInterface call can be controlled --
// native ESM built-ins can't be vi.spyOn'd in place (their exports aren't
// configurable), so the module itself must be mocked instead.
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
  it("opens its own readline interface, asks the question, and closes it afterward", async () => {
    const question = vi.fn().mockResolvedValue("y");
    const close = vi.fn();
    vi.mocked(createInterface).mockReturnValue({ question, close } as unknown as Interface);

    const call = { id: "1", name: "bash", input: { command: "ls" } };
    const approved = await askTerminal(call);

    expect(createInterface).toHaveBeenCalled();
    expect(question).toHaveBeenCalledWith(formatAskPrompt(call));
    expect(approved).toBe(true);
    expect(close).toHaveBeenCalled();
  });

  it("parses a 'n' answer as denied", async () => {
    const question = vi.fn().mockResolvedValue("n");
    const close = vi.fn();
    vi.mocked(createInterface).mockReturnValue({ question, close } as unknown as Interface);

    const approved = await askTerminal({ id: "1", name: "bash", input: {} });

    expect(approved).toBe(false);
  });
});

describe("createSharedAskFn", () => {
  it("asks through the given interface and returns the parsed answer when it resolves before closed", async () => {
    const question = vi.fn().mockResolvedValue("y");
    const fakeRl = { question } as unknown as Interface;
    const neverCloses = new Promise<null>(() => {});

    const call = { id: "1", name: "bash", input: {} };
    const ask = createSharedAskFn(fakeRl, neverCloses);
    const approved = await ask(call);

    expect(approved).toBe(true);
    expect(question).toHaveBeenCalledWith(formatAskPrompt(call));
  });

  it("resolves to false (denied) instead of hanging when stdin closes before the question resolves", async () => {
    const question = vi.fn().mockReturnValue(new Promise<string>(() => {}));
    const fakeRl = { question } as unknown as Interface;
    const closed: Promise<null> = Promise.resolve(null);

    const ask = createSharedAskFn(fakeRl, closed);
    const approved = await ask({ id: "1", name: "bash", input: {} });

    expect(approved).toBe(false);
  });
});
