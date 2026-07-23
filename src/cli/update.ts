import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { installRoot } from "./install.js";

const execFileAsync = promisify(execFile);

export interface UpdateStep {
  label: string;
  command: string;
  args: string[];
}

// forge is installed from a git clone (the package is private, so there is no
// npm registry entry to upgrade from). Updating therefore means fast-forwarding
// the clone and rebuilding it in place.
//
// --ff-only is deliberate: if the checkout has diverged -- local commits, a
// different branch, a half-finished rebase -- the pull fails loudly instead of
// creating a merge commit in what the user thinks of as an install directory.
export const UPDATE_STEPS: readonly UpdateStep[] = [
  { label: "Fetching latest changes", command: "git", args: ["pull", "--ff-only"] },
  { label: "Installing dependencies", command: "npm", args: ["install"] },
  { label: "Rebuilding", command: "npm", args: ["run", "build"] },
];

export type CommandRunner = (command: string, args: string[], cwd: string) => Promise<void>;

const defaultRunner: CommandRunner = async (command, args, cwd) => {
  // shell: true is required on Windows, where npm is a .cmd shim that
  // execFile cannot invoke directly. The command and its arguments are all
  // hardcoded above -- no user input reaches this call.
  await execFileAsync(command, args, { cwd, shell: process.platform === "win32" });
};

export interface UpdateOptions {
  root?: string;
  run?: CommandRunner;
  log?: (message: string) => void;
}

export async function runUpdate(options: UpdateOptions = {}): Promise<void> {
  const root = options.root ?? installRoot();
  const run = options.run ?? defaultRunner;
  const log = options.log ?? console.log;

  try {
    await access(join(root, ".git"));
  } catch {
    throw new Error(
      `${root} is not a git checkout, so "forge update" cannot update it.\n` +
        `Reinstall by cloning the repository and running "npm install && npm run build && npm link".`,
    );
  }

  log(`Updating forge in ${root}`);
  for (const step of UPDATE_STEPS) {
    log(`  ${step.label}...`);
    try {
      await run(step.command, step.args, root);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(`"${step.command} ${step.args.join(" ")}" failed:\n${detail}`);
    }
  }
  log("forge is up to date.");
}
