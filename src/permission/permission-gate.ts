import type { ToolCallRequest } from "../types/tool-call.js";
import type { PermissionPolicy } from "./permission-policies.js";

export interface PermissionResult {
  decision: "allow" | "deny";
  reason?: string;
}

export type AskFn = (call: ToolCallRequest) => Promise<boolean>;

export interface EvaluateOptions {
  forceAsk?: boolean;
}

export class PermissionGate {
  constructor(
    private readonly policies: PermissionPolicy[],
    private readonly ask: AskFn,
  ) {}

  async evaluate(call: ToolCallRequest, options: EvaluateOptions = {}): Promise<PermissionResult> {
    if (!options.forceAsk) {
      for (const policy of this.policies) {
        const result = policy.evaluate(call);
        if (result === "allow") return { decision: "allow" };
        if (result === "deny") return { decision: "deny", reason: `denied by policy "${policy.name}"` };
        if (result === "ask") return this.resolveAsk(call, `policy "${policy.name}" requires approval`);
      }
    }
    const reason = options.forceAsk
      ? "repeated identical tool call (doom-loop guard)"
      : "no policy matched (default: ask)";
    return this.resolveAsk(call, reason);
  }

  private async resolveAsk(call: ToolCallRequest, promptReason: string): Promise<PermissionResult> {
    const approved = await this.ask(call);
    return approved ? { decision: "allow" } : { decision: "deny", reason: `denied by user (${promptReason})` };
  }
}
