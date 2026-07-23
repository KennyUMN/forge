import { homedir } from "node:os";
import { join } from "node:path";

export const FORGE_HOME_ENV = "FORGE_HOME";
const DEFAULT_DIR_NAME = ".forge";

// The directory holding user-level configuration and secrets. Overridable via
// FORGE_HOME because anything reading the real home directory makes behaviour
// depend on whose machine it runs on -- the test suite needs an isolated one,
// and so does anyone running two configurations side by side.
export function forgeHome(home: string = homedir()): string {
  return process.env[FORGE_HOME_ENV] || join(home, DEFAULT_DIR_NAME);
}
