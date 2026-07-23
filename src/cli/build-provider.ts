import { AnthropicProvider } from "../provider/anthropic-provider.js";
import { OpenRouterProvider } from "../provider/openrouter-provider.js";
import { requireEnv } from "./config.js";
import type { ModelProvider } from "../provider/model-provider.js";
import type { ProviderConfig } from "./config.js";

const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-5";

export function buildProvider(config: ProviderConfig): ModelProvider {
  if (config.type === "openrouter") {
    if (!config.model) {
      throw new Error('provider.model is required in forge.config.json when provider.type is "openrouter".');
    }
    const apiKey = requireEnv("OPENROUTER_API_KEY");
    return new OpenRouterProvider({ apiKey, model: config.model });
  }
  const apiKey = requireEnv("ANTHROPIC_API_KEY");
  return new AnthropicProvider({ apiKey, model: config.model ?? DEFAULT_ANTHROPIC_MODEL });
}
