import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { SessionStore } from "../../src/session/session-store.js";
import type { SessionEntry } from "../../src/types/session.js";

// PRD §7 success criterion #3: a killed-mid-write session directory reloads
// cleanly, "verified with an actual kill-process test, not just a unit test of
// the parser". This spawns a real child that appends session entries in a tight
// loop, SIGKILLs it while it is writing, then reloads with the real SessionStore
// and asserts only the last (unwritten) entry can be lost.

const writerFixture = fileURLToPath(new URL("../fixtures/session-writer.js", import.meta.url));

const SESSION_ID = "kill-test-session";
const PAYLOAD_BYTES = 2048;
// Wait until the child has flushed at least this many complete entries before
// killing it, so "lost the whole session" would be a real, detectable failure
// rather than a race where the child had barely started.
const MIN_ENTRIES_BEFORE_KILL = 25;

let dir: string;
let child: ChildProcess | undefined;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "forge-kill-"));
});

afterEach(async () => {
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
  }
  child = undefined;
  await rm(dir, { recursive: true, force: true });
});

async function countCompleteLines(filePath: string): Promise<number> {
  try {
    const raw = await readFile(filePath, "utf8");
    // Only fully-terminated lines count; a torn final line has no trailing "\n".
    return raw.split("\n").filter((line) => line.length > 0 && line.endsWith("}")).length;
  } catch {
    return 0;
  }
}

describe("crash recovery across a real process kill (PRD §7 #3)", () => {
  it(
    "reloads cleanly after SIGKILL mid-write, losing at most the last unwritten entry",
    async () => {
      const filePath = join(dir, `${SESSION_ID}.jsonl`);

      child = spawn("node", [writerFixture, dir, SESSION_ID, String(PAYLOAD_BYTES)], {
        stdio: "ignore",
      });

      // Poll until the child has written enough complete entries, then kill it
      // mid-flight. Bounded so a hung/failed child fails the test instead of
      // hanging forever.
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        if ((await countCompleteLines(filePath)) >= MIN_ENTRIES_BEFORE_KILL) break;
        await sleep(20);
      }
      const completeBeforeKill = await countCompleteLines(filePath);
      expect(completeBeforeKill).toBeGreaterThanOrEqual(MIN_ENTRIES_BEFORE_KILL);

      // SIGKILL cannot be trapped or flushed, so this is a true crash mid-write.
      child.kill("SIGKILL");
      await new Promise<void>((resolve) => child!.once("exit", () => resolve()));

      // The real recovery path: SessionStore.load -> readJsonlEntries.
      const reloaded = await SessionStore.load(dir, SESSION_ID);
      const entries = reloaded.getEntries() as readonly SessionEntry[];

      // Nothing beyond the torn tail was lost: a large, unbroken prefix survives.
      expect(entries.length).toBeGreaterThanOrEqual(completeBeforeKill - 1);

      // Surviving entries are an intact, gap-free prefix with a valid parent chain.
      entries.forEach((entry, index) => {
        expect((entry.payload as { counter: number }).counter).toBe(index);
        expect(entry.id).toBe(`entry-${index}`);
        expect(entry.parentId).toBe(index === 0 ? null : `entry-${index - 1}`);
      });
      expect(reloaded.getHeadId()).toBe(entries[entries.length - 1].id);

      // Resuming and appending must repair the torn tail (if any) and continue
      // cleanly -- proving the crashed session is not just readable but usable.
      const resumed = await SessionStore.load(dir, SESSION_ID);
      const appended = await resumed.append("assistant_message", { resumed: true });
      expect(appended.parentId).toBe(entries[entries.length - 1].id);

      const afterResume = await SessionStore.load(dir, SESSION_ID);
      const afterEntries = afterResume.getEntries();
      expect(afterEntries.length).toBe(entries.length + 1);
      expect(afterEntries[afterEntries.length - 1].payload).toEqual({ resumed: true });
    },
    20_000,
  );
});
