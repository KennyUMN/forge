import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { forgeHome } from "../cli/paths.js";
import type { McpServerConfig } from "./mcp-client.js";

export interface McpJsonConfig {
  mcpServers: Record<string, {
    command: string;
    args?: string[];
    env?: Record<string, string>;
  }>;
}

async function readMcpJson(path: string): Promise<McpJsonConfig | undefined> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
  try {
    return JSON.parse(raw) as McpJsonConfig;
  } catch {
    return undefined;
  }
}

function toServerConfigs(config: McpJsonConfig): McpServerConfig[] {
  return Object.entries(config.mcpServers ?? {}).map(([name, server]) => {
    const result: McpServerConfig = { name, command: server.command };
    if (server.args !== undefined) result.args = server.args;
    if (server.env !== undefined) result.env = server.env;
    return result;
  });
}

// Discovery order: global (~/.forge/mcp.json) first, then project
// (.forge/mcp.json). Later sources override earlier ones by server name,
// so a project can swap out a globally-configured server without restating
// every other server the user has set up.
export async function discoverMcpServers(cwd: string): Promise<McpServerConfig[]> {
  const globalPath = join(forgeHome(), "mcp.json");
  const projectPath = join(cwd, ".forge", "mcp.json");

  const globalConfig = await readMcpJson(globalPath);
  const projectConfig = await readMcpJson(projectPath);

  const merged = new Map<string, McpServerConfig>();
  for (const server of toServerConfigs(globalConfig ?? { mcpServers: {} })) {
    merged.set(server.name, server);
  }
  for (const server of toServerConfigs(projectConfig ?? { mcpServers: {} })) {
    merged.set(server.name, server);
  }

  return [...merged.values()];
}
