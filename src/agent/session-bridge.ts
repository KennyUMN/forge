import type { SessionEntry } from "../types/session.js";
import type { Message, MessageContent } from "../types/message.js";
import type { ToolCallRequest, ToolResult } from "../types/tool-call.js";

// Bridges the durable session log (a flat sequence of typed entries) into the
// Message[] shape a ModelProvider expects. Consecutive entries that belong to
// the same provider-facing turn are coalesced into one Message: an
// assistant-role message accumulates any assistant_message text followed by
// tool_call entries from the same step, and a tool-role message accumulates
// the tool_result entries that follow. This mirrors how providers like
// Anthropic expect tool_use/tool_result blocks grouped within one message per
// role, not as separate messages per entry.
export function sessionEntriesToMessages(entries: readonly SessionEntry[]): Message[] {
  return entries.reduce<Message[]>((messages, entry) => {
    if (entry.type === "user_message") {
      const payload = entry.payload as { text: string };
      return [...messages, { role: "user" as const, content: [{ type: "text" as const, text: payload.text }] }];
    }
    if (entry.type === "assistant_message") {
      const payload = entry.payload as { text: string };
      return mergeInto(messages, "assistant", { type: "text", text: payload.text });
    }
    if (entry.type === "tool_call") {
      const payload = entry.payload as ToolCallRequest;
      return mergeInto(messages, "assistant", {
        type: "tool_call",
        id: payload.id,
        name: payload.name,
        input: payload.input,
      });
    }
    const payload = entry.payload as ToolResult;
    return mergeInto(messages, "tool", {
      type: "tool_result",
      toolCallId: payload.toolCallId,
      output: payload.output,
      isError: payload.isError,
    });
  }, []);
}

function mergeInto(messages: Message[], role: Message["role"], content: MessageContent): Message[] {
  const last = messages[messages.length - 1];
  if (last && last.role === role) {
    return [...messages.slice(0, -1), { role, content: [...last.content, content] }];
  }
  return [...messages, { role, content: [content] }];
}
