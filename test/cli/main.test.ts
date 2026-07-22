import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Readable } from "node:stream";
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
});
