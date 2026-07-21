import { describe, it, expect } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { AnthropicProvider } from "../../src/provider/anthropic-provider.js";

function fakeAnthropicClient(
  events: unknown[],
  finalMessage: { stop_reason: string | null; content: unknown[] },
): Anthropic {
  return {
    messages: {
      stream: () => ({
        [Symbol.asyncIterator]: async function* () {
          for (const event of events) yield event;
        },
        finalMessage: async () => finalMessage,
      }),
    },
  } as unknown as Anthropic;
}

describe("AnthropicProvider", () => {
  it("streams text deltas and maps end_turn to completed", async () => {
    const client = fakeAnthropicClient(
      [
        { type: "content_block_delta", delta: { type: "text_delta", text: "Hel" } },
        { type: "content_block_delta", delta: { type: "text_delta", text: "lo" } },
      ],
      { stop_reason: "end_turn", content: [{ type: "text", text: "Hello" }] },
    );
    const provider = new AnthropicProvider({ apiKey: "test", model: "claude-test" }, client);

    const events = [];
    for await (const event of provider.stream({ systemPrompt: "", messages: [], tools: [] })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "text_delta", text: "Hel" },
      { type: "text_delta", text: "lo" },
      { type: "finish", reason: "completed", rawReason: "end_turn" },
    ]);
  });

  it("emits a tool_call event from the final message and maps tool_use to tool_calls", async () => {
    const client = fakeAnthropicClient([], {
      stop_reason: "tool_use",
      content: [{ type: "tool_use", id: "call_1", name: "read_file", input: { path: "a.ts" } }],
    });
    const provider = new AnthropicProvider({ apiKey: "test", model: "claude-test" }, client);

    const events = [];
    for await (const event of provider.stream({ systemPrompt: "", messages: [], tools: [] })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "tool_call", id: "call_1", name: "read_file", input: { path: "a.ts" } },
      { type: "finish", reason: "tool_calls", rawReason: "tool_use" },
    ]);
  });

  it("maps max_tokens to truncated and null stop_reason to other", async () => {
    const client = fakeAnthropicClient([], { stop_reason: "max_tokens", content: [] });
    const provider = new AnthropicProvider({ apiKey: "test", model: "claude-test" }, client);

    const events = [];
    for await (const event of provider.stream({ systemPrompt: "", messages: [], tools: [] })) {
      events.push(event);
    }

    expect(events).toEqual([{ type: "finish", reason: "truncated", rawReason: "max_tokens" }]);
  });

  it("withMaxTokens and withThinking return new provider instances, not mutations", () => {
    const client = fakeAnthropicClient([], { stop_reason: "end_turn", content: [] });
    const provider = new AnthropicProvider({ apiKey: "test", model: "claude-test" }, client);

    const withTokens = provider.withMaxTokens(8192);
    const withThinking = provider.withThinking("high");

    expect(withTokens).not.toBe(provider);
    expect(withThinking).not.toBe(provider);
    expect(withTokens.name).toBe("anthropic");
  });
});
