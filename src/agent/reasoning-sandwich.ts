import type { ThinkingEffort } from "../types/message.js";

export type ReasoningLevel = "low" | "medium" | "high";

export interface ReasoningSandwichConfig {
  default: ReasoningLevel;
  planSteps: ReasoningLevel;
  verifySteps: ReasoningLevel;
}

export const DEFAULT_SANDWICH: ReasoningSandwichConfig = {
  default: "medium",
  planSteps: "high",
  verifySteps: "high",
};

// ThinkingEffort has no "medium"; the provider's budgets are low=4k, high=16k,
// max=32k. Map the sandwich's three-tier dial onto those concrete budgets.
const EFFORT_MAP: Record<ReasoningLevel, ThinkingEffort> = {
  low: "low",
  medium: "high",
  high: "max",
};

export function reasoningToEffort(level: ReasoningLevel): ThinkingEffort {
  return EFFORT_MAP[level];
}

export function reasoningForStep(
  step: number,
  _totalSteps: number,
  isVerification: boolean,
  config: ReasoningSandwichConfig,
): ReasoningLevel {
  if (isVerification) return config.verifySteps;
  if (step === 1) return config.planSteps;
  return config.default;
}
