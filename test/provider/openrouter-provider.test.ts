import { describe, it, expect } from "vitest";
import type OpenAI from "openai";
import { OpenRouterProvider } from "../../src/provider/openrouter-provider.js";

function fakeOpenAiClient(chunks: unknown[], finalCompletion: unknown): OpenAI {
  return {
    chat: {
      completions: {
        stream: () => ({
          [Symbol.asyncIterator]: async function* () {
            for (const chunk of chunks) yield chunk;
          },
          finalChatCompletion: async () => finalCompletion,
        }),
      },
    },
  } as unknown as OpenAI;
}

describe("OpenRouterProvider", () => {
  it("streams text deltas and maps stop to completed", async () => {
    const client = fakeOpenAiClient(
      [{ choices: [{ delta: { content: "Hel" } }] }, { choices: [{ delta: { content: "lo" } }] }],
      { choices: [{ finish_reason: "stop", message: { tool_calls: [] } }] },
    );
    const provider = new OpenRouterProvider({ apiKey: "test", model: "test-model" }, client);

    const events = [];
    for await (const event of provider.stream({ systemPrompt: "", messages: [], tools: [] })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "text_delta", text: "Hel" },
      { type: "text_delta", text: "lo" },
      { type: "finish", reason: "completed", rawReason: "stop" },
    ]);
  });

  it("emits a tool_call event from the final completion's tool_calls, parsing the JSON arguments", async () => {
    const client = fakeOpenAiClient([], {
      choices: [
        {
          finish_reason: "tool_calls",
          message: {
            tool_calls: [
              { id: "call_1", type: "function", function: { name: "read_file", arguments: '{"path":"a.ts"}' } },
            ],
          },
        },
      ],
    });
    const provider = new OpenRouterProvider({ apiKey: "test", model: "test-model" }, client);

    const events = [];
    for await (const event of provider.stream({ systemPrompt: "", messages: [], tools: [] })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "tool_call", id: "call_1", name: "read_file", input: { path: "a.ts" } },
      { type: "finish", reason: "tool_calls", rawReason: "tool_calls" },
    ]);
  });

  it("maps length to truncated and a null finish_reason to other", async () => {
    const client = fakeOpenAiClient([], { choices: [{ finish_reason: "length", message: {} }] });
    const provider = new OpenRouterProvider({ apiKey: "test", model: "test-model" }, client);

    const events = [];
    for await (const event of provider.stream({ systemPrompt: "", messages: [], tools: [] })) {
      events.push(event);
    }

    expect(events).toEqual([{ type: "finish", reason: "truncated", rawReason: "length" }]);
  });

  it("withMaxTokens returns a new provider instance without mutating the original", () => {
    const client = fakeOpenAiClient([], { choices: [{ finish_reason: "stop", message: {} }] });
    const provider = new OpenRouterProvider({ apiKey: "test", model: "test-model" }, client);
    const updated = provider.withMaxTokens(4096);

    expect(updated).not.toBe(provider);
    expect(updated.name).toBe("openrouter");
  });

  it("explodes a coalesced tool-result message into one OpenAI tool message per result, and injects the system prompt as the first message", async () => {
    let receivedMessages: unknown;
    const client = {
      chat: {
        completions: {
          stream: (params: { messages: unknown }) => {
            receivedMessages = params.messages;
            return {
              [Symbol.asyncIterator]: async function* () {},
              finalChatCompletion: async () => ({ choices: [{ finish_reason: "stop", message: {} }] }),
            };
          },
        },
      },
    } as unknown as OpenAI;

    const provider = new OpenRouterProvider({ apiKey: "test", model: "test-model" }, client);

    const context = {
      systemPrompt: "You are Forge.",
      messages: [
        { role: "user" as const, content: [{ type: "text" as const, text: "do it" }] },
        {
          role: "assistant" as const,
          content: [
            { type: "text" as const, text: "sure" },
            { type: "tool_call" as const, id: "c1", name: "bash", input: { command: "ls" } },
            { type: "tool_call" as const, id: "c2", name: "bash", input: { command: "pwd" } },
          ],
        },
        {
          role: "tool" as const,
          content: [
            { type: "tool_result" as const, toolCallId: "c1", output: "a.ts", isError: false },
            { type: "tool_result" as const, toolCallId: "c2", output: "/repo", isError: false },
          ],
        },
      ],
      tools: [],
    };

    const events = [];
    for await (const event of provider.stream(context)) events.push(event);

    expect(receivedMessages).toEqual([
      { role: "system", content: "You are Forge." },
      { role: "user", content: "do it" },
      {
        role: "assistant",
        content: "sure",
        tool_calls: [
          { id: "c1", type: "function", function: { name: "bash", arguments: '{"command":"ls"}' } },
          { id: "c2", type: "function", function: { name: "bash", arguments: '{"command":"pwd"}' } },
        ],
      },
      { role: "tool", tool_call_id: "c1", content: "a.ts" },
      { role: "tool", tool_call_id: "c2", content: "/repo" },
    ]);
  });
});
