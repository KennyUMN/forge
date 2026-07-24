import type { ModelProvider } from "../provider/model-provider.js";
import type { Message } from "../types/message.js";

export interface SamplingRequest {
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
}

export interface SamplingResponse {
  content: string;
  model: string;
  stopReason: string;
}

export type SamplingHandler = (request: SamplingRequest) => Promise<SamplingResponse>;

export function createSamplingHandler(provider: ModelProvider): SamplingHandler {
  return async (request: SamplingRequest): Promise<SamplingResponse> => {
    const messages: Message[] = request.messages.map((msg) => ({
      role: msg.role,
      content: [{ type: "text" as const, text: msg.content }],
    }));

    let activeProvider = provider;
    if (request.maxTokens && activeProvider.withMaxTokens) {
      activeProvider = activeProvider.withMaxTokens(request.maxTokens);
    }

    let content = "";
    let stopReason = "completed";

    const stream = activeProvider.stream({
      systemPrompt: request.systemPrompt ?? "",
      messages,
      tools: [],
    });

    for await (const event of stream) {
      if (event.type === "text_delta") {
        content += event.text;
      } else if (event.type === "finish") {
        stopReason = event.reason;
      }
    }

    return { content, model: provider.name, stopReason };
  };
}
