import { appendFile, mkdir, open, readFile, truncate } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { dirname } from "node:path";

const NEWLINE_BYTE = 0x0a;

// Chunk size used when scanning backward for the last newline in a torn file.
// Bounds the repair cost to O(chunk) instead of O(file size) even on the rare
// torn-tail path (see repairTornTail below).
const BACKWARD_SCAN_CHUNK_SIZE = 64 * 1024;

// If a prior append was interrupted by a crash, the file ends mid-line with
// no trailing newline. Appending onto that as-is would fuse the new entry
// onto the torn fragment, producing one unparseable line and permanently
// losing every entry appended afterward (readJsonlEntries stops at the first
// parse failure). Truncate back to the last complete line first so the new
// entry always starts on a fresh line.
//
// Performance: this runs on every append, so the common case -- a file that
// already ends cleanly with a newline because the previous append succeeded
// -- must stay O(1) regardless of how large the file has grown. We check
// only the final byte for that case and return immediately. Only when the
// file is actually torn do we pay for a backward scan, and even then we scan
// in bounded chunks from the tail rather than reading the whole file.
async function repairTornTail(filePath: string): Promise<void> {
  let handle: FileHandle;
  try {
    handle = await open(filePath, "r");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }

  try {
    const { size } = await handle.stat();
    if (size === 0) return;

    const lastByte = Buffer.alloc(1);
    await handle.read(lastByte, 0, 1, size - 1);
    if (lastByte[0] === NEWLINE_BYTE) return;

    const lastNewlineIndex = await findLastNewlineIndex(handle, size);
    const validLength = lastNewlineIndex === -1 ? 0 : lastNewlineIndex + 1;
    await truncate(filePath, validLength);
  } finally {
    await handle.close();
  }
}

// Scans backward from the end of the file in bounded chunks and returns the
// byte offset of the last newline, or -1 if the file contains none.
async function findLastNewlineIndex(handle: FileHandle, size: number): Promise<number> {
  let position = size;
  while (position > 0) {
    const chunkSize = Math.min(BACKWARD_SCAN_CHUNK_SIZE, position);
    const start = position - chunkSize;
    const chunk = Buffer.alloc(chunkSize);
    await handle.read(chunk, 0, chunkSize, start);
    const indexInChunk = chunk.lastIndexOf(NEWLINE_BYTE);
    if (indexInChunk !== -1) return start + indexInChunk;
    position = start;
  }
  return -1;
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
