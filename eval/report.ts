import type { EvalResult } from "./run-eval.js";

export function formatReport(results: EvalResult[]): string {
  const lines: string[] = [];

  lines.push("# Eval Results");
  lines.push("");
  lines.push("| Task | Status | Steps | Input Tokens | Output Tokens | Duration |");
  lines.push("|------|--------|-------|--------------|---------------|----------|");

  for (const r of results) {
    const status = r.passed ? "PASS" : "FAIL";
    lines.push(`| ${r.task} | ${status} | ${r.steps} | ${r.inputTokens} | ${r.outputTokens} | ${r.durationMs}ms |`);
  }

  lines.push("");
  lines.push(formatSummary(results));

  const failures = results.filter((r) => !r.passed && r.error);
  if (failures.length > 0) {
    lines.push("");
    lines.push("## Failures");
    lines.push("");
    for (const f of failures) {
      lines.push(`### ${f.task}`);
      lines.push("");
      lines.push("```");
      lines.push(f.error ?? "unknown error");
      lines.push("```");
      lines.push("");
    }
  }

  return lines.join("\n");
}

export function formatSummary(results: EvalResult[]): string {
  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  const totalTokens = results.reduce((sum, r) => sum + r.inputTokens + r.outputTokens, 0);
  const avgSteps = total > 0 ? (results.reduce((sum, r) => sum + r.steps, 0) / total).toFixed(1) : "0";

  return `${passed}/${total} passed, ${totalTokens} total tokens, avg ${avgSteps} steps`;
}
