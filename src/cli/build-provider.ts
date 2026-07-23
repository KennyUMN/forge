import { AnthropicProvider } from "../provider/anthropic-provider.js";
import { OpenAiCompatibleProvider } from "../provider/openai-compatible-provider.js";
import { requireEnv } from "./config.js";
import type { ModelProvider } from "../provider/model-provider.js";
import type { ProviderConfig } from "./config.js";

const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-5";
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const OPENROUTER_API_KEY_ENV = "OPENROUTER_API_KEY";

// Local runtimes (Ollama, LM Studio, vLLM) accept any bearer token and ignore
// it, but the OpenAI SDK refuses to construct a client without a non-empty
// key. This sentinel keeps "no authentication" expressible in config as simply
// omitting apiKeyEnv, instead of forcing users to invent a dummy env var.
const PLACEHOLDER_API_KEY = "unused-by-this-endpoint";

export function buildProvider(config: ProviderConfig): ModelProvider {
  // OpenRouter is just a preset for the OpenAI-compatible provider: a fixed
  // base URL and key variable. Kept as its own config type because it is the
  // common case and should not require users to remember the endpoint.
  if (config.type === "openrouter") {
    if (!config.model) {
      throw new Error('provider.model is required in forge.config.json when provider.type is "openrouter".');
    }
    const apiKey = requireEnv(config.apiKeyEnv ?? OPENROUTER_API_KEY_ENV);
    return new OpenAiCompatibleProvider({
      apiKey,
      model: config.model,
      baseUrl: OPENROUTER_BASE_URL,
      name: config.name ?? "openrouter",
    });
  }

  if (config.type === "openai-compatible") {
    if (!config.baseUrl) {
      throw new Error(
        'provider.baseUrl is required in forge.config.json when provider.type is "openai-compatible".',
      );
    }
    if (!config.model) {
      throw new Error(
        'provider.model is required in forge.config.json when provider.type is "openai-compatible".',
      );
    }
    const apiKey = config.apiKeyEnv ? requireEnv(config.apiKeyEnv) : PLACEHOLDER_API_KEY;
    return new OpenAiCompatibleProvider({
      apiKey,
      model: config.model,
      baseUrl: config.baseUrl,
      name: config.name ?? "openai-compatible",
      caCertPath: config.caCertPath,
      insecureSkipTlsVerify: config.insecureSkipTlsVerify,
    });
  }

  const apiKey = requireEnv(config.apiKeyEnv ?? "ANTHROPIC_API_KEY");
  return new AnthropicProvider({ apiKey, model: config.model ?? DEFAULT_ANTHROPIC_MODEL });
}
