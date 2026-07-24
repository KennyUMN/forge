import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listSessions, getSessionEntries } from "../../src/session/session-manager.js";
import type { SessionEntry } from "../../src/types/session.js";

function makeEntry(overrides: Partial<SessionEntry> & { type: SessionEntry["type"] }): SessionEntry {
  return {
    id: overrides.id ?? "entry-1",
    parentId: overrides.parentId ?? null,
    type: overrides.type,
    timestamp: overrides.timestamp ?? "2025-01-01T00:00:00.000Z",
    payload: overrides.payload ?? {},
  };
}

function jsonl(entries: SessionEntry[]): string {
  return entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
}

describe("session-manager", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "forge-sm-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe("listSessions", () => {
    it("returns empty array for an empty directory", async () => {
      const sessions = await listSessions(dir);
      expect(sessions).toEqual([]);
    });

    it("returns empty array for a nonexistent directory", async () => {
      const sessions = await listSessions(join(dir, "nope"));
      expect(sessions).toEqual([]);
    });

    it("lists sessions sorted by lastActivity descending", async () => {
      const older: SessionEntry[] = [
        makeEntry({ id: "a1", type: "user_message", timestamp: "2025-01-01T00:00:00.000Z", payload: { text: "old session" } }),
      ];
      const newer: SessionEntry[] = [
        makeEntry({ id: "b1", type: "user_message", timestamp: "2025-01-02T00:00:00.000Z", payload: { text: "new session" } }),
      ];
      await writeFile(join(dir, "session-old.jsonl"), jsonl(older));
      await writeFile(join(dir, "session-new.jsonl"), jsonl(newer));

      const sessions = await listSessions(dir);
      expect(sessions).toHaveLength(2);
      expect(sessions[0].id).toBe("session-new");
      expect(sessions[1].id).toBe("session-old");
    });

    it("extracts firstUserMessage truncated to 80 chars", async () => {
      const longText = "a".repeat(120);
      const entries: SessionEntry[] = [
        makeEntry({ id: "c1", type: "user_message", payload: { text: longText } }),
      ];
      await writeFile(join(dir, "session-long.jsonl"), jsonl(entries));

      const sessions = await listSessions(dir);
      expect(sessions[0].firstUserMessage).toBe("a".repeat(80));
    });

    it("sets firstUserMessage to null when no user message exists", async () => {
      const entries: SessionEntry[] = [
        makeEntry({ id: "d1", type: "assistant_message", payload: { text: "hello" } }),
      ];
      await writeFile(join(dir, "session-nomsg.jsonl"), jsonl(entries));

      const sessions = await listSessions(dir);
      expect(sessions[0].firstUserMessage).toBeNull();
    });

    it("reports entryCount and timestamps correctly", async () => {
      const entries: SessionEntry[] = [
        makeEntry({ id: "e1", type: "user_message", timestamp: "2025-03-01T10:00:00.000Z", payload: { text: "hi" } }),
        makeEntry({ id: "e2", parentId: "e1", type: "assistant_message", timestamp: "2025-03-01T10:01:00.000Z", payload: { text: "hey" } }),
        makeEntry({ id: "e3", parentId: "e2", type: "tool_call", timestamp: "2025-03-01T10:02:00.000Z", payload: { name: "bash" } }),
      ];
      await writeFile(join(dir, "session-multi.jsonl"), jsonl(entries));

      const sessions = await listSessions(dir);
      expect(sessions[0].entryCount).toBe(3);
      expect(sessions[0].startedAt).toBe("2025-03-01T10:00:00.000Z");
      expect(sessions[0].lastActivityAt).toBe("2025-03-01T10:02:00.000Z");
    });

    it("ignores non-jsonl files", async () => {
      await writeFile(join(dir, "readme.txt"), "not a session");
      await writeFile(join(dir, "session-valid.jsonl"), jsonl([
        makeEntry({ id: "f1", type: "user_message", payload: { text: "valid" } }),
      ]));

      const sessions = await listSessions(dir);
      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe("session-valid");
    });
  });

  describe("getSessionEntries", () => {
    it("returns all entries for a session", async () => {
      const entries: SessionEntry[] = [
        makeEntry({ id: "g1", type: "user_message", payload: { text: "hello" } }),
        makeEntry({ id: "g2", parentId: "g1", type: "assistant_message", payload: { text: "world" } }),
      ];
      await writeFile(join(dir, "my-session.jsonl"), jsonl(entries));

      const result = await getSessionEntries(dir, "my-session");
      expect(result).toEqual(entries);
    });

    it("returns empty array for a nonexistent session", async () => {
      const result = await getSessionEntries(dir, "does-not-exist");
      expect(result).toEqual([]);
    });
  });
});
