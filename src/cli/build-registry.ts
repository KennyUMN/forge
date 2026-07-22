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
  try {
    for (const config of mcpServers) {
      const connection = await loadMcpServerIntoRegistry(registry, config);
      closers.push(connection.close);
    }
  } catch (err) {
    // A later server's connection can still throw (e.g. a tool-name collision
    // with an earlier server's already-registered tools, or the server
    // process itself failing to start). Every earlier connection in
    // `closers` was already opened successfully, but this function never
    // returns on this path, so the caller has no handle to close them. Close
    // them all here (best-effort, so one close() failing doesn't stop the
    // rest from being attempted) before propagating the original error.
    await Promise.allSettled(closers.map((close) => close()));
    throw err;
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
