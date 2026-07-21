import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendJsonlEntry, readJsonlEntries } from "../../src/session/jsonl-log.js";

describe("jsonl-log", () => {
  let dir: string;
  let filePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "forge-jsonl-"));
    filePath = join(dir, "session.jsonl");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns an empty array when the file does not exist yet", async () => {
    const entries = await readJsonlEntries(filePath);
    expect(entries).toEqual([]);
  });

  it("appends entries and reads them back in order", async () => {
    await appendJsonlEntry(filePath, { id: "1", value: "a" });
    await appendJsonlEntry(filePath, { id: "2", value: "b" });

    const entries = await readJsonlEntries<{ id: string; value: string }>(filePath);
    expect(entries).toEqual([
      { id: "1", value: "a" },
      { id: "2", value: "b" },
    ]);
  });

  it("discards a torn final line but keeps every entry before it", async () => {
    await appendJsonlEntry(filePath, { id: "1", value: "a" });
    await appendJsonlEntry(filePath, { id: "2", value: "b" });
    // simulate a crash mid-write: a truncated JSON line with no trailing newline
    await appendFile(filePath, '{"id":"3","value":"unterm', "utf8");

    const entries = await readJsonlEntries<{ id: string; value: string }>(filePath);
    expect(entries).toEqual([
      { id: "1", value: "a" },
      { id: "2", value: "b" },
    ]);
  });

  it("recovers from a torn line so entries appended after a crash are not lost", async () => {
    await appendJsonlEntry(filePath, { id: "1", value: "a" });
    await appendJsonlEntry(filePath, { id: "2", value: "b" });
    // simulate a crash mid-write: a truncated JSON line with no trailing newline
    await appendFile(filePath, '{"id":"3","value":"unterm', "utf8");

    // simulate the process resuming after the crash and continuing to append
    await appendJsonlEntry(filePath, { id: "4", value: "d" });
    await appendJsonlEntry(filePath, { id: "5", value: "e" });

    const entries = await readJsonlEntries<{ id: string; value: string }>(filePath);
    expect(entries).toEqual([
      { id: "1", value: "a" },
      { id: "2", value: "b" },
      { id: "4", value: "d" },
      { id: "5", value: "e" },
    ]);
  });
});
