import type { ModelProvider, StreamContext } from "../provider/model-provider.js";
import type { StreamEvent, ThinkingEffort } from "../types/message.js";

export interface ArchitectEditorConfig {
  architectProvider: ModelProvider;
  editorProvider: ModelProvider;
  architectSteps?: number;
}

export function createArchitectEditorProvider(config: ArchitectEditorConfig): ModelProvider {
  const { architectProvider, editorProvider } = config;
  const architectSteps = config.architectSteps ?? 1;
  const counter = { count: 0 };
  return new ArchitectEditorProvider(architectProvider, editorProvider, architectSteps, counter);
}

class ArchitectEditorProvider implements ModelProvider {
  constructor(
    private readonly architect: ModelProvider,
    private readonly editor: ModelProvider,
    private readonly architectSteps: number,
    private readonly counter: { count: number },
  ) {}

  get name(): string {
    return `${this.architect.name}:${this.editor.name}`;
  }

  private get active(): ModelProvider {
    return this.counter.count < this.architectSteps ? this.architect : this.editor;
  }

  async *stream(context: StreamContext): AsyncIterable<StreamEvent> {
    const provider = this.active;
    this.counter.count++;
    yield* provider.stream(context);
  }

  withThinking(effort: ThinkingEffort): ModelProvider {
    if (this.counter.count < this.architectSteps) {
      const architect = this.architect.withThinking
        ? this.architect.withThinking(effort)
        : this.architect;
      return new ArchitectEditorProvider(architect, this.editor, this.architectSteps, this.counter);
    }
    const editor = this.editor.withThinking
      ? this.editor.withThinking(effort)
      : this.editor;
    return new ArchitectEditorProvider(this.architect, editor, this.architectSteps, this.counter);
  }

  withMaxTokens(max: number): ModelProvider {
    if (this.counter.count < this.architectSteps) {
      const architect = this.architect.withMaxTokens
        ? this.architect.withMaxTokens(max)
        : this.architect;
      return new ArchitectEditorProvider(architect, this.editor, this.architectSteps, this.counter);
    }
    const editor = this.editor.withMaxTokens
      ? this.editor.withMaxTokens(max)
      : this.editor;
    return new ArchitectEditorProvider(this.architect, editor, this.architectSteps, this.counter);
  }
}
