import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findLatestSessionId, parseArgs, resolveSession } from "../../src/cli/resolve-session.js";
import { SessionStore } from "../../src/session/session-store.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "forge-resolve-session-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("parseArgs", () => {
  it("returns no resumeSessionId when --resume is absent", () => {
    expect(parseArgs([])).toEqual({});
  });

  it("returns resumeSessionId when --resume <id> is given", () => {
    expect(parseArgs(["--resume", "abc-123"])).toEqual({ resumeSessionId: "abc-123" });
  });

  it("ignores a trailing --resume with no id", () => {
    expect(parseArgs(["--resume"])).toEqual({});
  });
});

describe("resolveSession", () => {
  it("creates a new session when no resumeSessionId is given", async () => {
    const session = await resolveSession(dir, {});
    expect(session.sessionId).toBeTruthy();
    expect(session.getEntries()).toEqual([]);
  });

  it("resumes an existing session by id, preserving its history", async () => {
    const original = await SessionStore.create(dir);
    await original.append("user_message", { text: "hello" });

    const resumed = await resolveSession(dir, { resumeSessionId: original.sessionId });

    expect(resumed.getEntries()).toEqual(original.getEntries());
  });

  it("resumes the most recently written session with continueLatest", async () => {
    const older = await SessionStore.create(dir);
    await older.append("user_message", { text: "older" });
    const newer = await SessionStore.create(dir);
    await newer.append("user_message", { text: "newer" });

    const resumed = await resolveSession(dir, { continueLatest: true });

    expect(resumed.sessionId).toBe(newer.sessionId);
    expect(resumed.getEntries()).toEqual(newer.getEntries());
  });

  it("explains how to start one when continueLatest finds no previous session", async () => {
    await expect(resolveSession(dir, { continueLatest: true })).rejects.toThrow(/No previous session found/);
  });

  it("treats a sessions directory that does not exist as having no previous session", async () => {
    await expect(resolveSession(join(dir, "never-created"), { continueLatest: true })).rejects.toThrow(
      /No previous session found/,
    );
  });
});

describe("findLatestSessionId", () => {
  it("returns undefined for a directory holding no session logs", async () => {
    expect(await findLatestSessionId(dir)).toBeUndefined();
  });

  // The sessions directory also holds whatever else a user or editor drops in
  // it; only .jsonl files are sessions, and slicing the extension off anything
  // else would produce an id that fails to load.
  it("ignores files that are not .jsonl session logs", async () => {
    await writeFile(join(dir, "notes.txt"), "scratch", "utf8");

    expect(await findLatestSessionId(dir)).toBeUndefined();
  });
});
