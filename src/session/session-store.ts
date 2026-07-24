import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { appendJsonlEntry, readJsonlEntries } from "./jsonl-log.js";
import type { EntryType, SessionEntry } from "../types/session.js";

export class SessionStore {
  private readonly filePath: string;
  private entries: SessionEntry[] = [];
  private headId: string | null = null;

  private constructor(
    readonly sessionId: string,
    readonly sessionsDir: string,
  ) {
    this.filePath = join(sessionsDir, `${sessionId}.jsonl`);
  }

  static async create(sessionsDir: string): Promise<SessionStore> {
    return new SessionStore(randomUUID(), sessionsDir);
  }

  static async createChild(sessionsDir: string, parentHeadId: string): Promise<SessionStore> {
    const store = new SessionStore(randomUUID(), sessionsDir);
    store.headId = parentHeadId;
    return store;
  }

  static async load(sessionsDir: string, sessionId: string): Promise<SessionStore> {
    const store = new SessionStore(sessionId, sessionsDir);
    store.entries = await readJsonlEntries<SessionEntry>(store.filePath);
    store.headId = store.entries.length > 0 ? store.entries[store.entries.length - 1].id : null;
    return store;
  }

  async append(type: EntryType, payload: unknown): Promise<SessionEntry> {
    const entry: SessionEntry = {
      id: randomUUID(),
      parentId: this.headId,
      type,
      timestamp: new Date().toISOString(),
      payload,
    };
    await appendJsonlEntry(this.filePath, entry);
    this.entries.push(entry);
    this.headId = entry.id;
    return entry;
  }

  getEntries(): readonly SessionEntry[] {
    return this.entries;
  }

  getHeadId(): string | null {
    return this.headId;
  }
}
