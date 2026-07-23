import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { SessionStore } from "../session/session-store.js";
import type { CliOptions } from "./args.js";

export interface ParsedArgs {
  resumeSessionId?: string;
  continueLatest?: boolean;
}

// Retained as the narrow shape resolveSession() needs, so callers that already
// hold a full CliOptions can pass it directly.
export function parseArgs(argv: string[]): ParsedArgs {
  const resumeIndex = argv.indexOf("--resume");
  if (resumeIndex !== -1 && argv[resumeIndex + 1]) {
    return { resumeSessionId: argv[resumeIndex + 1] };
  }
  return {};
}

// Ordered by file mtime rather than by the timestamps inside each session,
// which would mean reading and parsing every log just to pick one.
export async function findLatestSessionId(sessionsDir: string): Promise<string | undefined> {
  let files: string[];
  try {
    files = await readdir(sessionsDir);
  } catch {
    return undefined;
  }

  let latest: { id: string; mtimeMs: number } | undefined;
  for (const file of files) {
    if (!file.endsWith(".jsonl")) continue;
    try {
      const stats = await stat(join(sessionsDir, file));
      if (!latest || stats.mtimeMs > latest.mtimeMs) {
        latest = { id: file.slice(0, -".jsonl".length), mtimeMs: stats.mtimeMs };
      }
    } catch {
      // A session file removed between readdir and stat is not an error --
      // it simply is not a candidate.
    }
  }
  return latest?.id;
}

export async function resolveSession(sessionsDir: string, args: ParsedArgs | CliOptions): Promise<SessionStore> {
  if (args.resumeSessionId) {
    return SessionStore.load(sessionsDir, args.resumeSessionId);
  }
  if (args.continueLatest) {
    const latest = await findLatestSessionId(sessionsDir);
    if (!latest) {
      throw new Error(`No previous session found in ${sessionsDir}; run forge without --continue to start one.`);
    }
    return SessionStore.load(sessionsDir, latest);
  }
  return SessionStore.create(sessionsDir);
}
