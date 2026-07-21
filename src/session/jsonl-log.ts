import { appendFile, readFile, mkdir, truncate } from "node:fs/promises";
import { dirname } from "node:path";

const NEWLINE_BYTE = 0x0a;

// If a prior append was interrupted by a crash, the file ends mid-line with
// no trailing newline. Appending onto that as-is would fuse the new entry
// onto the torn fragment, producing one unparseable line and permanently
// losing every entry appended afterward (readJsonlEntries stops at the first
// parse failure). Truncate back to the last complete line first so the new
// entry always starts on a fresh line.
async function repairTornTail(filePath: string): Promise<void> {
  let buf: Buffer;
  try {
    buf = await readFile(filePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
  if (buf.length === 0 || buf[buf.length - 1] === NEWLINE_BYTE) return;

  const lastNewlineIndex = buf.lastIndexOf(NEWLINE_BYTE);
  const validLength = lastNewlineIndex === -1 ? 0 : lastNewlineIndex + 1;
  await truncate(filePath, validLength);
}

export async function appendJsonlEntry(filePath: string, entry: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await repairTornTail(filePath);
  await appendFile(filePath, JSON.stringify(entry) + "\n", "utf8");
}

export async function readJsonlEntries<T>(filePath: string): Promise<T[]> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  const lines = raw.split("\n").filter((line) => line.length > 0);
  const entries: T[] = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line) as T);
    } catch {
      // A parse failure only happens on the last line of a log torn mid-write
      // by a crash. Stop here and keep everything already collected rather
      // than discarding the whole session.
      break;
    }
  }
  return entries;
}
