import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { ModelProvider } from "../provider/model-provider.js";
import type { Tool, ToolExecutionResult } from "../tool/tool.js";
import { runTurn } from "../agent/turn-orchestrator.js";
import { SessionStore } from "../session/session-store.js";
import { PermissionGate } from "../permission/permission-gate.js";
import { DEFAULT_PERMISSION_POLICIES } from "../permission/permission-policies.js";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface ForgeMcpServerOptions {
  provider: ModelProvider;
  tools: ReadonlyMap<string, Tool>;
  cwd: string;
}

export async function startMcpServer(options: ForgeMcpServerOptions): Promise<void> {
  const { provider, tools, cwd } = options;

  const server = new McpServer({ name: "forge", version: "0.1.0" });

  server.registerTool(
    "forge_agent",
    {
      description: "Run a full agentic coding task. Provide a task description and Forge will execute it using its tools.",
      inputSchema: z.object({ task: z.string().describe("The task for the agent to complete") }).strict(),
    },
    async ({ task }) => {
      const sessionsDir = join(tmpdir(), "forge-mcp-sessions");
      const session = await SessionStore.create(sessionsDir);
      const gate = new PermissionGate(DEFAULT_PERMISSION_POLICIES, async () => true);

      const result = await runTurn(task, {
        provider,
        session,
        tools,
        gate,
        systemPrompt: "You are Forge, an agentic coding assistant.",
        toolContext: { cwd },
      });

      return { content: [{ type: "text", text: result.finalText || "(no output)" }] };
    },
  );

  for (const [name, tool] of tools) {
    server.registerTool(
      name,
      {
        description: tool.description,
        inputSchema: z.object({}).passthrough(),
      },
      async (input) => {
        let result: ToolExecutionResult;
        try {
          result = await tool.execute(input, { cwd });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { content: [{ type: "text", text: `Tool "${name}" failed: ${message}` }], isError: true };
        }
        return { content: [{ type: "text", text: result.output }], isError: result.isError };
      },
    );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
