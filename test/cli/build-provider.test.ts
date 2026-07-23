import { describe, it, expect } from "vitest";
import { buildProvider } from "../../src/cli/build-provider.js";
import { AnthropicProvider } from "../../src/provider/anthropic-provider.js";
import { OpenRouterProvider } from "../../src/provider/openrouter-provider.js";

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
      expect(provider).toBeInstanceOf(OpenRouterProvider);
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
});
