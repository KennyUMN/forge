import { appendFile, readFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export async function appendJsonlEntry(filePath: string, entry: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
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
