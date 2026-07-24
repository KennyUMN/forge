export interface ModelCapabilities {
  contextWindow: number;
  maxOutput: number;
  supportsThinking: boolean;
  supportsTools: boolean;
  supportsVision: boolean;
  preferredEditFormat?: "structured_diff" | "whole_file";
  pricePerMillionInput: number;
  pricePerMillionOutput: number;
}

export interface CatalogEntry {
  id: string;
  provider: string;
  displayName: string;
  capabilities: ModelCapabilities;
}

const CATALOG: CatalogEntry[] = [
  {
    id: "claude-sonnet-4-20250514",
    provider: "anthropic",
    displayName: "Claude Sonnet 4",
    capabilities: {
      contextWindow: 200_000,
      maxOutput: 16_000,
      supportsThinking: true,
      supportsTools: true,
      supportsVision: true,
      preferredEditFormat: "structured_diff",
      pricePerMillionInput: 3,
      pricePerMillionOutput: 15,
    },
  },
  {
    id: "claude-opus-4-20250514",
    provider: "anthropic",
    displayName: "Claude Opus 4",
    capabilities: {
      contextWindow: 200_000,
      maxOutput: 32_000,
      supportsThinking: true,
      supportsTools: true,
      supportsVision: true,
      preferredEditFormat: "structured_diff",
      pricePerMillionInput: 15,
      pricePerMillionOutput: 75,
    },
  },
  {
    id: "claude-haiku-3-5-20241022",
    provider: "anthropic",
    displayName: "Claude Haiku 3.5",
    capabilities: {
      contextWindow: 200_000,
      maxOutput: 8_000,
      supportsThinking: false,
      supportsTools: true,
      supportsVision: true,
      preferredEditFormat: "whole_file",
      pricePerMillionInput: 0.8,
      pricePerMillionOutput: 4,
    },
  },
  {
    id: "gpt-4o",
    provider: "openai",
    displayName: "GPT-4o",
    capabilities: {
      contextWindow: 128_000,
      maxOutput: 16_000,
      supportsThinking: false,
      supportsTools: true,
      supportsVision: true,
      preferredEditFormat: "structured_diff",
      pricePerMillionInput: 2.5,
      pricePerMillionOutput: 10,
    },
  },
  {
    id: "gpt-4o-mini",
    provider: "openai",
    displayName: "GPT-4o Mini",
    capabilities: {
      contextWindow: 128_000,
      maxOutput: 16_000,
      supportsThinking: false,
      supportsTools: true,
      supportsVision: true,
      preferredEditFormat: "whole_file",
      pricePerMillionInput: 0.15,
      pricePerMillionOutput: 0.6,
    },
  },
  {
    id: "o3",
    provider: "openai",
    displayName: "o3",
    capabilities: {
      contextWindow: 200_000,
      maxOutput: 100_000,
      supportsThinking: true,
      supportsTools: true,
      supportsVision: true,
      preferredEditFormat: "structured_diff",
      pricePerMillionInput: 10,
      pricePerMillionOutput: 40,
    },
  },
  {
    id: "gemini-2.5-pro",
    provider: "google",
    displayName: "Gemini 2.5 Pro",
    capabilities: {
      contextWindow: 1_000_000,
      maxOutput: 65_000,
      supportsThinking: true,
      supportsTools: true,
      supportsVision: true,
      preferredEditFormat: "structured_diff",
      pricePerMillionInput: 1.25,
      pricePerMillionOutput: 10,
    },
  },
  {
    id: "gemini-2.5-flash",
    provider: "google",
    displayName: "Gemini 2.5 Flash",
    capabilities: {
      contextWindow: 1_000_000,
      maxOutput: 65_000,
      supportsThinking: true,
      supportsTools: true,
      supportsVision: true,
      preferredEditFormat: "whole_file",
      pricePerMillionInput: 0.15,
      pricePerMillionOutput: 0.6,
    },
  },
  {
    id: "meta-llama/llama-3.1-405b-instruct",
    provider: "openrouter",
    displayName: "Llama 3.1 405B Instruct",
    capabilities: {
      contextWindow: 128_000,
      maxOutput: 8_000,
      supportsThinking: false,
      supportsTools: true,
      supportsVision: false,
      preferredEditFormat: "whole_file",
      pricePerMillionInput: 2.7,
      pricePerMillionOutput: 2.7,
    },
  },
  {
    id: "deepseek/deepseek-chat",
    provider: "openrouter",
    displayName: "DeepSeek V3",
    capabilities: {
      contextWindow: 128_000,
      maxOutput: 8_000,
      supportsThinking: false,
      supportsTools: true,
      supportsVision: false,
      preferredEditFormat: "whole_file",
      pricePerMillionInput: 0.27,
      pricePerMillionOutput: 1.1,
    },
  },
  {
    id: "deepseek/deepseek-r1",
    provider: "openrouter",
    displayName: "DeepSeek R1",
    capabilities: {
      contextWindow: 128_000,
      maxOutput: 8_000,
      supportsThinking: true,
      supportsTools: true,
      supportsVision: false,
      preferredEditFormat: "structured_diff",
      pricePerMillionInput: 0.55,
      pricePerMillionOutput: 2.19,
    },
  },
];

const ALIASES: Record<string, string> = {
  "claude-sonnet-4": "claude-sonnet-4-20250514",
  "claude-sonnet-4-5": "claude-sonnet-4-20250514",
  "claude-opus-4": "claude-opus-4-20250514",
  "claude-haiku-3-5": "claude-haiku-3-5-20241022",
  "claude-haiku-3.5": "claude-haiku-3-5-20241022",
  "gpt-4o-mini": "gpt-4o-mini",
  "gemini-2.5-pro": "gemini-2.5-pro",
  "gemini-2.5-flash": "gemini-2.5-flash",
  "llama-3.1-405b": "meta-llama/llama-3.1-405b-instruct",
  "deepseek-v3": "deepseek/deepseek-chat",
  "deepseek-r1": "deepseek/deepseek-r1",
};

const byId = new Map<string, CatalogEntry>();
for (const entry of CATALOG) {
  byId.set(entry.id.toLowerCase(), entry);
}

export function lookupModel(modelId: string): CatalogEntry | undefined {
  const key = modelId.toLowerCase();
  const direct = byId.get(key);
  if (direct) return direct;
  const aliasTarget = ALIASES[key];
  if (aliasTarget) return byId.get(aliasTarget.toLowerCase());
  return undefined;
}

export function listModels(provider?: string): CatalogEntry[] {
  if (!provider) return [...CATALOG];
  const p = provider.toLowerCase();
  return CATALOG.filter((e) => e.provider === p);
}

export function estimateCost(modelId: string, inputTokens: number, outputTokens: number): number {
  const entry = lookupModel(modelId);
  if (!entry) return 0;
  const { pricePerMillionInput, pricePerMillionOutput } = entry.capabilities;
  return (inputTokens * pricePerMillionInput + outputTokens * pricePerMillionOutput) / 1_000_000;
}
