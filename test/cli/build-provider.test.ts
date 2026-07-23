import { describe, it, expect } from "vitest";
import { buildProvider } from "../../src/cli/build-provider.js";
import { AnthropicProvider } from "../../src/provider/anthropic-provider.js";
import { OpenAiCompatibleProvider } from "../../src/provider/openai-compatible-provider.js";

describe("buildProvider", () => {
  it("builds an AnthropicProvider using ANTHROPIC_API_KEY and the default model when type is anthropic and model is omitted", () => {
    const original = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
    try {
      const provider = buildProvider({ type: "anthropic" });
      expect(provider).toBeInstanceOf(AnthropicProvider);
      expect(provider.name).toBe("anthropic");
    } finally {
      if (original === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = original;
    }
  });

  it("throws a clear error when type is anthropic and ANTHROPIC_API_KEY is not set", () => {
    const original = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      expect(() => buildProvider({ type: "anthropic" })).toThrow(/ANTHROPIC_API_KEY/);
    } finally {
      if (original !== undefined) process.env.ANTHROPIC_API_KEY = original;
    }
  });

  it("builds an OpenRouterProvider using OPENROUTER_API_KEY when type is openrouter and a model is given", () => {
    const original = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    try {
      const provider = buildProvider({ type: "openrouter", model: "anthropic/claude-3.5-sonnet" });
      expect(provider).toBeInstanceOf(OpenAiCompatibleProvider);
      expect(provider.name).toBe("openrouter");
    } finally {
      if (original === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = original;
    }
  });

  it("throws a clear error when type is openrouter and model is omitted", () => {
    expect(() => buildProvider({ type: "openrouter" })).toThrow(/provider\.model/);
  });

  it("throws a clear error when type is openrouter and OPENROUTER_API_KEY is not set", () => {
    const original = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    try {
      expect(() =>
        buildProvider({ type: "openrouter", model: "anthropic/claude-3.5-sonnet" }),
      ).toThrow(/OPENROUTER_API_KEY/);
    } finally {
      if (original !== undefined) process.env.OPENROUTER_API_KEY = original;
    }
  });

  it("builds an openai-compatible provider against a custom endpoint, reading the key from the configured env var", () => {
    const original = process.env.NINEROUTER_API_KEY;
    process.env.NINEROUTER_API_KEY = "sk-test";
    try {
      const provider = buildProvider({
        type: "openai-compatible",
        model: "some-model",
        baseUrl: "http://172.20.0.1:20128/v1",
        apiKeyEnv: "NINEROUTER_API_KEY",
        name: "9router",
      });
      expect(provider).toBeInstanceOf(OpenAiCompatibleProvider);
      expect(provider.name).toBe("9router");
    } finally {
      if (original === undefined) delete process.env.NINEROUTER_API_KEY;
      else process.env.NINEROUTER_API_KEY = original;
    }
  });

  // A local runtime authenticates nothing, so requiring an env var here would
  // force users to invent a dummy one just to talk to a model on localhost.
  it("builds an openai-compatible provider with no apiKeyEnv, for local runtimes that do not authenticate", () => {
    const provider = buildProvider({
      type: "openai-compatible",
      model: "qwen2.5-coder",
      baseUrl: "http://localhost:11434/v1",
      name: "ollama",
    });

    expect(provider).toBeInstanceOf(OpenAiCompatibleProvider);
    expect(provider.name).toBe("ollama");
  });

  it("throws a clear error when type is openai-compatible and baseUrl is omitted", () => {
    expect(() => buildProvider({ type: "openai-compatible", model: "some-model" })).toThrow(
      /provider\.baseUrl/,
    );
  });

  it("throws a clear error when type is openai-compatible and model is omitted", () => {
    expect(() =>
      buildProvider({ type: "openai-compatible", baseUrl: "http://localhost:11434/v1" }),
    ).toThrow(/provider\.model/);
  });

  it("throws a clear error when the configured apiKeyEnv is not set", () => {
    const original = process.env.MISSING_KEY_VAR;
    delete process.env.MISSING_KEY_VAR;
    try {
      expect(() =>
        buildProvider({
          type: "openai-compatible",
          model: "some-model",
          baseUrl: "http://example.test/v1",
          apiKeyEnv: "MISSING_KEY_VAR",
        }),
      ).toThrow(/MISSING_KEY_VAR/);
    } finally {
      if (original !== undefined) process.env.MISSING_KEY_VAR = original;
    }
  });
});
