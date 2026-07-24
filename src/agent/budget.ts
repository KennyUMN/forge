import type { TokenUsage } from "../types/message.js";

export interface BudgetConfig {
  maxInputTokens?: number;
  maxOutputTokens?: number;
  maxTotalTokens?: number;
  maxBudgetUsd?: number;
  pricePerMillionInput?: number;
  pricePerMillionOutput?: number;
}

export interface BudgetState {
  inputTokensUsed: number;
  outputTokensUsed: number;
  totalTokensUsed: number;
  estimatedCostUsd: number;
}

export type BudgetVerdict =
  | { action: "continue" }
  | { action: "halt"; reason: string };

const DEFAULT_PRICE_PER_MILLION_INPUT = 5;
const DEFAULT_PRICE_PER_MILLION_OUTPUT = 5;

export function createBudgetTracker(config: BudgetConfig): {
  record(usage: TokenUsage): BudgetState;
  check(): BudgetVerdict;
  state(): BudgetState;
} {
  let inputTokensUsed = 0;
  let outputTokensUsed = 0;

  const priceInput = config.pricePerMillionInput ?? DEFAULT_PRICE_PER_MILLION_INPUT;
  const priceOutput = config.pricePerMillionOutput ?? DEFAULT_PRICE_PER_MILLION_OUTPUT;

  function snapshot(): BudgetState {
    return {
      inputTokensUsed,
      outputTokensUsed,
      totalTokensUsed: inputTokensUsed + outputTokensUsed,
      estimatedCostUsd:
        (inputTokensUsed * priceInput + outputTokensUsed * priceOutput) / 1_000_000,
    };
  }

  return {
    record(usage: TokenUsage): BudgetState {
      inputTokensUsed += usage.inputTokens;
      outputTokensUsed += usage.outputTokens;
      return snapshot();
    },

    check(): BudgetVerdict {
      const s = snapshot();

      if (config.maxInputTokens !== undefined && s.inputTokensUsed > config.maxInputTokens) {
        return { action: "halt", reason: `input token limit exceeded (${s.inputTokensUsed} > ${config.maxInputTokens})` };
      }
      if (config.maxOutputTokens !== undefined && s.outputTokensUsed > config.maxOutputTokens) {
        return { action: "halt", reason: `output token limit exceeded (${s.outputTokensUsed} > ${config.maxOutputTokens})` };
      }
      if (config.maxTotalTokens !== undefined && s.totalTokensUsed > config.maxTotalTokens) {
        return { action: "halt", reason: `total token limit exceeded (${s.totalTokensUsed} > ${config.maxTotalTokens})` };
      }
      if (config.maxBudgetUsd !== undefined && s.estimatedCostUsd > config.maxBudgetUsd) {
        return { action: "halt", reason: `budget exceeded ($${s.estimatedCostUsd.toFixed(4)} > $${config.maxBudgetUsd})` };
      }

      return { action: "continue" };
    },

    state(): BudgetState {
      return snapshot();
    },
  };
}
