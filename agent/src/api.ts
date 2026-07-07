#!/usr/bin/env node
// ─── NHS Research Agent - REST API ───────────────────────────────────────────
// Exposes the AI Research Agent as a REST API with full observability.
//
// Endpoints:
//   POST /query              - Submit a research question
//   GET  /health             - Health check & agent status
//   GET  /tools              - List available MCP tools
//   GET  /audit/:traceId     - Retrieve audit record for a previous request
//   GET  /audit              - List recent audit records
//
// Environment:
//   OPENAI_API_KEY       - Required: Your OpenAI API key
//   OPENAI_MODEL         - Optional: Model to use (default: gpt-4o)
//   MCP_SERVER_PATH      - Optional: Path to MCP server
//   API_PORT             - Optional: Port to listen on (default: 3002)
//   MAX_ITERATIONS       - Optional: Max tool call loops (default: 10)

import express from "express";
import cors from "cors";
import { v4 as uuidv4 } from "uuid";
import { ResearchAgent, type AgentResponse, type ResearcherContext } from "./agent.js";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─── Load Researchers for Identity Injection ────────────────────────────────

interface RawResearcher {
  username: string;
  display_name: string;
  role: string;
  projects: string[];
}

let researchers: RawResearcher[] = [];
try {
  const researchersPath = resolve(__dirname, "../../mcp-server/data/researchers.json");
  researchers = JSON.parse(readFileSync(researchersPath, "utf-8"));
} catch {
  // Researchers file not found - identity injection disabled
}

function lookupResearcher(researcherId: string): ResearcherContext | undefined {
  const r = researchers.find(r => r.username === researcherId);
  if (!r) return undefined;
  return {
    researcher_id: r.username,
    display_name: r.display_name,
    role: r.role,
    projects: r.projects,
  };
}

// ─── Configuration ──────────────────────────────────────────────────────────

const PORT = parseInt(process.env.API_PORT ?? "3002", 10);
const HOST = process.env.API_HOST ?? "0.0.0.0";

// ─── App Setup ──────────────────────────────────────────────────────────────

const app = express();
app.use(cors());
app.use(express.json());

let agent: ResearchAgent | null = null;
let agentReady = false;
let startTime: string;
let requestCount = 0;

// ─── Audit Store (in-memory, recent requests) ───────────────────────────────

interface AuditRecord {
  trace_id: string;
  question: string;
  answer: string;
  sources: string[];
  status: "success" | "error";
  error_message?: string;
  request_time: string;
  response_time: string;
  total_duration_ms: number;
  tools_invoked: Array<{
    tool: string;
    args: Record<string, unknown>;
    duration_ms: number;
    success: boolean;
    error?: string;
    iteration: number;
  }>;
  token_usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    estimated_cost_usd: number;
  };
  timing: {
    llm_thinking_ms: number;
    tool_execution_ms: number;
    overhead_ms: number;
  };
  governance_applied: Array<{
    policy_id: string;
    policy_name: string;
    result: "passed" | "blocked" | "warning";
    details?: string;
  }>;
  decision_chain: string[];
  errors: Array<{ tool: string; message: string; timestamp: string }>;
  model: string;
  iterations: number;
}

const auditStore: AuditRecord[] = [];
const MAX_AUDIT_RECORDS = 100;

function storeAudit(record: AuditRecord): void {
  auditStore.unshift(record); // newest first
  if (auditStore.length > MAX_AUDIT_RECORDS) {
    auditStore.pop();
  }
}

// Source extraction is now built into the agent (extractSourcesFromResults)
// The API uses response.sources directly from the agent's output.

// ─── POST /query ────────────────────────────────────────────────────────────

app.post("/query", async (req, res) => {
  const { question, researcher_id } = req.body;

  if (!question || typeof question !== "string" || question.trim().length === 0) {
    res.status(400).json({
      error: "Bad Request",
      message: "Request body must include a non-empty 'question' field.",
      example: { question: "Which datasets are available for diabetes research?", researcher_id: "diana" },
    });
    return;
  }

  if (!agentReady || !agent) {
    res.status(503).json({
      error: "Service Unavailable",
      message: "Agent is still initializing. Please try again in a few seconds.",
    });
    return;
  }

  // Resolve researcher identity (optional)
  const researcher = researcher_id ? lookupResearcher(researcher_id) : undefined;

  const traceId = uuidv4().replace(/-/g, "").slice(0, 8);
  const requestTime = new Date().toISOString();
  requestCount++;

  console.log(
    `[${requestTime}] POST /query | trace_id=${traceId} | #${requestCount} | researcher=${researcher_id ?? "anonymous"} | "${question.slice(0, 80)}"`,
  );

  try {
    // Delegate reasoning to the AI Research Agent (with optional researcher context)
    const response = await agent.ask(question.trim(), researcher);
    const responseTime = new Date().toISOString();

    // Use agent's built-in source extraction (from tool results, not just args)
    const sources = response.sources;

    // Build the audit record
    const auditRecord: AuditRecord = {
      trace_id: traceId,
      question: question.trim(),
      answer: response.answer,
      sources,
      status: "success",
      request_time: requestTime,
      response_time: responseTime,
      total_duration_ms: response.observability.total_duration_ms,
      tools_invoked: response.toolsInvoked.map(t => ({
        tool: t.tool,
        args: t.args,
        duration_ms: t.duration_ms,
        success: t.success,
        error: t.error,
        iteration: t.iteration,
      })),
      token_usage: response.observability.token_usage,
      timing: response.observability.timing,
      governance_applied: response.observability.governance_applied,
      decision_chain: response.observability.decision_chain,
      errors: response.observability.errors,
      model: process.env.OPENAI_MODEL ?? "gpt-4o",
      iterations: response.totalIterations,
    };

    // Store for later retrieval
    storeAudit(auditRecord);

    // Build the API response
    const apiResponse = {
      answer: response.answer,
      sources,
      trace_id: traceId,
      grounding: response.grounding,
      researcher: response.researcher
        ? {
            id: response.researcher.researcher_id,
            name: response.researcher.display_name,
            role: response.researcher.role,
            projects: response.researcher.projects,
          }
        : undefined,
      observability: {
        request_id: traceId,
        timestamp: requestTime,
        total_duration_ms: response.observability.total_duration_ms,
        model: process.env.OPENAI_MODEL ?? "gpt-4o",
        iterations: response.totalIterations,
        tools_invoked: response.toolsInvoked.map(t => ({
          tool: t.tool,
          args: t.args,
          duration_ms: t.duration_ms,
          success: t.success,
          error: t.error ?? null,
          iteration: t.iteration,
          timestamp: t.timestamp,
        })),
        timing: response.observability.timing,
        token_usage: response.observability.token_usage,
        governance: response.observability.governance_applied,
        errors: response.observability.errors,
        decision_chain: response.observability.decision_chain,
        llm_calls: response.observability.llm_calls,
      },
    };

    console.log(
      `[${responseTime}] ✓ trace_id=${traceId} | ${response.observability.total_duration_ms}ms | ` +
        `tools=${response.toolsInvoked.length} | tokens=${response.observability.token_usage.total_tokens} | ` +
        `cost=$${response.observability.token_usage.estimated_cost_usd.toFixed(4)}`,
    );

    res.json(apiResponse);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const responseTime = new Date().toISOString();

    console.error(`[${responseTime}] ✗ trace_id=${traceId} | ERROR: ${errorMessage}`);

    // Store error audit
    storeAudit({
      trace_id: traceId,
      question: question.trim(),
      answer: "",
      sources: [],
      status: "error",
      error_message: errorMessage,
      request_time: requestTime,
      response_time: responseTime,
      total_duration_ms: Date.now() - new Date(requestTime).getTime(),
      tools_invoked: [],
      token_usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, estimated_cost_usd: 0 },
      timing: { llm_thinking_ms: 0, tool_execution_ms: 0, overhead_ms: 0 },
      governance_applied: [],
      decision_chain: [`Error: ${errorMessage}`],
      errors: [{ tool: "agent", message: errorMessage, timestamp: responseTime }],
      model: process.env.OPENAI_MODEL ?? "gpt-4o",
      iterations: 0,
    });

    res.status(500).json({
      error: "Internal Server Error",
      message: "The agent encountered an error processing your question.",
      trace_id: traceId,
      observability: {
        request_id: traceId,
        timestamp: requestTime,
        error: errorMessage,
        total_duration_ms: Date.now() - new Date(requestTime).getTime(),
      },
    });
  }
});

// ─── GET /audit/:traceId ────────────────────────────────────────────────────

app.get("/audit/:traceId", (req, res) => {
  const record = auditStore.find(r => r.trace_id === req.params.traceId);

  if (!record) {
    res.status(404).json({
      error: "Not Found",
      message: `No audit record found for trace_id: ${req.params.traceId}`,
    });
    return;
  }

  res.json(record);
});

// ─── GET /audit ─────────────────────────────────────────────────────────────

app.get("/audit", (req, res) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 20, MAX_AUDIT_RECORDS);
  const status = req.query.status as string | undefined;

  let records = auditStore;
  if (status === "success" || status === "error") {
    records = records.filter(r => r.status === status);
  }

  res.json({
    total: records.length,
    limit,
    records: records.slice(0, limit).map(r => ({
      trace_id: r.trace_id,
      question: r.question.slice(0, 100),
      status: r.status,
      total_duration_ms: r.total_duration_ms,
      tools_count: r.tools_invoked.length,
      tokens: r.token_usage.total_tokens,
      cost_usd: r.token_usage.estimated_cost_usd,
      errors_count: r.errors.length,
      timestamp: r.request_time,
    })),
  });
});

// ─── GET /health ────────────────────────────────────────────────────────────

app.get("/health", (_req, res) => {
  res.json({
    status: agentReady ? "healthy" : "initializing",
    agent: {
      ready: agentReady,
      model: process.env.OPENAI_MODEL ?? "gpt-4o",
      max_iterations: parseInt(process.env.MAX_ITERATIONS ?? "10", 10),
    },
    server: {
      uptime_seconds: Math.floor((Date.now() - new Date(startTime).getTime()) / 1000),
      started_at: startTime,
      total_requests: requestCount,
    },
  });
});

// ─── GET /tools ─────────────────────────────────────────────────────────────

app.get("/tools", (_req, res) => {
  if (!agentReady) {
    res.status(503).json({ error: "Agent not ready" });
    return;
  }

  res.json({
    tools: [
      {
        name: "searchProjects",
        category: "Research Discovery",
        description: "Search approved research projects by domain, status, or keyword",
      },
      {
        name: "searchDatasets",
        category: "Research Discovery",
        description: "Explore available research datasets with classification",
      },
      {
        name: "getProjectDetails",
        category: "Research Discovery",
        description: "Get full details for a specific project",
      },
      { name: "previewDataset", category: "Data Exploration", description: "View sample rows from a dataset" },
      {
        name: "listColumns",
        category: "Data Exploration",
        description: "Get column definitions and metadata for a dataset",
      },
      { name: "explainDataset", category: "Data Exploration", description: "Get comprehensive dataset documentation" },
      { name: "validateQuery", category: "Query Execution", description: "Pre-validate a query before submission" },
      { name: "submitQuery", category: "Query Execution", description: "Submit a natural language analytical query" },
      { name: "getQueryStatus", category: "Query Execution", description: "Check status of a submitted query" },
      { name: "getAuditTrail", category: "Governance", description: "View the governance audit trail" },
      { name: "getRateLimit", category: "Governance", description: "Check current rate limit status" },
      { name: "listGovernancePolicies", category: "Governance", description: "List all active governance policies" },
    ],
  });
});

// ─── Start Server ───────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (!process.env.OPENAI_API_KEY) {
    console.error("❌ OPENAI_API_KEY environment variable is required.");
    console.error("   Set it with: export OPENAI_API_KEY=sk-your-key-here");
    process.exit(1);
  }

  startTime = new Date().toISOString();

  app.listen(PORT, HOST, () => {
    console.log(`\n╔══════════════════════════════════════════════════════════════╗`);
    console.log(`║  NHS Research Agent - REST API v1.1.0                        ║`);
    console.log(`╠══════════════════════════════════════════════════════════════╣`);
    console.log(`║  POST /query          Submit a research question             ║`);
    console.log(`║  GET  /health         Health check                           ║`);
    console.log(`║  GET  /tools          List MCP tools                         ║`);
    console.log(`║  GET  /audit          List recent audit records              ║`);
    console.log(`║  GET  /audit/:id      Retrieve specific audit record         ║`);
    console.log(`╠══════════════════════════════════════════════════════════════╣`);
    console.log(`║  Model: ${(process.env.OPENAI_MODEL ?? "gpt-4o").padEnd(50)}║`);
    console.log(`║  Port:  ${String(PORT).padEnd(50)}║`);
    console.log(`╚══════════════════════════════════════════════════════════════╝\n`);
    console.log(`⏳ Initializing agent...\n`);
  });

  try {
    agent = new ResearchAgent({ logLevel: "warn" });
    await agent.initialize();
    agentReady = true;
    console.log(`✅ Agent ready. Listening on http://${HOST}:${PORT}\n`);
  } catch (error) {
    console.error(`❌ Failed to initialize: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

process.on("SIGINT", async () => {
  console.log("\n\nShutting down...");
  if (agent) await agent.shutdown();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  if (agent) await agent.shutdown();
  process.exit(0);
});

main().catch(error => {
  console.error("Fatal error:", error);
  process.exit(1);
});
