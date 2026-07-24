import type { Tool, ToolExecutionContext, ToolExecutionResult } from "../tool/tool.js";

interface OracleInput {
  question?: string;
  context?: string;
  options?: string[];
}

function buildOraclePrompt(input: OracleInput): string {
  let prompt = `You are an expert consultant. Provide a brief, decisive recommendation.\n\nQuestion: ${input.question}`;

  if (input.context) {
    prompt += `\n\nContext: ${input.context}`;
  }

  if (input.options && input.options.length > 0) {
    prompt += `\n\nOptions: ${input.options.join(", ")}`;
  }

  prompt += "\n\nProvide your recommendation in 2-3 paragraphs max.";
  return prompt;
}

export const oracleTool: Tool = {
  name: "oracle",
  description:
    "Consult a different AI model for a second opinion on a difficult decision, architecture choice, or code review. The oracle uses a different model than the main agent to avoid shared blind spots. Use sparingly — only for important decisions where a fresh perspective adds value.",
  parameters: {
    type: "object",
    properties: {
      question: {
        type: "string",
        description: "The question or decision to get a second opinion on",
      },
      context: {
        type: "string",
        description: "Relevant context (code snippets, constraints, what you've tried)",
      },
      options: {
        type: "array",
        items: { type: "string" },
        description: "Optional: specific options you're choosing between",
      },
    },
    required: ["question"],
  },
  execute: async (input: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult> => {
    const { question, context: questionContext, options } = input as OracleInput;

    if (!question || typeof question !== "string") {
      return { output: "Missing required field: question", isError: true };
    }

    if (!context.oracle) {
      return {
        output: "Oracle not configured — set oracleProvider in config",
        isError: true,
      };
    }

    const prompt = buildOraclePrompt({ question, context: questionContext, options });
    const response = await context.oracle(prompt);
    return { output: response, isError: false };
  },
};
