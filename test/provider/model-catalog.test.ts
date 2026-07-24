import { describe, it, expect } from "vitest";
import { lookupModel, listModels, estimateCost } from "../../src/provider/model-catalog.js";

describe("model-catalog", () => {
  describe("lookupModel", () => {
    it("finds a known model by exact id", () => {
      const entry = lookupModel("claude-sonnet-4-20250514");
      expect(entry).toBeDefined();
      expect(entry!.provider).toBe("anthropic");
      expect(entry!.capabilities.contextWindow).toBe(200_000);
    });

    it("finds models by short alias", () => {
      const entry = lookupModel("claude-sonnet-4");
      expect(entry).toBeDefined();
      expect(entry!.id).toBe("claude-sonnet-4-20250514");
    });

    it("returns undefined for an unknown model", () => {
      expect(lookupModel("totally-unknown-model-xyz")).toBeUndefined();
    });

    it("is case-insensitive", () => {
      const entry = lookupModel("GPT-4o");
      expect(entry).toBeDefined();
      expect(entry!.provider).toBe("openai");
    });
  });

  describe("listModels", () => {
    it("returns all models when no provider filter is given", () => {
      const all = listModels();
      expect(all.length).toBeGreaterThanOrEqual(7);
    });

    it("filters by provider", () => {
      const anthropic = listModels("anthropic");
      expect(anthropic.length).toBeGreaterThanOrEqual(3);
      for (const entry of anthropic) {
        expect(entry.provider).toBe("anthropic");
      }
    });

    it("returns empty array for unknown provider", () => {
      expect(listModels("nonexistent-provider")).toEqual([]);
    });
  });

  describe("estimateCost", () => {
    it("calculates cost for a known model", () => {
      const cost = estimateCost("claude-sonnet-4-20250514", 1_000_000, 1_000_000);
      expect(cost).toBeCloseTo(3 + 15, 5);
    });

    it("calculates cost with fractional tokens", () => {
      const cost = estimateCost("gpt-4o", 500_000, 200_000);
      expect(cost).toBeCloseTo(2.5 * 0.5 + 10 * 0.2, 5);
    });

    it("returns 0 for unknown model", () => {
      expect(estimateCost("unknown-model", 1000, 1000)).toBe(0);
    });
  });

  describe("catalog data integrity", () => {
    it("all entries have positive context window and max output", () => {
      for (const entry of listModels()) {
        expect(entry.capabilities.contextWindow).toBeGreaterThan(0);
        expect(entry.capabilities.maxOutput).toBeGreaterThan(0);
      }
    });

    it("all entries have non-negative pricing", () => {
      for (const entry of listModels()) {
        expect(entry.capabilities.pricePerMillionInput).toBeGreaterThanOrEqual(0);
        expect(entry.capabilities.pricePerMillionOutput).toBeGreaterThanOrEqual(0);
      }
    });

    it("all entries have non-empty id, provider, and displayName", () => {
      for (const entry of listModels()) {
        expect(entry.id.length).toBeGreaterThan(0);
        expect(entry.provider.length).toBeGreaterThan(0);
        expect(entry.displayName.length).toBeGreaterThan(0);
      }
    });

    it("maxOutput does not exceed contextWindow", () => {
      for (const entry of listModels()) {
        expect(entry.capabilities.maxOutput).toBeLessThanOrEqual(entry.capabilities.contextWindow);
      }
    });
  });

  describe("build-provider integration", () => {
    it("known model resolves capabilities for budget pricing", () => {
      const entry = lookupModel("claude-sonnet-4-20250514");
      expect(entry).toBeDefined();
      expect(entry!.capabilities.pricePerMillionInput).toBe(3);
      expect(entry!.capabilities.pricePerMillionOutput).toBe(15);
      expect(entry!.capabilities.supportsThinking).toBe(true);
      expect(entry!.capabilities.supportsTools).toBe(true);
      expect(entry!.capabilities.supportsVision).toBe(true);
    });

    it("haiku does not support thinking", () => {
      const entry = lookupModel("claude-haiku-3-5");
      expect(entry).toBeDefined();
      expect(entry!.capabilities.supportsThinking).toBe(false);
      expect(entry!.capabilities.supportsTools).toBe(true);
    });
  });
});
