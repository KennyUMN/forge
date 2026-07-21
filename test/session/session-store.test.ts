import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionStore } from "../../src/session/session-store.js";

describe("SessionStore", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "forge-session-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("gives a fresh session a null head and empty entries", async () => {
    const store = await SessionStore.create(dir);
    expect(store.getHeadId()).toBeNull();
    expect(store.getEntries()).toEqual([]);
  });

  it("appends entries with parentId chained to the previous head", async () => {
    const store = await SessionStore.create(dir);

    const first = await store.append("user_message", { text: "hello" });
    const second = await store.append("assistant_message", { text: "hi there" });

    expect(first.parentId).toBeNull();
    expect(second.parentId).toBe(first.id);
    expect(store.getHeadId()).toBe(second.id);
  });

  it("reloads a session from disk with the same entries and head", async () => {
    const store = await SessionStore.create(dir);
    await store.append("user_message", { text: "hello" });
    await store.append("assistant_message", { text: "hi there" });

    const reloaded = await SessionStore.load(dir, store.sessionId);

    expect(reloaded.getEntries()).toEqual(store.getEntries());
    expect(reloaded.getHeadId()).toBe(store.getHeadId());
  });
});
