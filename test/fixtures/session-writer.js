// Child process for the kill-mid-write crash-recovery test (PRD §7 success
// criterion #3: verified with an actual kill-process test, not just a unit
// test of the parser).
//
// Appends session entries to `${sessionId}.jsonl` in a tight synchronous loop,
// forever, until the parent SIGKILLs it. Writes are synchronous and strictly
// sequential so the on-disk file is always a growing, ordered prefix; a SIGKILL
// can only ever land between two complete lines or partway through the final
// line (a torn tail) -- exactly the crash shape readJsonlEntries/repairTornTail
// must tolerate.
//
// Deterministic ids (entry-0, entry-1, ...) and a monotonic `counter` let the
// parent assert that the reloaded entries form an unbroken prefix with an
// intact parentId chain -- proving only the last unwritten entry can be lost,
// never the whole session.
import { appendFileSync } from "node:fs";
import { join } from "node:path";

const [sessionsDir, sessionId, sizeStr] = process.argv.slice(2);
const filePath = join(sessionsDir, `${sessionId}.jsonl`);

// A large-ish payload widens the window in which a SIGKILL lands partway
// through a line, so the test actually exercises torn-tail recovery rather
// than only clean between-line boundaries.
const padding = "x".repeat(Number(sizeStr) || 0);

let parentId = null;
for (let i = 0; ; i++) {
  const id = `entry-${i}`;
  const entry = {
    id,
    parentId,
    type: "user_message",
    timestamp: new Date().toISOString(),
    payload: { counter: i, padding },
  };
  appendFileSync(filePath, JSON.stringify(entry) + "\n");
  parentId = id;
}
