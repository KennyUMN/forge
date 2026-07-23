import { isAbsolute, join } from "node:path";

export function resolvePath(inputPath: string | undefined, cwd: string): string {
  if (!inputPath) return cwd;
  return isAbsolute(inputPath) ? inputPath : join(cwd, inputPath);
}

// Every path a tool reports back to the model must use forward slashes. The
// model feeds those paths straight back into glob patterns, which are POSIX-only
// -- so a Windows-native "src\a.ts" would round-trip into a pattern that matches
// nothing. Node accepts forward slashes on Windows for input, so normalising
// output costs nothing and keeps one path dialect in the conversation.
export function toPosixPath(path: string): string {
  return path.replace(/\\/g, "/");
}
