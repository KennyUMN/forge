import { isAbsolute, join } from "node:path";

export const DEFAULT_IGNORE = ["**/node_modules/**", "**/.git/**", "**/dist/**"];

export function resolveSearchRoot(inputPath: string | undefined, cwd: string): string {
  if (!inputPath) return cwd;
  return isAbsolute(inputPath) ? inputPath : join(cwd, inputPath);
}
