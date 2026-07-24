import { describe, it, expect } from "vitest";
import { createArchitectEditorProvider } from "../../src/agent/architect-editor.js";
import type { ArchitectEditorConfig } from "../../src/agent/architect-editor.js";
import type { ModelProvider, StreamContext } from "../../src/provider/model-provider.js";
import type { StreamEvent, ThinkingEffort } from "../../src/types/message.js";

class TrackingProvider implements ModelProvider {
  readonly name: string;
  readonly streamCalls: StreamContext[] = [];
  readonly thinkingEfforts: ThinkingEffort[] = [];
  readonly maxTokenValues: number[] = [];
  private callCount = 0;

  constructor(
    name: string,
    private readonly events: StreamEvent[],
  ) {
    this.name = name;
  }

  async *stream(context: StreamContext): AsyncIterable<StreamEvent> {
    this.streamCalls.push(context);
    this.callCount++;
    for (const event of this.events) yield event;
  }

  withThinking(effort: ThinkingEffort): TrackingProvider {
    this.thinkingEfforts.push(effort);
    return this;
  }

  withMaxTokens(max: number): TrackingProvider {
    this.maxTokenValues.push(max);
    return this;
  }

  get callCountValue(): number {
    return this.callCount;
  }
}

class ImmutableProvider implements ModelProvider {
  readonly name: string;
  readonly effort?: ThinkingEffort;
  readonly maxTokens?: number;

  constructor(name: string, effort?: ThinkingEffort, maxTokens?: number) {
    this.name = name;
    this.effort = effort;
    this.maxTokens = maxTokens;
  }

  async *stream(_context: StreamContext): AsyncIterable<StreamEvent> {
    yield { type: "text_delta", text: "ok" };
    yield { type: "finish", reason: "completed", rawReason: "end_turn" };
  }

  withThinking(effort: ThinkingEffort): ImmutableProvider {
    return new ImmutableProvider(this.name, effort, this.maxTokens);
  }

  withMaxTokens(max: number): ImmutableProvider {
    return new ImmutableProvider(this.name, this.effort, max);
  }
}

const emptyContext: StreamContext = { systemPrompt: "", messages: [], tools: [] };

const textEvents: StreamEvent[] = [
  { type: "text_delta", text: "response" },
  { type: "finish", reason: "completed", rawReason: "end_turn" },
];

describe("createArchitectEditorProvider", () => {
  it("uses architect provider for the first step", async () => {
    const architect = new TrackingProvider("architect", textEvents);
    const editor = new TrackingProvider("editor", textEvents);

    const composed = createArchitectEditorProvider({ architectProvider: architect, editorProvider: editor });

    for await (const _ of composed.stream(emptyContext)) { /* drain */ }

    expect(architect.streamCalls).toHaveLength(1);
    expect(editor.streamCalls).toHaveLength(0);
  });

  it("uses editor provider for subsequent steps", async () => {
    const architect = new TrackingProvider("architect", textEvents);
    const editor = new TrackingProvider("editor", textEvents);

    const composed = createArchitectEditorProvider({ architectProvider: architect, editorProvider: editor });

    for await (const _ of composed.stream(emptyContext)) { /* drain */ }
    for await (const _ of composed.stream(emptyContext)) { /* drain */ }
    for await (const _ of composed.stream(emptyContext)) { /* drain */ }

    expect(architect.streamCalls).toHaveLength(1);
    expect(editor.streamCalls).toHaveLength(2);
  });

  it("increments step counter on each stream() call", async () => {
    const architect = new TrackingProvider("architect", textEvents);
    const editor = new TrackingProvider("editor", textEvents);

    const composed = createArchitectEditorProvider({ architectProvider: architect, editorProvider: editor });

    for await (const _ of composed.stream(emptyContext)) { /* drain */ }
    expect(architect.streamCalls).toHaveLength(1);
    expect(editor.streamCalls).toHaveLength(0);

    for await (const _ of composed.stream(emptyContext)) { /* drain */ }
    expect(architect.streamCalls).toHaveLength(1);
    expect(editor.streamCalls).toHaveLength(1);

    for await (const _ of composed.stream(emptyContext)) { /* drain */ }
    expect(architect.streamCalls).toHaveLength(1);
    expect(editor.streamCalls).toHaveLength(2);
  });

  it("delegates withThinking to the active provider", async () => {
    const architect = new TrackingProvider("architect", textEvents);
    const editor = new TrackingProvider("editor", textEvents);

    const composed = createArchitectEditorProvider({ architectProvider: architect, editorProvider: editor });

    const withThinking = composed.withThinking!("high");

    for await (const _ of withThinking.stream(emptyContext)) { /* drain */ }

    expect(architect.thinkingEfforts).toEqual(["high"]);
    expect(editor.thinkingEfforts).toEqual([]);
  });

  it("delegates withThinking to editor after architect phase", async () => {
    const architect = new TrackingProvider("architect", textEvents);
    const editor = new TrackingProvider("editor", textEvents);

    const composed = createArchitectEditorProvider({ architectProvider: architect, editorProvider: editor });

    for await (const _ of composed.stream(emptyContext)) { /* drain */ }

    const withThinking = composed.withThinking!("low");
    for await (const _ of withThinking.stream(emptyContext)) { /* drain */ }

    expect(architect.thinkingEfforts).toEqual([]);
    expect(editor.thinkingEfforts).toEqual(["low"]);
  });

  it("delegates withMaxTokens to the active provider", async () => {
    const architect = new TrackingProvider("architect", textEvents);
    const editor = new TrackingProvider("editor", textEvents);

    const composed = createArchitectEditorProvider({ architectProvider: architect, editorProvider: editor });

    const withMax = composed.withMaxTokens!(4096);
    for await (const _ of withMax.stream(emptyContext)) { /* drain */ }

    expect(architect.maxTokenValues).toEqual([4096]);
    expect(editor.maxTokenValues).toEqual([]);
  });

  it("formats name as architect:editor", () => {
    const architect = new TrackingProvider("claude-opus", textEvents);
    const editor = new TrackingProvider("claude-haiku", textEvents);

    const composed = createArchitectEditorProvider({ architectProvider: architect, editorProvider: editor });

    expect(composed.name).toBe("claude-opus:claude-haiku");
  });

  it("supports architectSteps = 2 for two planning steps", async () => {
    const architect = new TrackingProvider("architect", textEvents);
    const editor = new TrackingProvider("editor", textEvents);

    const composed = createArchitectEditorProvider({
      architectProvider: architect,
      editorProvider: editor,
      architectSteps: 2,
    });

    for await (const _ of composed.stream(emptyContext)) { /* drain */ }
    for await (const _ of composed.stream(emptyContext)) { /* drain */ }
    for await (const _ of composed.stream(emptyContext)) { /* drain */ }
    for await (const _ of composed.stream(emptyContext)) { /* drain */ }

    expect(architect.streamCalls).toHaveLength(2);
    expect(editor.streamCalls).toHaveLength(2);
  });

  it("returns a new provider from withThinking (immutability)", () => {
    const architect = new ImmutableProvider("architect");
    const editor = new ImmutableProvider("editor");

    const composed = createArchitectEditorProvider({ architectProvider: architect, editorProvider: editor });
    const derived = composed.withThinking!("max");

    expect(derived).not.toBe(composed);
    expect(derived.name).toBe("architect:editor");
  });

  it("integration: routes correctly across a multi-step session", async () => {
    const architect = new TrackingProvider("strong-model", textEvents);
    const editor = new TrackingProvider("fast-model", textEvents);

    const composed = createArchitectEditorProvider({
      architectProvider: architect,
      editorProvider: editor,
      architectSteps: 1,
    });

    const totalSteps = 5;
    for (let i = 0; i < totalSteps; i++) {
      for await (const _ of composed.stream(emptyContext)) { /* drain */ }
    }

    expect(architect.streamCalls).toHaveLength(1);
    expect(editor.streamCalls).toHaveLength(4);
    expect(architect.callCountValue).toBe(1);
    expect(editor.callCountValue).toBe(4);
  });

  it("withThinking returns provider that preserves step state", async () => {
    const architect = new TrackingProvider("architect", textEvents);
    const editor = new TrackingProvider("editor", textEvents);

    const composed = createArchitectEditorProvider({ architectProvider: architect, editorProvider: editor });

    for await (const _ of composed.stream(emptyContext)) { /* drain */ }

    const derived = composed.withThinking!("high");
    for await (const _ of derived.stream(emptyContext)) { /* drain */ }
    for await (const _ of derived.stream(emptyContext)) { /* drain */ }

    expect(architect.streamCalls).toHaveLength(1);
    expect(editor.streamCalls).toHaveLength(2);
  });
});
