import { ToolRegistry } from "../tool/tool-registry.js";
import { loadMcpServerIntoRegistry } from "../mcp/mcp-client.js";
import type { McpServerConfig } from "../mcp/mcp-client.js";
import { readFileTool } from "../tools/read-file.js";
import { writeFileTool } from "../tools/write-file.js";
import { editFileTool } from "../tools/edit-file.js";
import { bashTool } from "../tools/bash.js";
import { grepTool } from "../tools/grep.js";
import { globTool } from "../tools/glob.js";

const BUILTIN_TOOLS = [readFileTool, writeFileTool, editFileTool, bashTool, grepTool, globTool];

export interface RegistryHandle {
  registry: ToolRegistry;
  close(): Promise<void>;
}

// Builds one ToolRegistry containing every built-in tool plus every
// configured MCP server's tools (namespaced by loadMcpServerIntoRegistry to
// avoid name collisions). Returns a single close() that shuts down every MCP
// connection opened along the way.
export async function buildToolRegistry(mcpServers: McpServerConfig[]): Promise<RegistryHandle> {
  const registry = new ToolRegistry();
  for (const tool of BUILTIN_TOOLS) {
    registry.registerTool(tool);
  }

  const closers: Array<() => Promise<void>> = [];
  for (const config of mcpServers) {
    const connection = await loadMcpServerIntoRegistry(registry, config);
    closers.push(connection.close);
  }

  return {
    registry,
    close: async () => {
      for (const close of closers) {
        await close();
      }
    },
  };
}
