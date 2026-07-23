import { join } from "node:path";
import { forgeHome } from "./paths.js";

// forge is invoked from arbitrary directories, so a key stored only in the
// project it was set up in would be unreachable everywhere else. Loading the
// user-level file first and the project file second means a repo can override
// a global key (e.g. a work account) without either file having to know about
// the other.
//
// process.loadEnvFile() never overwrites a variable already present in the
// environment, so an explicitly exported key still beats both files.
export function loadEnvFiles(cwd: string, home?: string): string[] {
  const loaded: string[] = [];
  for (const path of [join(forgeHome(home), ".env"), join(cwd, ".env")]) {
    try {
      process.loadEnvFile(path);
      loaded.push(path);
    } catch {
      // Missing or unreadable .env files are the normal case, not an error --
      // keys are just as validly supplied by the ambient environment.
    }
  }
  return loaded;
}
