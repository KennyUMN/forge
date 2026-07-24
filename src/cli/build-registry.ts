import { resolve } from "node:path";
import { ToolRegistry } from "../tool/tool-registry.js";
import { loadMcpServerIntoRegistry } from "../mcp/mcp-client.js";
import type { McpServerConfig } from "../mcp/mcp-client.js";
import type { LoadedExtension } from "../extension/extension-loader.js";
import { readFileTool } from "../tools/read-file.js";
import { writeFileTool } from "../tools/write-file.js";
import { editFileTool } from "../tools/edit-file.js";
import { bashTool } from "../tools/bash.js";
import { grepTool } from "../tools/grep.js";
import { globTool } from "../tools/glob.js";
import { askQuestionTool } from "../tools/ask-question.js";
import { oracleTool } from "../tools/oracle.js";
import { spawnAgentTool } from "../tools/spawn-agent.js";
import { loadSkillTool } from "../tools/load-skill.js";
import { definitionTool, referencesTool, hoverTool, symbolsTool } from "../tools/lsp-tools.js";

const BUILTIN_TOOLS = [readFileTool, writeFileTool, editFileTool, bashTool, grepTool, globTool, askQuestionTool, oracleTool, spawnAgentTool, loadSkillTool, definitionTool, referencesTool, hoverTool, symbolsTool];

export interface RegistryHandle {
  registry: ToolRegistry;
  close(): Promise<void>;
}

// Builds one ToolRegistry containing every built-in tool, every configured MCP
// server's tools, and every discovered extension's tools and MCP servers.
// Returns a single close() that shuts down every MCP connection opened along
// the way.
export async function buildToolRegistry(
  mcpServers: McpServerConfig[],
  extensions?: LoadedExtension[],
): Promise<RegistryHandle> {
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

    for (const ext of extensions ?? []) {
      for (const toolPath of ext.manifest.tools ?? []) {
        await registry.loadPlugin(resolve(ext.dir, toolPath));
      }
      for (const [name, server] of Object.entries(ext.manifest.mcpServers ?? {})) {
        const config: McpServerConfig = { name: `${ext.manifest.name}__${name}`, command: server.command, args: server.args };
        const connection = await loadMcpServerIntoRegistry(registry, config);
        closers.push(connection.close);
      }
    }
  } catch (err) {
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
