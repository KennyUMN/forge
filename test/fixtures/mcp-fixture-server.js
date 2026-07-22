import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "forge-fixture-server", version: "0.1.0" });

server.registerTool(
  "fixture_echo",
  {
    description: "Echoes the given text back, prefixed with 'echo: '.",
    inputSchema: z.object({ text: z.string() }).strict(),
  },
  async ({ text }) => ({
    content: [{ type: "text", text: `echo: ${text}` }],
  }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
