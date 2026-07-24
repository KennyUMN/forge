export interface BoundOptions {
  maxLines?: number;
  headLines?: number;
  tailLines?: number;
}

const DEFAULT_MAX_LINES = 200;
const DEFAULT_HEAD_LINES = 80;
const DEFAULT_TAIL_LINES = 40;
const DEFAULT_MAX_BYTES = 100_000;

export function boundOutput(output: string, options?: BoundOptions): string {
  const maxLines = options?.maxLines ?? DEFAULT_MAX_LINES;
  const headLines = options?.headLines ?? DEFAULT_HEAD_LINES;
  const tailLines = options?.tailLines ?? DEFAULT_TAIL_LINES;

  const lines = output.split("\n");
  if (lines.length <= maxLines) {
    return output;
  }

  const head = lines.slice(0, headLines);
  const tail = lines.slice(lines.length - tailLines);
  const elided = lines.length - headLines - tailLines;

  return `${head.join("\n")}\n…[${elided} lines elided]…\n${tail.join("\n")}`;
}

export function boundOutputBytes(
  output: string,
  options?: BoundOptions & { maxBytes?: number },
): string {
  const maxBytes = options?.maxBytes ?? DEFAULT_MAX_BYTES;

  let working = output;
  const byteLength = Buffer.byteLength(working, "utf-8");
  if (byteLength > maxBytes) {
    const headBytes = Math.floor(maxBytes * 0.7);
    const tailBytes = Math.floor(maxBytes * 0.2);

    const headBuf = Buffer.from(working, "utf-8").subarray(0, headBytes);
    const tailBuf = Buffer.from(working, "utf-8").subarray(byteLength - tailBytes);

    const headStr = safeSliceToString(headBuf);
    const tailStr = safeSliceToString(tailBuf);
    const elidedBytes = byteLength - headBytes - tailBytes;

    working = `${headStr}\n…[${elidedBytes} bytes elided]…\n${tailStr}`;
  }

  return boundOutput(working, options);
}

// Avoids splitting a multi-byte UTF-8 character at the boundary
function safeSliceToString(buf: Buffer): string {
  const str = buf.toString("utf-8");
  if (str.endsWith("\uFFFD")) {
    return str.slice(0, -1);
  }
  return str;
}
