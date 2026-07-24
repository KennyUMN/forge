import type { Tool, ToolExecutionContext, ToolExecutionResult } from "../tool/tool.js";

interface AskQuestionInput {
  question?: string;
  options?: string[];
  context?: string;
}

export const askQuestionTool: Tool = {
  name: "ask_question",
  description:
    "Ask the user a clarifying question when requirements are ambiguous. Provide 2-4 options for the user to choose from. Use sparingly — only when genuinely blocked on a decision.",
  parameters: {
    type: "object",
    properties: {
      question: {
        type: "string",
        description: "The question to ask the user",
      },
      options: {
        type: "array",
        items: { type: "string" },
        description: "2-4 options for the user to choose from",
        minItems: 2,
        maxItems: 4,
      },
      context: {
        type: "string",
        description: "Brief context explaining why this question matters",
      },
    },
    required: ["question", "options"],
  },
  execute: async (input: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult> => {
    const { question, options, context: questionContext } = input as AskQuestionInput;

    if (!question || typeof question !== "string") {
      return { output: "Missing required field: question", isError: true };
    }
    if (!Array.isArray(options) || options.length < 2) {
      return { output: "Missing or invalid field: options (must be an array with at least 2 items)", isError: true };
    }

    if (!context.askQuestion) {
      // No interactive channel (headless exec, or a consumer that wires no
      // prompt). Returning the first option as if the user had chosen it makes
      // the agent proceed on a fabricated decision. Surface an error instead so
      // the model decides for itself and states its assumption.
      return {
        output: `No user was available to answer: "${question}". Proceed using your own judgement and state the assumption you are making; do not treat any option as chosen.`,
        isError: true,
      };
    }

    const answer = await context.askQuestion({ question, options, context: questionContext });
    return { output: answer, isError: false };
  },
};
