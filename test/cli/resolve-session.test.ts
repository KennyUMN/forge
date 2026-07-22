import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs, resolveSession } from "../../src/cli/resolve-session.js";
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
});
