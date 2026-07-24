import { writeFile } from "node:fs/promises";
import type { SessionEntry } from "../types/session.js";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatTimestamp(ts: string): string {
  return ts.replace("T", " ").replace(/\.\d+Z$/, " UTC");
}

function renderEntry(entry: SessionEntry): string {
  const time = `<span class="ts">${escapeHtml(formatTimestamp(entry.timestamp))}</span>`;

  switch (entry.type) {
    case "user_message": {
      const payload = entry.payload as { text?: unknown };
      const text = typeof payload.text === "string" ? payload.text : JSON.stringify(payload);
      return `<div class="entry user">${time}<div class="body">${escapeHtml(text)}</div></div>`;
    }
    case "assistant_message": {
      const payload = entry.payload as { text?: unknown };
      const text = typeof payload.text === "string" ? payload.text : JSON.stringify(payload);
      return `<div class="entry assistant">${time}<div class="body">${escapeHtml(text)}</div></div>`;
    }
    case "tool_call": {
      const payload = entry.payload as { toolName?: unknown; input?: unknown };
      const name = typeof payload.toolName === "string" ? payload.toolName : "unknown";
      const input = JSON.stringify(payload.input, null, 2);
      return `<div class="entry tool">${time}<div class="tool-name">${escapeHtml(name)}</div><pre class="tool-input">${escapeHtml(input)}</pre></div>`;
    }
    case "tool_result": {
      const payload = entry.payload as { output?: unknown };
      const output = typeof payload.output === "string" ? payload.output : JSON.stringify(payload.output, null, 2);
      return `<div class="entry tool-result">${time}<pre class="tool-output">${escapeHtml(output)}</pre></div>`;
    }
    default:
      return "";
  }
}

const CSS = `
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 900px; margin: 0 auto; padding: 2rem; background: #fafafa; color: #1a1a1a; }
h1 { font-size: 1.2rem; border-bottom: 1px solid #ddd; padding-bottom: 0.5rem; }
.entry { margin: 1rem 0; padding: 0.75rem 1rem; border-radius: 6px; }
.ts { font-size: 0.75rem; color: #888; display: block; margin-bottom: 0.25rem; }
.user { background: #e3f2fd; border-left: 3px solid #1976d2; }
.assistant { background: #f3e5f5; border-left: 3px solid #7b1fa2; }
.tool { background: #fff8e1; border-left: 3px solid #f9a825; }
.tool-result { background: #f1f8e9; border-left: 3px solid #689f38; }
.body { white-space: pre-wrap; word-wrap: break-word; }
.tool-name { font-weight: 600; font-family: monospace; }
.tool-input, .tool-output { font-family: "SF Mono", "Fira Code", monospace; font-size: 0.8rem; background: #263238; color: #eeffff; padding: 0.5rem; border-radius: 4px; overflow-x: auto; white-space: pre-wrap; }
@media print { body { background: #fff; } .entry { break-inside: avoid; } }
`;

export async function exportSessionToHtml(
  entries: readonly SessionEntry[],
  outputPath: string,
): Promise<void> {
  const body = entries.map(renderEntry).join("\n");
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Forge Session Export</title>
<style>${CSS}</style>
</head>
<body>
<h1>Forge Session Export</h1>
${body}
</body>
</html>
`;
  await writeFile(outputPath, html, "utf8");
}
