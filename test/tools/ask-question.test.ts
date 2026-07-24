import { describe, it, expect } from "vitest";
import { askQuestionTool } from "../../src/tools/ask-question.js";
import type { AskQuestionPayload } from "../../src/tool/tool.js";

describe("askQuestionTool", () => {
  it("returns the user's selection when askQuestion callback is provided", async () => {
    const askQuestion = async () => "Option B";
    const result = await askQuestionTool.execute(
      { question: "Which framework?", options: ["Option A", "Option B", "Option C"] },
      { cwd: "/tmp", askQuestion },
    );

    expect(result.isError).toBe(false);
    expect(result.output).toBe("Option B");
  });

  it("returns an error in headless mode when no user is available (no callback)", async () => {
    const result = await askQuestionTool.execute(
      { question: "Which framework?", options: ["React", "Vue", "Svelte"] },
      { cwd: "/tmp" },
    );

    // No fabricated answer: the agent must decide for itself rather than being
    // handed the first option as though a human had chosen it.
    expect(result.isError).toBe(true);
    expect(result.output).toContain("No user was available");
  });

  it("returns an error when question is missing", async () => {
    const result = await askQuestionTool.execute(
      { options: ["A", "B"] },
      { cwd: "/tmp" },
    );

    expect(result.isError).toBe(true);
    expect(result.output).toContain("question");
  });

  it("returns an error when options is missing", async () => {
    const result = await askQuestionTool.execute(
      { question: "Pick one" },
      { cwd: "/tmp" },
    );

    expect(result.isError).toBe(true);
    expect(result.output).toContain("options");
  });

  it("returns an error when options has fewer than 2 items", async () => {
    const result = await askQuestionTool.execute(
      { question: "Pick one", options: ["Only one"] },
      { cwd: "/tmp" },
    );

    expect(result.isError).toBe(true);
  });

  it("passes question, options, and context to the callback", async () => {
    let received: AskQuestionPayload | undefined;
    const askQuestion = async (payload: AskQuestionPayload) => {
      received = payload;
      return "Yes";
    };

    await askQuestionTool.execute(
      { question: "Proceed?", options: ["Yes", "No"], context: "This will delete files" },
      { cwd: "/tmp", askQuestion },
    );

    expect(received).toEqual({
      question: "Proceed?",
      options: ["Yes", "No"],
      context: "This will delete files",
    });
  });

  it("has a valid schema with required fields", () => {
    const params = askQuestionTool.parameters as {
      type: string;
      properties: Record<string, unknown>;
      required: string[];
    };

    expect(params.type).toBe("object");
    expect(params.properties).toHaveProperty("question");
    expect(params.properties).toHaveProperty("options");
    expect(params.properties).toHaveProperty("context");
    expect(params.required).toContain("question");
    expect(params.required).toContain("options");
    expect(params.required).not.toContain("context");
  });
});
