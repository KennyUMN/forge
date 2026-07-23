import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Readable, PassThrough } from "node:stream";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { main } from "../../src/cli/main.js";

const fixtureServerPath = fileURLToPath(new URL("../fixtures/mcp-fixture-server.js", import.meta.url));

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

  it(
    "fails fast on a missing provider API key before spawning any configured MCP server subprocess",
    async () => {
      // Regression test for an ordering bug where buildToolRegistry() (which
      // spawns MCP server subprocesses) ran before buildProvider() (which
      // throws via requireEnv() when the provider's API key env var is
      // missing) -- orphaning the spawned subprocess instead of failing fast
      // before anything spawns. StdioClientTransport#start() is the method
      // that actually calls child_process.spawn(), so asserting it's never
      // called is a direct check that no subprocess was spawned.
      delete process.env.ANTHROPIC_API_KEY;
      await writeFile(
        join(dir, "forge.config.json"),
        JSON.stringify({ mcpServers: [{ name: "fixture", command: "node", args: [fixtureServerPath] }] }),
        "utf8",
      );

      const startSpy = vi.spyOn(StdioClientTransport.prototype, "start");

      try {
        await expect(main([])).rejects.toThrow(/ANTHROPIC_API_KEY/);
        expect(startSpy).not.toHaveBeenCalled();
      } finally {
        startSpy.mockRestore();
      }
    },
    3000,
  );
});
