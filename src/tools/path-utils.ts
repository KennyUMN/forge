import { isAbsolute, join } from "node:path";

export function resolvePath(inputPath: string | undefined, cwd: string): string {
  if (!inputPath) return cwd;
  return isAbsolute(inputPath) ? inputPath : join(cwd, inputPath);
}
