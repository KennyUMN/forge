import { describe, it, expect } from "vitest";
import { executeStep } from "../../src/agent/step-executor.js";
import type { ModelProvider, StreamContext } from "../../src/provider/model-provider.js";
import type { StreamEvent } from "../../src/types/message.js";

class FakeProvider implements ModelProvider {
  readonly name = "fake";
  constructor(private readonly events: StreamEvent[]) {}
  async *stream(_context: StreamContext): AsyncIterable<StreamEvent> {
    for (const event of this.events) yield event;
  }
}

const emptyContext: StreamContext = { systemPrompt: "", messages: [], tools: [] };

describe("executeStep", () => {
  it("accumulates text_delta events into the final text", async () => {
    const provider = new FakeProvider([
      { type: "text_delta", text: "Hel" },
      { type: "text_delta", text: "lo" },
      { type: "finish", reason: "completed", rawReason: "end_turn" },
    ]);

    const result = await executeStep(provider, emptyContext);

    expect(result.text).toBe("Hello");
    expect(result.toolCalls).toEqual([]);
    expect(result.finishReason).toBe("completed");
  });

  it("collects tool_call events into toolCalls", async () => {
    const provider = new FakeProvider([
      { type: "tool_call", id: "1", name: "read_file", input: { path: "a.ts" } },
      { type: "tool_call", id: "2", name: "bash", input: { command: "ls" } },
      { type: "finish", reason: "tool_calls", rawReason: "tool_use" },
    ]);

    const result = await executeStep(provider, emptyContext);

    expect(result.toolCalls).toEqual([
      { id: "1", name: "read_file", input: { path: "a.ts" } },
      { id: "2", name: "bash", input: { command: "ls" } },
    ]);
    expect(result.finishReason).toBe("tool_calls");
  });

  it("ignores thinking_delta events", async () => {
    const provider = new FakeProvider([
      { type: "thinking_delta", text: "reasoning..." },
      { type: "text_delta", text: "answer" },
      { type: "finish", reason: "completed", rawReason: "end_turn" },
    ]);

    const result = await executeStep(provider, emptyContext);

    expect(result.text).toBe("answer");
  });

  it("defaults finishReason to 'other' if the stream never yields a finish event", async () => {
    const provider = new FakeProvider([{ type: "text_delta", text: "partial" }]);

    const result = await executeStep(provider, emptyContext);

    expect(result.finishReason).toBe("other");
  });
});
