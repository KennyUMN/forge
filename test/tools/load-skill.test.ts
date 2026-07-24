import { describe, it, expect } from "vitest";
import { loadSkillTool } from "../../src/tools/load-skill.js";

describe("loadSkillTool", () => {
  it("returns the skill body when loadSkill callback is provided", async () => {
    const loadSkill = async () => "Step 1: do the thing\nStep 2: done.";
    const result = await loadSkillTool.execute(
      { name: "deploy" },
      { cwd: "/tmp", loadSkill },
    );

    expect(result.isError).toBe(false);
    expect(result.output).toBe("Step 1: do the thing\nStep 2: done.");
  });

  it("returns an error when loadSkill callback is not configured", async () => {
    const result = await loadSkillTool.execute(
      { name: "deploy" },
      { cwd: "/tmp" },
    );

    expect(result.isError).toBe(true);
    expect(result.output).toContain("not available");
  });

  it("returns an error when name is missing", async () => {
    const loadSkill = async () => "body";
    const result = await loadSkillTool.execute(
      {},
      { cwd: "/tmp", loadSkill },
    );

    expect(result.isError).toBe(true);
    expect(result.output).toContain("Missing required field: name");
  });

  it("propagates errors from the loadSkill callback as not-found", async () => {
    const loadSkill = async () => {
      throw new Error('no skill named "missing"');
    };
    const result = await loadSkillTool.execute(
      { name: "missing" },
      { cwd: "/tmp", loadSkill },
    );

    expect(result.isError).toBe(true);
    expect(result.output).toContain("Skill not found");
    expect(result.output).toContain('no skill named "missing"');
  });

  it("has a valid schema with required name field", () => {
    const params = loadSkillTool.parameters as {
      type: string;
      properties: Record<string, unknown>;
      required: string[];
    };

    expect(params.type).toBe("object");
    expect(params.properties).toHaveProperty("name");
    expect(params.required).toContain("name");
  });
});
