import { describe, it, expect } from "vitest";
import { createSamplingHandler } from "../../src/mcp/mcp-sampling.js";
import type { SamplingRequest } from "../../src/mcp/mcp-sampling.js";
import type { ModelProvider } from "../../src/provider/model-provider.js";
import type { StreamEvent } from "../../src/types/message.js";

function mockProvider(responseText: string, providerName = "mock-model"): ModelProvider {
  return {
    name: providerName,
    stream: async function* () {
      yield { type: "text_delta", text: responseText } as StreamEvent;
      yield { type: "finish", reason: "completed", rawReason: "end_turn" } as StreamEvent;
    },
    withMaxTokens(max: number) {
      return this;
    },
  };
}

describe("createSamplingHandler", () => {
  it("converts messages and returns provider response", async () => {
    const handler = createSamplingHandler(mockProvider("Hello from the model"));
    const request: SamplingRequest = {
      messages: [{ role: "user", content: "Say hello" }],
    };

    const response = await handler(request);

    expect(response.content).toBe("Hello from the model");
    expect(response.model).toBe("mock-model");
    expect(response.stopReason).toBe("completed");
  });

  it("passes system prompt to the provider", async () => {
    let receivedSystemPrompt = "";
    const provider: ModelProvider = {
      name: "test",
      stream(context) {
        receivedSystemPrompt = context.systemPrompt;
        return (async function* () {
          yield { type: "text_delta", text: "ok" } as StreamEvent;
          yield { type: "finish", reason: "completed", rawReason: "" } as StreamEvent;
        })();
      },
    };

    const handler = createSamplingHandler(provider);
    await handler({ messages: [{ role: "user", content: "hi" }], systemPrompt: "Be helpful" });

    expect(receivedSystemPrompt).toBe("Be helpful");
  });

  it("calls withMaxTokens when maxTokens is specified", async () => {
    let receivedMax: number | undefined;
    const provider: ModelProvider = {
      name: "test",
      stream: async function* () {
        yield { type: "text_delta", text: "ok" } as StreamEvent;
        yield { type: "finish", reason: "completed", rawReason: "" } as StreamEvent;
      },
      withMaxTokens(max: number) {
        receivedMax = max;
        return this;
      },
    };

    const handler = createSamplingHandler(provider);
    await handler({ messages: [{ role: "user", content: "hi" }], maxTokens: 500 });

    expect(receivedMax).toBe(500);
  });

  it("handles multi-turn messages", async () => {
    let receivedMessages: unknown[] = [];
    const provider: ModelProvider = {
      name: "test",
      stream(context) {
        receivedMessages = context.messages;
        return (async function* () {
          yield { type: "text_delta", text: "ok" } as StreamEvent;
          yield { type: "finish", reason: "completed", rawReason: "" } as StreamEvent;
        })();
      },
    };

    const handler = createSamplingHandler(provider);
    await handler({
      messages: [
        { role: "user", content: "What is 2+2?" },
        { role: "assistant", content: "4" },
        { role: "user", content: "And 3+3?" },
      ],
    });

    expect(receivedMessages).toHaveLength(3);
  });

  it("accumulates multiple text deltas", async () => {
    const provider: ModelProvider = {
      name: "test",
      stream: async function* () {
        yield { type: "text_delta", text: "Hello " } as StreamEvent;
        yield { type: "text_delta", text: "world" } as StreamEvent;
        yield { type: "finish", reason: "completed", rawReason: "" } as StreamEvent;
      },
    };

    const handler = createSamplingHandler(provider);
    const response = await handler({ messages: [{ role: "user", content: "hi" }] });

    expect(response.content).toBe("Hello world");
  });

  it("defaults systemPrompt to empty string", async () => {
    let receivedSystemPrompt = "NOT_SET";
    const provider: ModelProvider = {
      name: "test",
      stream(context) {
        receivedSystemPrompt = context.systemPrompt;
        return (async function* () {
          yield { type: "finish", reason: "completed", rawReason: "" } as StreamEvent;
        })();
      },
    };

    const handler = createSamplingHandler(provider);
    await handler({ messages: [{ role: "user", content: "hi" }] });

    expect(receivedSystemPrompt).toBe("");
  });
});
