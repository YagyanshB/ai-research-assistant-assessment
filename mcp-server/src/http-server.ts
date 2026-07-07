#!/usr/bin/env node
// ─── NHS Research & Analytics Platform - MCP Server (HTTP/SSE Transport) ────
// Alternative transport for web-based clients or testing via HTTP.
//
// Usage:    npx tsx src/http-server.ts
// Endpoint: http://localhost:3001/mcp (SSE)
//           http://localhost:3001/messages (POST)
//           http://localhost:3001/health (GET)

import express from "express";
import cors from "cors";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";

import type { UserSession } from "./types.js";
import { researchDatasets } from "./data.js";
import { getRateLimitStatus } from "./governance.js";
import { registerAllTools } from "./tools/index.js";

// ─── Configuration ──────────────────────────────────────────────────────────

const PORT = parseInt(process.env.MCP_PORT ?? "3001", 10);
const HOST = process.env.MCP_HOST ?? "0.0.0.0";

// ─── Session Configuration ──────────────────────────────────────────────────

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

// ─── Express App ────────────────────────────────────────────────────────────

const app = express();
app.use(cors());
app.use(express.json());

// Health check
app.get("/health", (_req, res) => {
  res.json({
    status: "healthy",
    server: "nhs-research-mcp",
    version: "1.1.0",
    session: {
      user: currentSession.displayName,
      role: currentSession.role,
      tier: currentSession.accessTier,
    },
    rateLimit: getRateLimitStatus(currentSession),
    tools: [
      "searchProjects",
      "searchDatasets",
      "getProjectDetails",
      "submitQuery",
      "getQueryStatus",
      "previewDataset",
      "listColumns",
      "explainDataset",
      "validateQuery",
      "getAuditTrail",
      "getRateLimit",
    ],
  });
});

// ─── MCP Server Factory ─────────────────────────────────────────────────────

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "nhs-research-assistant",
    version: "1.1.0",
  });

  // Register all tools using the modular system
  registerAllTools(server, () => currentSession);

  // Resources
  server.resource("governance-policy", "nhs://governance/policy", async () => ({
    contents: [
      {
        uri: "nhs://governance/policy",
        mimeType: "text/plain",
        text: "NHS Research Platform Governance Policy: All queries must be aggregate-level. Individual identification prohibited. Classification: Official (Tier 1+), Official-Sensitive (Tier 2+). Rate limit: 50/day. Recommended workflow: searchDatasets → explainDataset → listColumns → previewDataset → validateQuery → submitQuery.",
      },
    ],
  }));

  server.resource("available-datasets-summary", "nhs://datasets/summary", async () => ({
    contents: [
      {
        uri: "nhs://datasets/summary",
        mimeType: "text/plain",
        text: researchDatasets
          .map(
            d =>
              `[${d.datasetId}] ${d.name} | ${d.classificationLevel} | ${d.recordCount.toLocaleString()} records | ${d.dataCategory}`,
          )
          .join("\n"),
      },
    ],
  }));

  return server;
}

// ─── SSE Transport Setup ────────────────────────────────────────────────────

const transports = new Map<string, SSEServerTransport>();

app.get("/mcp", async (req, res) => {
  console.log(`[${new Date().toISOString()}] SSE connection from ${req.ip}`);

  const transport = new SSEServerTransport("/messages", res);
  const sessionId = transport.sessionId;
  transports.set(sessionId, transport);

  const server = createMcpServer();

  res.on("close", () => {
    transports.delete(sessionId);
    console.log(`[${new Date().toISOString()}] SSE disconnected: ${sessionId}`);
  });

  await server.connect(transport);
});

app.post("/messages", async (req, res) => {
  const sessionId = req.query.sessionId as string;
  const transport = transports.get(sessionId);

  if (!transport) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  await transport.handlePostMessage(req, res);
});

// ─── Start HTTP Server ──────────────────────────────────────────────────────

app.listen(PORT, HOST, () => {
  console.log(`\n╔══════════════════════════════════════════════════════════════════╗`);
  console.log(`║  NHS Research & Analytics Platform - MCP Server v1.1.0 (HTTP)   ║`);
  console.log(`╠══════════════════════════════════════════════════════════════════╣`);
  console.log(`║  SSE Endpoint:  http://${HOST}:${PORT}/mcp                            ║`);
  console.log(`║  Messages:      http://${HOST}:${PORT}/messages                       ║`);
  console.log(`║  Health:        http://${HOST}:${PORT}/health                         ║`);
  console.log(`╠══════════════════════════════════════════════════════════════════╣`);
  console.log(`║  Session: ${currentSession.displayName.padEnd(52)}║`);
  console.log(`║  Role:    ${currentSession.role.padEnd(52)}║`);
  console.log(`║  Tier:    ${currentSession.accessTier.padEnd(52)}║`);
  console.log(`╠══════════════════════════════════════════════════════════════════╣`);
  console.log(`║  Tools (11):                                                    ║`);
  console.log(`║    Research:  searchProjects, searchDatasets, getProjectDetails  ║`);
  console.log(`║    Queries:   submitQuery, getQueryStatus                        ║`);
  console.log(`║    Explore:   previewDataset, listColumns, explainDataset        ║`);
  console.log(`║    Validate:  validateQuery                                      ║`);
  console.log(`║    Govern:    getAuditTrail, getRateLimit                        ║`);
  console.log(`╚══════════════════════════════════════════════════════════════════╝\n`);
});
