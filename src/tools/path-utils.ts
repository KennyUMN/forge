import { isAbsolute, join } from "node:path";

export function resolvePath(inputPath: string, cwd: string): string {
  return isAbsolute(inputPath) ? inputPath : join(cwd, inputPath);
}
