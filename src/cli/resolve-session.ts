import { SessionStore } from "../session/session-store.js";

export interface ParsedArgs {
  resumeSessionId?: string;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const resumeIndex = argv.indexOf("--resume");
  if (resumeIndex !== -1 && argv[resumeIndex + 1]) {
    return { resumeSessionId: argv[resumeIndex + 1] };
  }
  return {};
}

export async function resolveSession(sessionsDir: string, args: ParsedArgs): Promise<SessionStore> {
  if (args.resumeSessionId) {
    return SessionStore.load(sessionsDir, args.resumeSessionId);
  }
  return SessionStore.create(sessionsDir);
}
