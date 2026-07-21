import { describe, it, expect } from "vitest";
import type { ModelProvider, StreamContext } from "../../src/provider/model-provider.js";
import type { StreamEvent } from "../../src/types/message.js";

class FakeProvider implements ModelProvider {
  readonly name = "fake";

  constructor(private readonly events: StreamEvent[]) {}

  async *stream(_context: StreamContext): AsyncIterable<StreamEvent> {
    for (const event of this.events) {
      yield event;
    }
  }

  withMaxTokens(_max: number): ModelProvider {
    return new FakeProvider(this.events);
  }
}

describe("ModelProvider contract", () => {
  it("a conforming provider streams events consumable by a for-await loop", async () => {
    const provider = new FakeProvider([
      { type: "text_delta", text: "Hello" },
      { type: "finish", reason: "completed", rawReason: "end_turn" },
    ]);

    const collected: StreamEvent[] = [];
    for await (const event of provider.stream({ systemPrompt: "", messages: [], tools: [] })) {
      collected.push(event);
    }

    expect(collected).toEqual([
      { type: "text_delta", text: "Hello" },
      { type: "finish", reason: "completed", rawReason: "end_turn" },
    ]);
  });

  it("withMaxTokens returns a new provider instance rather than mutating", () => {
    const provider = new FakeProvider([]);
    const updated = provider.withMaxTokens!(100);

    expect(updated).not.toBe(provider);
    expect(updated.name).toBe("fake");
  });
});
