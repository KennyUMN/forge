import { describe, it, expect } from "vitest";
import { editStrategyForModel, editStrategyPromptHint } from "../../src/agent/edit-strategy.js";
import type { EditStrategy, EditStrategyConfig } from "../../src/agent/edit-strategy.js";
import { lookupModel } from "../../src/provider/model-catalog.js";
import { scoreEditResult, EDIT_EVAL_CASES } from "../../eval/edit-eval.js";
import type { EditEvalCase } from "../../eval/edit-eval.js";

describe("editStrategyForModel", () => {
  it("returns structured_diff by default when no config is provided", () => {
    expect(editStrategyForModel("some-unknown-model")).toBe("structured_diff");
  });

  it("returns the config default when model has no per-model override", () => {
    const config: EditStrategyConfig = { default: "whole_file" };
    expect(editStrategyForModel("unknown-model", config)).toBe("whole_file");
  });

  it("returns per-model override when present", () => {
    const config: EditStrategyConfig = {
      default: "structured_diff",
      perModel: { "my-local-model": "whole_file" },
    };
    expect(editStrategyForModel("my-local-model", config)).toBe("whole_file");
  });

  it("falls back to default when model is not in perModel map", () => {
    const config: EditStrategyConfig = {
      default: "structured_diff",
      perModel: { "other-model": "whole_file" },
    };
    expect(editStrategyForModel("unlisted-model", config)).toBe("structured_diff");
  });
});

describe("editStrategyPromptHint", () => {
  it("returns structured_diff hint mentioning edit_file", () => {
    const hint = editStrategyPromptHint("structured_diff");
    expect(hint).toContain("edit_file");
    expect(hint).toContain("old_string/new_string");
  });

  it("returns whole_file hint mentioning write_file", () => {
    const hint = editStrategyPromptHint("whole_file");
    expect(hint).toContain("write_file");
    expect(hint).toContain("entire files");
  });

  it("returns distinct hints for each strategy", () => {
    const a = editStrategyPromptHint("structured_diff");
    const b = editStrategyPromptHint("whole_file");
    expect(a).not.toBe(b);
  });
});

describe("catalog integration", () => {
  it("strong models have structured_diff as preferredEditFormat", () => {
    const strongModels = ["claude-sonnet-4-20250514", "claude-opus-4-20250514", "gpt-4o", "o3", "gemini-2.5-pro"];
    for (const id of strongModels) {
      const entry = lookupModel(id);
      expect(entry, `expected ${id} in catalog`).toBeDefined();
      expect(entry!.capabilities.preferredEditFormat).toBe("structured_diff");
    }
  });

  it("weaker/local models have whole_file as preferredEditFormat", () => {
    const weakModels = ["claude-haiku-3-5-20241022", "gpt-4o-mini", "gemini-2.5-flash", "meta-llama/llama-3.1-405b-instruct", "deepseek/deepseek-chat"];
    for (const id of weakModels) {
      const entry = lookupModel(id);
      expect(entry, `expected ${id} in catalog`).toBeDefined();
      expect(entry!.capabilities.preferredEditFormat).toBe("whole_file");
    }
  });

  it("editStrategyForModel resolves catalog preferredEditFormat via config", () => {
    const entry = lookupModel("claude-haiku-3-5-20241022");
    expect(entry).toBeDefined();
    const config: EditStrategyConfig = {
      default: "structured_diff",
      perModel: { [entry!.id]: entry!.capabilities.preferredEditFormat! },
    };
    expect(editStrategyForModel(entry!.id, config)).toBe("whole_file");
  });
});

describe("scoreEditResult", () => {
  const simpleCase: EditEvalCase = {
    name: "test case",
    originalFile: "const x = 1;",
    instruction: "rename x to y",
    expectedContains: ["const y = 1"],
    expectedNotContains: ["const x"],
  };

  it("passes when all expectedContains present and expectedNotContains absent", () => {
    const result = scoreEditResult("const y = 1;", simpleCase);
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1);
  });

  it("fails when expectedContains is missing", () => {
    const result = scoreEditResult("const z = 1;", simpleCase);
    expect(result.passed).toBe(false);
    expect(result.score).toBeLessThan(1);
  });

  it("fails when expectedNotContains is present", () => {
    const result = scoreEditResult("const y = 1;\nconst x = 2;", simpleCase);
    expect(result.passed).toBe(false);
    expect(result.score).toBeLessThan(1);
  });

  it("computes partial score correctly", () => {
    const multiCase: EditEvalCase = {
      name: "multi",
      originalFile: "",
      instruction: "",
      expectedContains: ["alpha", "beta", "gamma"],
    };
    const result = scoreEditResult("alpha beta delta", multiCase);
    expect(result.passed).toBe(false);
    expect(result.score).toBeCloseTo(2 / 3);
  });

  it("returns score 1 for a case with no constraints", () => {
    const emptyCase: EditEvalCase = {
      name: "empty",
      originalFile: "",
      instruction: "",
      expectedContains: [],
    };
    const result = scoreEditResult("anything", emptyCase);
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1);
  });

  it("all built-in eval cases have valid structure", () => {
    expect(EDIT_EVAL_CASES.length).toBeGreaterThanOrEqual(5);
    for (const c of EDIT_EVAL_CASES) {
      expect(c.name).toBeTruthy();
      expect(c.originalFile).toBeTruthy();
      expect(c.instruction).toBeTruthy();
      expect(c.expectedContains.length).toBeGreaterThan(0);
    }
  });
});
