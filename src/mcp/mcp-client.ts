import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Tool, ToolExecutionResult } from "../tool/tool.js";
import type { ToolRegistry } from "../tool/tool-registry.js";

export interface McpServerConfig {
  name: string;
  command: string;
  args?: string[];
}

export interface McpConnection {
  tools: Tool[];
  close(): Promise<void>;
}

function extractOutput(result: Awaited<ReturnType<Client["callTool"]>>): string {
  if ("content" in result && Array.isArray(result.content)) {
    const text = result.content
      .filter((block): block is { type: "text"; text: string } => block.type === "text")
      .map((block) => block.text)
      .join("\n");
    return text.length > 0 ? text : "(tool returned no text content)";
  }
  if ("toolResult" in result) {
    return JSON.stringify(result.toolResult);
  }
  return "(tool returned an unrecognized result shape)";
}

function toForgeTool(
  client: Client,
  mcpTool: { name: string; description?: string; inputSchema: Record<string, unknown> },
): Tool {
  return {
    name: mcpTool.name,
    description: mcpTool.description ?? "",
    parameters: mcpTool.inputSchema,
    async execute(input): Promise<ToolExecutionResult> {
      const result = await client.callTool({
        name: mcpTool.name,
        arguments: input as Record<string, unknown> | undefined,
      });
      const isError = "isError" in result && Boolean(result.isError);
      return { output: extractOutput(result), isError };
    },
  };
}

export async function connectMcpServer(config: McpServerConfig): Promise<McpConnection> {
  const transport = new StdioClientTransport({ command: config.command, args: config.args ?? [] });
  const client = new Client({ name: "forge", version: "0.1.0" }, { capabilities: {} });
  await client.connect(transport);

  const { tools: mcpTools } = await client.listTools();
  const tools = mcpTools.map((mcpTool) => toForgeTool(client, mcpTool));

  return {
    tools,
    close: () => client.close(),
  };
}

export async function loadMcpServerIntoRegistry(
  registry: ToolRegistry,
  config: McpServerConfig,
): Promise<{ close(): Promise<void> }> {
  const connection = await connectMcpServer(config);
  for (const tool of connection.tools) {
    registry.registerTool(tool);
  }
  return { close: connection.close };
}
