import { runTurn } from "../agent/turn-orchestrator.js";
import type { TurnOrchestratorOptions, TurnResult } from "../agent/turn-orchestrator.js";
import type { TurnEvent } from "../agent/turn-events.js";
import type { TokenUsage } from "../types/message.js";
import type { OutputFormat } from "./args.js";

export type { OutputFormat };

export interface ExecOptions {
  prompt: string;
  outputFormat: OutputFormat;
  systemPrompt: string;
  provider: TurnOrchestratorOptions["provider"];
  session: TurnOrchestratorOptions["session"];
  tools: TurnOrchestratorOptions["tools"];
  gate: TurnOrchestratorOptions["gate"];
  toolContext: TurnOrchestratorOptions["toolContext"];
  maxSteps?: number;
  budget?: TurnOrchestratorOptions["budget"];
}

function emitLine(obj: unknown): void {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function serializeEvent(event: TurnEvent): object | null {
  switch (event.type) {
    case "step_start":
      return { type: "step_start", step: event.step };
    case "text_delta":
      return { type: "text_delta", text: event.text };
    case "tool_call":
      return { type: "tool_call", name: event.call.name, input: event.call.input };
    case "tool_result":
      return { type: "tool_result", name: event.call.name, output: event.result.output, isError: event.result.isError };
    case "step_end":
      return { type: "step_end", step: event.step, finishReason: event.finishReason, usage: event.usage ?? null };
    default:
      return null;
  }
}

export async function runExec(options: ExecOptions): Promise<void> {
  const { outputFormat } = options;

  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  const onEvent = (event: TurnEvent): void => {
    if (event.type === "step_end" && event.usage) {
      totalInputTokens += event.usage.inputTokens;
      totalOutputTokens += event.usage.outputTokens;
    }

    switch (outputFormat) {
      case "text":
        if (event.type === "text_delta") process.stdout.write(event.text);
        break;
      case "stream-json": {
        const serialized = serializeEvent(event);
        if (serialized) emitLine(serialized);
        break;
      }
      case "json":
        break;
    }
  };

  const result: TurnResult = await runTurn(options.prompt, {
    provider: options.provider,
    session: options.session,
    tools: options.tools,
    gate: options.gate,
    systemPrompt: options.systemPrompt,
    toolContext: options.toolContext,
    maxSteps: options.maxSteps,
    budget: options.budget,
    onEvent,
  });

  const usage: TokenUsage = { inputTokens: totalInputTokens, outputTokens: totalOutputTokens };

  switch (outputFormat) {
    case "text":
      process.stdout.write("\n");
      break;
    case "json":
      emitLine({ result: result.finalText, steps: result.stepsExecuted, stoppedReason: result.stoppedReason, usage });
      break;
    case "stream-json":
      emitLine({ type: "result", text: result.finalText, steps: result.stepsExecuted, stoppedReason: result.stoppedReason });
      break;
  }

  if (result.stoppedReason === "max_steps_reached" || result.stoppedReason === "budget_exceeded") {
    process.exitCode = 1;
  }
}
