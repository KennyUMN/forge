import { describe, it, expect } from "vitest";
import { oracleTool } from "../../src/tools/oracle.js";

describe("oracleTool", () => {
  it("returns the oracle response when callback is provided", async () => {
    const oracle = async () => "Use PostgreSQL for this use case.";
    const result = await oracleTool.execute(
      { question: "Which database should I use?" },
      { cwd: "/tmp", oracle },
    );

    expect(result.isError).toBe(false);
    expect(result.output).toBe("Use PostgreSQL for this use case.");
  });

  it("returns an error when no oracle callback is configured", async () => {
    const result = await oracleTool.execute(
      { question: "Which database?" },
      { cwd: "/tmp" },
    );

    expect(result.isError).toBe(true);
    expect(result.output).toContain("Oracle not configured");
  });

  it("formats the prompt with question, context, and options", async () => {
    let receivedPrompt = "";
    const oracle = async (prompt: string) => {
      receivedPrompt = prompt;
      return "Recommendation here.";
    };

    await oracleTool.execute(
      {
        question: "Monolith or microservices?",
        context: "Team of 3, early-stage startup",
        options: ["Monolith", "Microservices"],
      },
      { cwd: "/tmp", oracle },
    );

    expect(receivedPrompt).toContain("Monolith or microservices?");
    expect(receivedPrompt).toContain("Team of 3, early-stage startup");
    expect(receivedPrompt).toContain("Monolith");
    expect(receivedPrompt).toContain("Microservices");
    expect(receivedPrompt).toContain("expert consultant");
  });

  it("works with only a question (no context or options)", async () => {
    let receivedPrompt = "";
    const oracle = async (prompt: string) => {
      receivedPrompt = prompt;
      return "Yes, do it.";
    };

    const result = await oracleTool.execute(
      { question: "Should I refactor this module?" },
      { cwd: "/tmp", oracle },
    );

    expect(result.isError).toBe(false);
    expect(result.output).toBe("Yes, do it.");
    expect(receivedPrompt).toContain("Should I refactor this module?");
    expect(receivedPrompt).not.toContain("Context:");
    expect(receivedPrompt).not.toContain("Options:");
  });

  it("has a valid schema with required fields", () => {
    const params = oracleTool.parameters as {
      type: string;
      properties: Record<string, unknown>;
      required: string[];
    };

    expect(params.type).toBe("object");
    expect(params.properties).toHaveProperty("question");
    expect(params.properties).toHaveProperty("context");
    expect(params.properties).toHaveProperty("options");
    expect(params.required).toContain("question");
    expect(params.required).not.toContain("context");
    expect(params.required).not.toContain("options");
  });

  it("returns the oracle response verbatim", async () => {
    const verbatim = "Line 1\n\nLine 2 with **markdown** and `code`.";
    const oracle = async () => verbatim;
    const result = await oracleTool.execute(
      { question: "Review this approach" },
      { cwd: "/tmp", oracle },
    );

    expect(result.output).toBe(verbatim);
  });
});
