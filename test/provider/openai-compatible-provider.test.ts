import { describe, it, expect } from "vitest";
import type OpenAI from "openai";
import { OpenAiCompatibleProvider } from "../../src/provider/openai-compatible-provider.js";

const BASE_OPTIONS = { apiKey: "test", model: "test-model", baseUrl: "http://fake.test/v1" };

// The provider consumes the raw chunk stream from create(), not the SDK's
// accumulating stream() helper, so the fake only has to be async-iterable.
function fakeOpenAiClient(chunks: unknown[], onParams?: (params: { messages: unknown }) => void): OpenAI {
  return {
    chat: {
      completions: {
        create: async (params: { messages: unknown }) => {
          onParams?.(params);
          return {
            [Symbol.asyncIterator]: async function* () {
              for (const chunk of chunks) yield chunk;
            },
          };
        },
      },
    },
  } as unknown as OpenAI;
}

async function collect(provider: OpenAiCompatibleProvider): Promise<unknown[]> {
  const events = [];
  for await (const event of provider.stream({ systemPrompt: "", messages: [], tools: [] })) {
    events.push(event);
  }
  return events;
}

describe("OpenAiCompatibleProvider", () => {
  it("streams text deltas and maps stop to completed", async () => {
    const client = fakeOpenAiClient([
      { choices: [{ delta: { content: "Hel" } }] },
      { choices: [{ delta: { content: "lo" } }] },
      { choices: [{ delta: {}, finish_reason: "stop" }] },
    ]);

    expect(await collect(new OpenAiCompatibleProvider(BASE_OPTIONS, client))).toEqual([
      { type: "text_delta", text: "Hel" },
      { type: "text_delta", text: "lo" },
      { type: "finish", reason: "completed", rawReason: "stop" },
    ]);
  });

  // OpenAI's own spec puts role: "assistant" in the first delta, and the SDK's
  // stream() helper throws "missing role for choice 0" without it. Several
  // compatible servers omit it entirely, so tolerating its absence is the
  // difference between working against them and not working at all.
  it("streams normally when no chunk ever carries a role, as some compatible servers do", async () => {
    const client = fakeOpenAiClient([
      { choices: [{ delta: { content: "hi" }, finish_reason: null }] },
      { choices: [{ delta: {}, finish_reason: "stop" }] },
    ]);

    expect(await collect(new OpenAiCompatibleProvider(BASE_OPTIONS, client))).toEqual([
      { type: "text_delta", text: "hi" },
      { type: "finish", reason: "completed", rawReason: "stop" },
    ]);
  });

  it("maps reasoning_content deltas to thinking events", async () => {
    const client = fakeOpenAiClient([
      { choices: [{ delta: { reasoning_content: "weighing options" } }] },
      { choices: [{ delta: { content: "answer" } }] },
      { choices: [{ delta: {}, finish_reason: "stop" }] },
    ]);

    expect(await collect(new OpenAiCompatibleProvider(BASE_OPTIONS, client))).toEqual([
      { type: "thinking_delta", text: "weighing options" },
      { type: "text_delta", text: "answer" },
      { type: "finish", reason: "completed", rawReason: "stop" },
    ]);
  });

  // Tool-call arguments arrive as a JSON string split across arbitrarily many
  // chunks; only the concatenation is parseable.
  it("reassembles tool-call arguments split across chunks", async () => {
    const client = fakeOpenAiClient([
      {
        choices: [
          { delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "read_file", arguments: '{"pa' } }] } },
        ],
      },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'th":"a.' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'ts"}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
    ]);

    expect(await collect(new OpenAiCompatibleProvider(BASE_OPTIONS, client))).toEqual([
      { type: "tool_call", id: "call_1", name: "read_file", input: { path: "a.ts" } },
      { type: "finish", reason: "tool_calls", rawReason: "tool_calls" },
    ]);
  });

  // Fragments for concurrent calls interleave, so only `index` says which call
  // a fragment belongs to -- accumulating by arrival order would splice the
  // two argument strings into each other.
  it("keeps interleaved fragments of two tool calls apart and emits them in index order", async () => {
    const client = fakeOpenAiClient([
      {
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 1, id: "call_b", function: { name: "glob", arguments: '{"pat' } },
                { index: 0, id: "call_a", function: { name: "grep", arguments: '{"patt' } },
              ],
            },
          },
        ],
      },
      {
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, function: { arguments: 'ern":"x"}' } },
                { index: 1, function: { arguments: 'tern":"*.ts"}' } },
              ],
            },
          },
        ],
      },
      { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
    ]);

    expect(await collect(new OpenAiCompatibleProvider(BASE_OPTIONS, client))).toEqual([
      { type: "tool_call", id: "call_a", name: "grep", input: { pattern: "x" } },
      { type: "tool_call", id: "call_b", name: "glob", input: { pattern: "*.ts" } },
      { type: "finish", reason: "tool_calls", rawReason: "tool_calls" },
    ]);
  });

  // A stream cut off mid-arguments leaves unparseable JSON. The call still has
  // to be emitted so the orchestrator's truncation defense can fail it, rather
  // than being dropped and leaving the model waiting on a result forever.
  it("emits a tool call with empty input when its arguments are truncated mid-JSON", async () => {
    const client = fakeOpenAiClient([
      { choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "bash", arguments: '{"comm' } }] } }] },
      { choices: [{ delta: {}, finish_reason: "length" }] },
    ]);

    expect(await collect(new OpenAiCompatibleProvider(BASE_OPTIONS, client))).toEqual([
      { type: "tool_call", id: "c1", name: "bash", input: {} },
      { type: "finish", reason: "truncated", rawReason: "length" },
    ]);
  });

  it("maps a finish_reason that never arrives to other", async () => {
    const client = fakeOpenAiClient([{ choices: [{ delta: { content: "x" } }] }]);

    expect(await collect(new OpenAiCompatibleProvider(BASE_OPTIONS, client))).toEqual([
      { type: "text_delta", text: "x" },
      { type: "finish", reason: "other", rawReason: "unknown" },
    ]);
  });

  it("withMaxTokens returns a new provider instance without mutating the original", () => {
    const provider = new OpenAiCompatibleProvider(BASE_OPTIONS, fakeOpenAiClient([]));
    const updated = provider.withMaxTokens(4096);

    expect(updated).not.toBe(provider);
    expect(updated.name).toBe("openai-compatible");
  });

  it("uses the configured name so a session can tell two endpoints apart", () => {
    const provider = new OpenAiCompatibleProvider({ ...BASE_OPTIONS, name: "9router" }, fakeOpenAiClient([]));

    expect(provider.name).toBe("9router");
    expect(provider.withMaxTokens(4096).name).toBe("9router");
  });

  it("explodes a coalesced tool-result message into one OpenAI tool message per result, prefixing errored results with 'Error: ' and injects the system prompt as the first message", async () => {
    let receivedMessages: unknown;
    const client = fakeOpenAiClient([{ choices: [{ delta: {}, finish_reason: "stop" }] }], (params) => {
      receivedMessages = params.messages;
    });

    const provider = new OpenAiCompatibleProvider(BASE_OPTIONS, client);

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
            { type: "tool_result" as const, toolCallId: "c2", output: "no such file", isError: true },
          ],
        },
      ],
      tools: [],
    };

    for await (const _ of provider.stream(context)) {
      // drain
    }

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
      { role: "tool", tool_call_id: "c2", content: "Error: no such file" },
    ]);
  });
});
