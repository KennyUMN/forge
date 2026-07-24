import type { SessionEntry } from "../types/session.js";
import type { ToolResult } from "../types/tool-call.js";

export interface CompactionConfig {
  maxTokens?: number;
  keepRecentCount?: number;
  stubText?: string;
}

export interface CompactionResult {
  entries: readonly SessionEntry[];
  compacted: boolean;
  originalTokenEstimate: number;
  compactedTokenEstimate: number;
}

const DEFAULT_MAX_TOKENS = 150_000;
const DEFAULT_KEEP_RECENT = 10;
const DEFAULT_STUB = "[output compacted]";

function estimateTokens(entries: readonly SessionEntry[]): number {
  return entries.reduce((sum, e) => sum + Math.ceil(JSON.stringify(e.payload).length / 4), 0);
}

export function compactEntries(
  entries: readonly SessionEntry[],
  config?: CompactionConfig,
): CompactionResult {
  const maxTokens = config?.maxTokens ?? DEFAULT_MAX_TOKENS;
  const keepRecentCount = config?.keepRecentCount ?? DEFAULT_KEEP_RECENT;
  const stubText = config?.stubText ?? DEFAULT_STUB;

  const originalTokenEstimate = estimateTokens(entries);

  if (originalTokenEstimate <= maxTokens) {
    return { entries, compacted: false, originalTokenEstimate, compactedTokenEstimate: originalTokenEstimate };
  }

  const toolResultIndices: number[] = [];
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].type === "tool_result") {
      toolResultIndices.push(i);
    }
  }

  const cutoff = toolResultIndices.length - keepRecentCount;
  const indicesToStub = new Set(toolResultIndices.slice(0, Math.max(0, cutoff)));

  const compacted = entries.map((entry, i) => {
    if (!indicesToStub.has(i)) return entry;
    const payload = entry.payload as ToolResult;
    return { ...entry, payload: { ...payload, output: stubText } };
  });

  const compactedTokenEstimate = estimateTokens(compacted);

  return { entries: compacted, compacted: true, originalTokenEstimate, compactedTokenEstimate };
}
