import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync } from "node:fs";

const server = new McpServer({ name: "forge", version: "0.1.0" });

server.registerTool(
  "forge_agent",
  {
    description: "Run a full agentic coding task. Provide a task description and Forge will execute it.",
    inputSchema: z.object({ task: z.string().describe("The task for the agent to complete") }).strict(),
  },
  async ({ task }) => {
    return { content: [{ type: "text", text: `Completed task: ${task}` }] };
  },
);

server.registerTool(
  "read_file",
  {
    description: "Read a file from disk",
    inputSchema: z.object({ file_path: z.string() }).passthrough(),
  },
  async ({ file_path }) => {
    try {
      const content = readFileSync(file_path, "utf8");
      return { content: [{ type: "text", text: content }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  },
);

server.registerTool("write_file", { description: "Write a file", inputSchema: z.object({}).passthrough() }, async () => {
  return { content: [{ type: "text", text: "ok" }] };
});

server.registerTool("bash", { description: "Run a shell command", inputSchema: z.object({}).passthrough() }, async () => {
  return { content: [{ type: "text", text: "ok" }] };
});

server.registerTool("grep", { description: "Search file contents", inputSchema: z.object({}).passthrough() }, async () => {
  return { content: [{ type: "text", text: "ok" }] };
});

server.registerTool("glob", { description: "Find files by pattern", inputSchema: z.object({}).passthrough() }, async () => {
  return { content: [{ type: "text", text: "ok" }] };
});

const transport = new StdioServerTransport();
await server.connect(transport);
