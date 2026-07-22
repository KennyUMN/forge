import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Readable, PassThrough } from "node:stream";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../../src/cli/main.js";

let dir: string;
let originalCwd: string;
let originalApiKey: string | undefined;
let originalStdinDescriptor: PropertyDescriptor | undefined;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "forge-main-"));
  originalCwd = process.cwd();
  process.chdir(dir);
  originalApiKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "sk-test-placeholder";
  originalStdinDescriptor = Object.getOwnPropertyDescriptor(process, "stdin");
});

afterEach(async () => {
  process.chdir(originalCwd);
  if (originalApiKey === undefined) {
    delete process.env.ANTHROPIC_API_KEY;
  } else {
    process.env.ANTHROPIC_API_KEY = originalApiKey;
  }
  if (originalStdinDescriptor) {
    Object.defineProperty(process, "stdin", originalStdinDescriptor);
  }
  await rm(dir, { recursive: true, force: true });
});

describe("main", () => {
  it(
    "returns instead of hanging when stdin hits EOF (Ctrl-D / piped input closing) before any command is typed",
    async () => {
      // Regression test for a prompt loop that hung forever on stdin EOF
      // because rl.question() never settles once the underlying stream ends.
      Object.defineProperty(process, "stdin", { value: Readable.from([]), configurable: true });

      await expect(main([])).resolves.toBeUndefined();
    },
    3000,
  );

  it(
    "does not leak a close/error listener pair on rl across multiple prompt iterations",
    async () => {
      // Regression test for a leak where racing rl.question() against a
      // freshly-registered once(rl, "close") on every loop iteration (rather
      // than a single listener hoisted outside the loop) accumulates a
      // "close" and "error" listener on every turn that doesn't hit EOF.
      // Blank lines take the loop's `continue` branch, so they exercise many
      // non-EOF iterations without ever calling runTurn (no real API call).
      // The trailing "/exit" ends the loop via the ordinary exit path rather
      // than true stdin EOF.
      //
      // Lines are written one at a time via setImmediate (rather than handed
      // to the stream all at once, e.g. via Readable.from(array)) so readline
      // processes each "line" event on its own tick instead of seeing the
      // whole input plus end-of-stream in one go -- the latter causes
      // readline to close after only the first line, independent of this
      // fix, which would make the test fail for an unrelated reason.
      const stdin = new PassThrough();
      Object.defineProperty(process, "stdin", { value: stdin, configurable: true });

      const inputLines = [...Array(15).fill(""), "/exit"];
      let lineIndex = 0;
      const pump = (): void => {
        if (lineIndex >= inputLines.length) {
          stdin.end();
          return;
        }
        stdin.write(inputLines[lineIndex] + "\n");
        lineIndex++;
        setImmediate(pump);
      };
      pump();

      const warnings: string[] = [];
      const onWarning = (warning: Error) => {
        if (warning.name === "MaxListenersExceededWarning") {
          warnings.push(warning.message);
        }
      };
      process.on("warning", onWarning);

      try {
        await main([]);
      } finally {
        process.off("warning", onWarning);
      }

      expect(warnings).toEqual([]);
    },
    5000,
  );
});
