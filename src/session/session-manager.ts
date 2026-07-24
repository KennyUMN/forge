import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { readJsonlEntries } from "./jsonl-log.js";
import type { SessionEntry } from "../types/session.js";

export interface SessionSummary {
  id: string;
  startedAt: string;
  lastActivityAt: string;
  entryCount: number;
  firstUserMessage: string | null;
  cwd: string;
}

const PREVIEW_MAX_LENGTH = 80;

function extractPreview(entries: readonly SessionEntry[]): string | null {
  for (const entry of entries) {
    if (entry.type !== "user_message") continue;
    const payload = entry.payload as { text?: unknown };
    if (typeof payload.text === "string") {
      return payload.text.length > PREVIEW_MAX_LENGTH
        ? payload.text.slice(0, PREVIEW_MAX_LENGTH)
        : payload.text;
    }
  }
  return null;
}

export async function listSessions(sessionsDir: string): Promise<SessionSummary[]> {
  let files: string[];
  try {
    files = await readdir(sessionsDir);
  } catch {
    return [];
  }

  const summaries: SessionSummary[] = [];
  const cwd = resolve(sessionsDir, "..", "..");

  for (const file of files) {
    if (!file.endsWith(".jsonl")) continue;
    const id = file.slice(0, -".jsonl".length);
    const entries = await readJsonlEntries<SessionEntry>(join(sessionsDir, file));
    if (entries.length === 0) continue;

    summaries.push({
      id,
      startedAt: entries[0].timestamp,
      lastActivityAt: entries[entries.length - 1].timestamp,
      entryCount: entries.length,
      firstUserMessage: extractPreview(entries),
      cwd,
    });
  }

  summaries.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
  return summaries;
}

export async function getSessionEntries(sessionsDir: string, sessionId: string): Promise<SessionEntry[]> {
  return readJsonlEntries<SessionEntry>(join(sessionsDir, `${sessionId}.jsonl`));
}
