import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportSessionToHtml } from "../../src/session/export.js";
import type { SessionEntry } from "../../src/types/session.js";

function makeEntry(type: SessionEntry["type"], payload: unknown, id = "e1"): SessionEntry {
  return {
    id,
    parentId: null,
    type,
    timestamp: "2025-01-15T10:30:00.000Z",
    payload,
  };
}

describe("exportSessionToHtml", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "forge-export-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("contains user messages", async () => {
    const entries: SessionEntry[] = [
      makeEntry("user_message", { text: "Hello, fix the bug in main.ts" }),
    ];
    const outPath = join(dir, "session.html");
    await exportSessionToHtml(entries, outPath);

    const html = await readFile(outPath, "utf8");
    expect(html).toContain("Hello, fix the bug in main.ts");
  });

  it("contains assistant text", async () => {
    const entries: SessionEntry[] = [
      makeEntry("assistant_message", { text: "I found the issue in the parser." }),
    ];
    const outPath = join(dir, "session.html");
    await exportSessionToHtml(entries, outPath);

    const html = await readFile(outPath, "utf8");
    expect(html).toContain("I found the issue in the parser.");
  });

  it("contains tool calls", async () => {
    const entries: SessionEntry[] = [
      makeEntry("tool_call", { toolName: "read_file", input: { path: "src/main.ts" } }),
    ];
    const outPath = join(dir, "session.html");
    await exportSessionToHtml(entries, outPath);

    const html = await readFile(outPath, "utf8");
    expect(html).toContain("read_file");
    expect(html).toContain("src/main.ts");
  });

  it("writes the file to disk", async () => {
    const entries: SessionEntry[] = [
      makeEntry("user_message", { text: "test" }),
    ];
    const outPath = join(dir, "output.html");
    await exportSessionToHtml(entries, outPath);

    const html = await readFile(outPath, "utf8");
    expect(html.length).toBeGreaterThan(0);
    expect(html).toContain("<!DOCTYPE html>");
  });

  it("is self-contained with no external links", async () => {
    const entries: SessionEntry[] = [
      makeEntry("user_message", { text: "hello" }),
      makeEntry("assistant_message", { text: "world" }),
      makeEntry("tool_call", { toolName: "bash", input: { command: "ls" } }),
      makeEntry("tool_result", { output: "file.txt" }),
    ];
    const outPath = join(dir, "session.html");
    await exportSessionToHtml(entries, outPath);

    const html = await readFile(outPath, "utf8");
    expect(html).not.toMatch(/<link[^>]+href=/);
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(html).toContain("<style>");
  });

  it("shows timestamps", async () => {
    const entries: SessionEntry[] = [
      makeEntry("user_message", { text: "hello" }),
    ];
    const outPath = join(dir, "session.html");
    await exportSessionToHtml(entries, outPath);

    const html = await readFile(outPath, "utf8");
    expect(html).toContain("2025-01-15");
  });
});
