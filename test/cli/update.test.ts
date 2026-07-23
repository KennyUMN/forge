import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runUpdate, UPDATE_STEPS } from "../../src/cli/update.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "forge-update-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("runUpdate", () => {
  it("runs pull, install and build in order, all in the install root", async () => {
    await mkdir(join(dir, ".git"), { recursive: true });
    const calls: { command: string; args: string[]; cwd: string }[] = [];

    await runUpdate({ root: dir, log: () => {}, run: async (command, args, cwd) => void calls.push({ command, args, cwd }) });

    expect(calls.map((c) => `${c.command} ${c.args.join(" ")}`)).toEqual([
      "git pull --ff-only",
      "npm install",
      "npm run build",
    ]);
    expect(calls.every((c) => c.cwd === dir)).toBe(true);
  });

  // --ff-only rather than a plain pull: a diverged checkout should stop the
  // update, not gain a merge commit in what the user treats as an install dir.
  it("pulls fast-forward only", () => {
    expect(UPDATE_STEPS[0].args).toContain("--ff-only");
  });

  it("explains how to reinstall when the install root is not a git checkout", async () => {
    await expect(runUpdate({ root: dir, log: () => {}, run: async () => {} })).rejects.toThrow(
      /not a git checkout/,
    );
  });

  it("does not run any step when the git check fails", async () => {
    let ran = false;

    await expect(
      runUpdate({ root: dir, log: () => {}, run: async () => void (ran = true) }),
    ).rejects.toThrow();
    expect(ran).toBe(false);
  });

  // A bare "Command failed: git pull" gives no clue which of the three steps
  // broke, which matters most when the failure is a diverged checkout.
  it("names the failing step and preserves its output", async () => {
    await mkdir(join(dir, ".git"), { recursive: true });

    await expect(
      runUpdate({
        root: dir,
        log: () => {},
        run: async (command) => {
          if (command === "npm") throw new Error("ENOENT: npm not found");
        },
      }),
    ).rejects.toThrow(/"npm install" failed:[\s\S]*npm not found/);
  });

  it("stops at the first failing step instead of continuing", async () => {
    await mkdir(join(dir, ".git"), { recursive: true });
    const ran: string[] = [];

    await expect(
      runUpdate({
        root: dir,
        log: () => {},
        run: async (command, args) => {
          ran.push(`${command} ${args.join(" ")}`);
          if (command === "git") throw new Error("diverged");
        },
      }),
    ).rejects.toThrow(/diverged/);
    expect(ran).toEqual(["git pull --ff-only"]);
  });
});
