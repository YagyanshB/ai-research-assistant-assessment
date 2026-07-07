#!/usr/bin/env node
// ─── NHS Research & Analytics Platform - MCP Server ─────────────────────────
// Model Context Protocol server exposing research tools with governance protocols.
//
// Transport: stdio (standard MCP transport for CLI/desktop clients)
// Usage:    npx tsx src/index.ts
//           node dist/index.js
//
// Tools Available:
//   Research Discovery:
//     - searchProjects:     Discover approved research projects
//     - searchDatasets:     Explore available datasets with classification
//     - getProjectDetails:  Get full details for a specific project
//     - submitQuery:        Submit natural language analytical queries
//     - getQueryStatus:     Check status of a submitted query
//
//   Data Exploration:
//     - previewDataset:     View sample rows from a dataset
//     - listColumns:        Get column definitions and metadata
//     - explainDataset:     Get comprehensive dataset documentation
//     - validateQuery:      Pre-validate a query before submission
//
//   Governance:
//     - getAuditTrail:      View governance audit log
//     - getRateLimit:       Check current rate limit status

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import type { UserSession } from "./types.js";
import { researchDatasets } from "./data.js";
import { registerAllTools } from "./tools/index.js";

// ─── Session Configuration ──────────────────────────────────────────────────
// In production, this would be injected from the authentication layer.

const currentSession: UserSession = {
  userId: process.env.MCP_USER_ID ?? "diana",
  username: process.env.MCP_USERNAME ?? "diana.fitzgerald@nhs-research.uk",
  displayName: process.env.MCP_DISPLAY_NAME ?? "Diana Fitzgerald",
  role: "Clinical Research Fellow",
  accessTier: "Tier 2",
  dailyQueryLimit: 50,
  queriesUsedToday: 0,
  sessionStart: new Date().toISOString(),
  projects: ["PRJ001", "PRJ006"],
};

// ─── MCP Server Setup ───────────────────────────────────────────────────────

const server = new McpServer({
  name: "nhs-research-assistant",
  version: "1.1.0",
});

// Register all tools (modular)
registerAllTools(server, () => currentSession);

// ─── Server Resources (Prompt Context) ──────────────────────────────────────

server.resource("governance-policy", "nhs://governance/policy", async () => ({
  contents: [
    {
      uri: "nhs://governance/policy",
      mimeType: "text/plain",
      text:
        "NHS Research Platform Governance Policy\n" +
        "========================================\n\n" +
        "1. All queries must be aggregate-level. Individual patient identification is prohibited.\n" +
        "2. Data classification levels: Official (Tier 1+), Official-Sensitive (Tier 2+).\n" +
        "3. Rate limits: 50 queries per user per day.\n" +
        "4. All interactions are logged in the audit trail.\n" +
        "5. Complex queries against sensitive data require governance officer approval.\n" +
        "6. Researchers may only access projects matching their access tier or below.\n" +
        "7. Prohibited query patterns: patient identification, direct identifiers (NHS Number, name, address, DoB, full postcode).\n" +
        "8. Data retention follows project-specific policies.\n" +
        "9. Synthetic data is clearly labelled and should be treated as representative, not real.\n" +
        "10. All research must have valid ethics approval (IRAS reference).\n\n" +
        "RECOMMENDED WORKFLOW:\n" +
        "1. Use 'searchDatasets' to find relevant datasets\n" +
        "2. Use 'explainDataset' to understand structure and constraints\n" +
        "3. Use 'listColumns' to see available fields\n" +
        "4. Use 'previewDataset' to see sample data\n" +
        "5. Use 'validateQuery' to check your query before submission\n" +
        "6. Use 'submitQuery' to execute the validated query",
    },
  ],
}));

server.resource("available-datasets-summary", "nhs://datasets/summary", async () => ({
  contents: [
    {
      uri: "nhs://datasets/summary",
      mimeType: "text/plain",
      text:
        "Available Research Datasets\n" +
        "===========================\n\n" +
        researchDatasets
          .map(
            d =>
              `[${d.datasetId}] ${d.name}\n` +
              `  Classification: ${d.classificationLevel}\n` +
              `  Records: ${d.recordCount.toLocaleString()}\n` +
              `  Category: ${d.dataCategory}\n` +
              `  Project: ${d.projectId}\n`,
          )
          .join("\n"),
    },
  ],
}));

// ─── Start Server ───────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("╔══════════════════════════════════════════════════════════╗");
  console.error("║  NHS Research Assistant MCP Server v1.1.0 (stdio)       ║");
  console.error("╠══════════════════════════════════════════════════════════╣");
  console.error(`║  User:  ${currentSession.displayName.padEnd(47)}║`);
  console.error(`║  Role:  ${currentSession.role.padEnd(47)}║`);
  console.error(`║  Tier:  ${currentSession.accessTier.padEnd(47)}║`);
  console.error("╠══════════════════════════════════════════════════════════╣");
  console.error("║  Tools: searchProjects, searchDatasets, submitQuery,    ║");
  console.error("║         getProjectDetails, getQueryStatus,              ║");
  console.error("║         previewDataset, listColumns, explainDataset,    ║");
  console.error("║         validateQuery, getAuditTrail, getRateLimit      ║");
  console.error("╚══════════════════════════════════════════════════════════╝");
}

main().catch(error => {
  console.error("Fatal error:", error);
  process.exit(1);
});
