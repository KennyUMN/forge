import type { Tool } from "../../tool/tool.js";
import { repoMapTool } from "./repo-map-tool.js";

export function getTools(): Tool[] {
  return [repoMapTool];
}
