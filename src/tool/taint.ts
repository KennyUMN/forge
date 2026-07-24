const TAINTED_TOOLS = new Set(["bash", "read_file", "grep", "glob"]);

const NON_TAINTED_TOOLS = new Set(["write", "edit", "todo_write", "notebook_edit"]);

export function wrapUntrusted(content: string, source: string): string {
  return `\n<untrusted_content source="${source}">\n${content}\n</untrusted_content>\n`;
}

export function taintToolOutput(output: string, toolName: string, input: unknown): string {
  if (NON_TAINTED_TOOLS.has(toolName)) {
    return output;
  }

  const isMcp = toolName.startsWith("mcp__");
  const shouldTaint = TAINTED_TOOLS.has(toolName) || isMcp;

  if (!shouldTaint) {
    return output;
  }

  const source = buildSource(toolName, input, isMcp);
  return wrapUntrusted(output, source);
}

function buildSource(toolName: string, input: unknown, isMcp: boolean): string {
  if (isMcp) {
    const withoutPrefix = toolName.slice("mcp__".length);
    return `mcp:${withoutPrefix}`;
  }

  const params = (input ?? {}) as Record<string, unknown>;

  switch (toolName) {
    case "bash":
      return `bash:${String(params.command ?? "")}`;
    case "read_file":
      return `read_file:${String(params.file_path ?? "")}`;
    case "grep":
      return `grep:${String(params.pattern ?? "")}`;
    case "glob":
      return `glob:${String(params.pattern ?? "")}`;
    default:
      return toolName;
  }
}
