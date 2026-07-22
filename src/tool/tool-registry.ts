import type { Tool } from "./tool.js";

export interface ToolPluginModule {
  getTools(): Tool[] | Promise<Tool[]>;
}

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  registerTool(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`A tool named "${tool.name}" is already registered.`);
    }
    this.tools.set(tool.name, tool);
  }

  async loadPlugin(moduleSpecifier: string): Promise<void> {
    const mod = (await import(moduleSpecifier)) as Partial<ToolPluginModule>;
    if (typeof mod.getTools !== "function") {
      throw new Error(`Plugin module "${moduleSpecifier}" does not export a getTools() function.`);
    }
    const tools = await mod.getTools();
    for (const tool of tools) {
      this.registerTool(tool);
    }
  }

  getTool(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  getAll(): ReadonlyMap<string, Tool> {
    return this.tools;
  }
}
