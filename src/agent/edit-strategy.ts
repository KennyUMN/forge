export type EditStrategy = "structured_diff" | "whole_file";

export interface EditStrategyConfig {
  default: EditStrategy;
  perModel?: Record<string, EditStrategy>;
}

const DEFAULT_CONFIG: EditStrategyConfig = {
  default: "structured_diff",
};

export function editStrategyForModel(modelId: string, config?: EditStrategyConfig): EditStrategy {
  const resolved = config ?? DEFAULT_CONFIG;
  const override = resolved.perModel?.[modelId];
  if (override) return override;
  return resolved.default;
}

export function editStrategyPromptHint(strategy: EditStrategy): string {
  switch (strategy) {
    case "structured_diff":
      return "Prefer using edit_file with precise old_string/new_string replacements for targeted changes.";
    case "whole_file":
      return "Prefer using write_file to rewrite entire files when making changes, as you produce more reliable complete files than partial diffs.";
  }
}
