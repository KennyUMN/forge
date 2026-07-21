export type EntryType = "user_message" | "assistant_message" | "tool_call" | "tool_result";

export interface SessionEntry {
  id: string;
  parentId: string | null;
  type: EntryType;
  timestamp: string;
  payload: unknown;
}
