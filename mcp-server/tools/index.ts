// ─── NHS Research Platform - Tool Registry ──────────────────────────────────
// Central registry that registers all MCP tools on a server instance.
// Each tool group is in its own module for testability and maintainability.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { UserSession } from "../types.js";

import { registerResearchTools } from "./research.js";
import { registerDataExplorationTools } from "./data-exploration.js";
import { registerGovernanceTools } from "./governance.js";

/**
 * Register all MCP tools on the given server instance.
 * @param server - The MCP server to register tools on
 * @param getSession - Function that returns the current user session
 */
export function registerAllTools(server: McpServer, getSession: () => UserSession): void {
  // Research discovery & query tools
  registerResearchTools(server, getSession);

  // Data exploration tools (new)
  registerDataExplorationTools(server, getSession);

  // Governance & audit tools
  registerGovernanceTools(server, getSession);
}

export { registerResearchTools } from "./research.js";
export { registerDataExplorationTools } from "./data-exploration.js";
export { registerGovernanceTools } from "./governance.js";
