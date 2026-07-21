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

  it("maps a null stop_reason to other with a raw reason of unknown", async () => {
    const client = fakeAnthropicClient([], { stop_reason: null, content: [] });
    const provider = new AnthropicProvider({ apiKey: "test", model: "claude-test" }, client);

    const events = [];
    for await (const event of provider.stream({ systemPrompt: "", messages: [], tools: [] })) {
      events.push(event);
    }

    expect(events).toEqual([{ type: "finish", reason: "other", rawReason: "unknown" }]);
  });

  it("propagates an error thrown while iterating the underlying stream", async () => {
    const client = {
      messages: {
        stream: () => ({
          [Symbol.asyncIterator]: async function* () {
            throw new Error("stream failed");
          },
          finalMessage: async () => ({ stop_reason: "end_turn", content: [] }),
        }),
      },
    } as unknown as Anthropic;
    const provider = new AnthropicProvider({ apiKey: "test", model: "claude-test" }, client);

    await expect(async () => {
      for await (const _event of provider.stream({ systemPrompt: "", messages: [], tools: [] })) {
        // drain until the error surfaces
      }
    }).rejects.toThrow("stream failed");
  });

  it("does not include a thinking config in the request when thinkingEffort is unset", async () => {
    let capturedParams: unknown;
    const client = {
      messages: {
        stream: (params: unknown) => {
          capturedParams = params;
          return {
            [Symbol.asyncIterator]: async function* () {},
            finalMessage: async () => ({ stop_reason: "end_turn", content: [] }),
          };
        },
      },
    } as unknown as Anthropic;
    const provider = new AnthropicProvider({ apiKey: "test", model: "claude-test" }, client);

    const events = [];
    for await (const event of provider.stream({ systemPrompt: "", messages: [], tools: [] })) {
      events.push(event);
    }

    expect(capturedParams).not.toHaveProperty("thinking");
  });

  it("wires withThinking(effort) into an enabled thinking config on the outgoing request, with max_tokens auto-raised above the thinking budget", async () => {
    let capturedParams: unknown;
    const client = {
      messages: {
        stream: (params: unknown) => {
          capturedParams = params;
          return {
            [Symbol.asyncIterator]: async function* () {},
            finalMessage: async () => ({ stop_reason: "end_turn", content: [] }),
          };
        },
      },
    } as unknown as Anthropic;
    const base = new AnthropicProvider({ apiKey: "test", model: "claude-test" }, client);
    const provider = base.withThinking("high");

    const events = [];
    for await (const event of provider.stream({ systemPrompt: "", messages: [], tools: [] })) {
      events.push(event);
    }

    expect(capturedParams).toMatchObject({
      thinking: { type: "enabled", budget_tokens: expect.any(Number) },
    });
    const { thinking, max_tokens } = capturedParams as { thinking: { budget_tokens: number }; max_tokens: number };
    expect(max_tokens).toBeGreaterThan(thinking.budget_tokens);
  });

  it("throws a clear error when an explicit maxTokens does not exceed the configured thinking budget", async () => {
    const client = fakeAnthropicClient([], { stop_reason: "end_turn", content: [] });
    const provider = new AnthropicProvider({ apiKey: "test", model: "claude-test" }, client)
      .withThinking("high")
      .withMaxTokens(8192);

    await expect(async () => {
      for await (const _event of provider.stream({ systemPrompt: "", messages: [], tools: [] })) {
        // should throw before yielding anything
      }
    }).rejects.toThrow(/max_tokens.*must be greater than.*budget_tokens/);
  });

  it("surfaces thinking_delta stream events as thinking_delta StreamEvents", async () => {
    const client = fakeAnthropicClient(
      [{ type: "content_block_delta", delta: { type: "thinking_delta", thinking: "Considering..." } }],
      { stop_reason: "end_turn", content: [] },
    );
    const provider = new AnthropicProvider({ apiKey: "test", model: "claude-test" }, client);

    const events = [];
    for await (const event of provider.stream({ systemPrompt: "", messages: [], tools: [] })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "thinking_delta", text: "Considering..." },
      { type: "finish", reason: "completed", rawReason: "end_turn" },
    ]);
  });

  // PROVISIONAL: this exercises the full thinking-enabled request+response shape
  // against a fake client built to mirror Anthropic's documented wire format (request
  // `thinking: { type: "enabled", budget_tokens }`, streamed `thinking_delta` events,
  // and a `thinking` content block in the final message). The installed SDK predates
  // Extended Thinking, so this is not verified against the real SDK's types or a live
  // response -- see the PROVISIONAL comment in anthropic-provider.ts and Task 4 Step 7
  // in the Sprint 1 plan for the pending manual verification against the real API.
  it("exercises the full thinking-enabled request+response shape end-to-end", async () => {
    let capturedParams: unknown;
    const finalMessage = {
      stop_reason: "end_turn",
      content: [
        { type: "thinking", thinking: "Considering the request...", signature: "sig_abc123" },
        { type: "text", text: "Hi!" },
      ],
    };
    const client = {
      messages: {
        stream: (params: unknown) => {
          capturedParams = params;
          return {
            [Symbol.asyncIterator]: async function* () {
              yield { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "Considering the request..." } };
              yield { type: "content_block_delta", delta: { type: "text_delta", text: "Hi!" } };
            },
            finalMessage: async () => finalMessage,
          };
        },
      },
    } as unknown as Anthropic;

    const provider = new AnthropicProvider({ apiKey: "test", model: "claude-test" }, client).withThinking("high");

    const events = [];
    for await (const event of provider.stream({ systemPrompt: "", messages: [], tools: [] })) {
      events.push(event);
    }

    // The request carries the right budget_tokens for "high" and a max_tokens
    // comfortably above it.
    expect(capturedParams).toMatchObject({
      thinking: { type: "enabled", budget_tokens: 16_384 },
    });
    const { max_tokens } = capturedParams as { max_tokens: number };
    expect(max_tokens).toBeGreaterThan(16_384);

    // The streamed thinking_delta surfaces as its own event, and the finalMessage's
    // `thinking` content block (mirroring the real API's shape) is consumed without
    // being misrouted into the tool_call handling path.
    expect(events).toEqual([
      { type: "thinking_delta", text: "Considering the request..." },
      { type: "text_delta", text: "Hi!" },
      { type: "finish", reason: "completed", rawReason: "end_turn" },
    ]);
  });
});
