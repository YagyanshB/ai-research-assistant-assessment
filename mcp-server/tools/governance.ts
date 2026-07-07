// ─── NHS Research Platform - Governance Tools ───────────────────────────────
// MCP tools for governance visibility:
//   - getAuditTrail:           View the audit log
//   - getRateLimit:            Check rate limit status
//   - listGovernancePolicies:  List all active governance policies

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { UserSession } from "../types.js";
import { getRateLimitStatus, createAuditEntry, getAuditLog, getGovernancePolicies } from "../governance.js";

// ─── Register Governance Tools ──────────────────────────────────────────────

export function registerGovernanceTools(server: McpServer, getSession: () => UserSession): void {
  // ─── Tool: Get Audit Trail ──────────────────────────────────────────────

  server.tool(
    "getAuditTrail",
    "View the governance audit trail. Shows logged actions, tool invocations, and their outcomes. Supports filtering by user, tool, and outcome.",
    {
      userId: z.string().optional().describe("Filter by user ID"),
      toolName: z.string().optional().describe("Filter by tool name (e.g., 'submitQuery', 'searchProjects')"),
      outcome: z.enum(["Success", "Rejected", "Pending", "Rate Limited"]).optional().describe("Filter by outcome"),
      limit: z.number().optional().describe("Maximum number of entries to return (default 20)"),
    },
    async params => {
      const session = getSession();

      const entries = getAuditLog({
        userId: params.userId,
        toolName: params.toolName,
        outcome: params.outcome,
        limit: params.limit ?? 20,
      });

      createAuditEntry(
        session.userId,
        "getAuditTrail",
        "View Audit Trail",
        "Success",
        `Retrieved ${entries.length} entries with filters: ${JSON.stringify(params)}`,
      );

      if (entries.length === 0) {
        return { content: [{ type: "text", text: "No audit entries found matching your criteria." }] };
      }

      const text =
        `📋 **Audit Trail** (${entries.length} entries)\n\n` +
        entries
          .map(
            e =>
              `**${new Date(e.timestamp).toLocaleString("en-GB")}** | ${e.outcome === "Success" ? "✅" : e.outcome === "Rejected" ? "🚫" : e.outcome === "Pending" ? "⏳" : "⚠️"} ${e.outcome}\n` +
              `   Tool: \`${e.toolName}\` | Action: ${e.action}\n` +
              `   User: ${e.userId}\n` +
              `   ${e.details}`,
          )
          .join("\n\n");

      return { content: [{ type: "text", text }] };
    },
  );

  // ─── Tool: Get Rate Limit Status ────────────────────────────────────────

  server.tool(
    "getRateLimit",
    "Check the current user's rate limit status including queries used today and remaining quota.",
    {},
    async () => {
      const session = getSession();
      const status = getRateLimitStatus(session);

      return {
        content: [
          {
            type: "text",
            text:
              `📊 **Rate Limit Status**\n\n` +
              `User: ${session.displayName} (${session.role})\n` +
              `Queries used today: ${status.used}/${status.limit}\n` +
              `Remaining: ${status.remaining}\n` +
              `Access Tier: ${session.accessTier}\n\n` +
              `${status.remaining <= 5 ? "⚠️ Warning: Approaching daily limit." : "✅ Sufficient quota remaining."}`,
          },
        ],
      };
    },
  );

  // ─── Tool: List Governance Policies ─────────────────────────────────────

  server.tool(
    "listGovernancePolicies",
    "List all active governance policies applied by the NHS Research Platform. Shows policy ID, name, description, category, and enforcement level. Use this to understand what governance rules are in effect.",
    {
      category: z
        .enum(["access-control", "data-protection", "rate-limiting", "output-control", "audit"])
        .optional()
        .describe("Filter by policy category"),
    },
    async params => {
      let policies = getGovernancePolicies();

      if (params.category) {
        policies = policies.filter(p => p.category === params.category);
      }

      const text =
        `🏛️ **Active Governance Policies** (${policies.length})\n\n` +
        policies
          .map(
            p =>
              `**[${p.id}] ${p.name}**\n` +
              `   Category: ${p.category} | Enforcement: ${p.enforcement}\n` +
              `   ${p.description}`,
          )
          .join("\n\n");

      return { content: [{ type: "text", text }] };
    },
  );
}
