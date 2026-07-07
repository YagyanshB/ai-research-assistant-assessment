// ─── NHS Research Platform - Data Exploration Tools ──────────────────────────
// MCP tools for understanding datasets before querying:
//   - previewDataset:  View sample rows from a dataset
//   - listColumns:     Get column definitions and metadata
//   - explainDataset:  Get comprehensive dataset documentation
//   - validateQuery:   Pre-validate a query before submission

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { UserSession } from "../types.js";
import { researchDatasets, resolveDatasetId } from "../data.js";
import {
  getDatasetSchema,
  getDatasetColumns,
  getDatasetPreview,
  getDatasetMetadata,
  explainDataset as getDatasetExplanation,
} from "../data-access.js";
import { validateQuery as runQueryValidation } from "../validation.js";
import { checkRateLimit, checkClassification, createAuditEntry } from "../governance.js";

// ─── Register Data Exploration Tools ────────────────────────────────────────

export function registerDataExplorationTools(server: McpServer, getSession: () => UserSession): void {
  // ─── Tool: Preview Dataset ──────────────────────────────────────────────

  server.tool(
    "previewDataset",
    "View sample rows from a dataset to understand its structure. Accepts a dataset ID (e.g. 'DS001') or partial name (e.g. 'Diabetes Cohort'). Use this BEFORE writing queries to see what the data looks like. Do NOT use this to list all datasets — use searchDatasets for that.",
    {
      datasetId: z.string().describe("Dataset ID (e.g. 'DS001') or partial name (e.g. 'Diabetes')"),
      limit: z.number().optional().describe("Number of rows to preview (default 5, max 10)"),
    },
    async params => {
      const session = getSession();

      // Rate limit check
      const rateCheck = checkRateLimit(session);
      if (!rateCheck.allowed) {
        createAuditEntry(session.userId, "previewDataset", "Preview Dataset", "Rate Limited", rateCheck.reason!);
        return { content: [{ type: "text", text: `⚠️ Rate Limit Exceeded: ${rateCheck.reason}` }], isError: true };
      }

      // Fuzzy resolution: accepts ID or partial name
      const resolvedId = resolveDatasetId(params.datasetId);
      const metadata = getDatasetMetadata(resolvedId ?? params.datasetId);
      if (!metadata) {
        return {
          content: [
            {
              type: "text",
              text: `❌ Dataset not found: ${params.datasetId}\n\nAvailable datasets:\n${researchDatasets.map(d => `- ${d.datasetId}: ${d.name}`).join("\n")}`,
            },
          ],
          isError: true,
        };
      }

      // Classification check
      const classCheck = checkClassification(session, metadata.classificationLevel);
      if (!classCheck.allowed) {
        createAuditEntry(
          session.userId,
          "previewDataset",
          "Preview Dataset",
          "Rejected",
          `Access denied to ${params.datasetId}: ${classCheck.reason}`,
        );
        return { content: [{ type: "text", text: `🔒 **Access Denied**\n\n${classCheck.reason}` }] };
      }

      // Get preview rows
      const limit = Math.min(params.limit ?? 5, 10);
      const rows = getDatasetPreview(params.datasetId, limit);
      if (!rows || rows.length === 0) {
        return { content: [{ type: "text", text: `No preview data available for dataset ${params.datasetId}.` }] };
      }

      // Get schema for context
      const schema = getDatasetSchema(params.datasetId);

      // Format as a readable table
      const columns = Object.keys(rows[0]);
      const headerRow = `| ${columns.join(" | ")} |`;
      const separatorRow = `| ${columns.map(() => "---").join(" | ")} |`;
      const dataRows = rows.map(
        row =>
          `| ${columns
            .map(col => {
              const val = row[col];
              if (val === null) return "*null*";
              if (typeof val === "boolean") return val ? "✓" : "✗";
              return String(val);
            })
            .join(" | ")} |`,
      );

      let responseText = `📋 **Dataset Preview: ${metadata.name}**\n\n`;
      responseText += `Showing ${rows.length} of ${metadata.recordCount.toLocaleString()} records\n`;
      responseText += `Classification: [${metadata.classificationLevel}]\n\n`;
      responseText += `${headerRow}\n${separatorRow}\n${dataRows.join("\n")}\n\n`;

      if (schema) {
        responseText += `---\n**Table:** \`${schema.tableName}\` | **Records:** ${schema.rowCount.toLocaleString()}\n`;
      }

      if (classCheck.classificationWarning) {
        responseText += `\n⚠️ ${classCheck.classificationWarning}`;
      }

      // Audit
      createAuditEntry(
        session.userId,
        "previewDataset",
        "Preview Dataset",
        "Success",
        `Previewed ${rows.length} rows from ${metadata.name}`,
        { resourceType: "Dataset", resourceId: params.datasetId, projectId: metadata.projectId },
      );

      return { content: [{ type: "text", text: responseText }] };
    },
  );

  // ─── Tool: List Columns ─────────────────────────────────────────────────

  server.tool(
    "listColumns",
    "Get column definitions for a dataset including names, types, and descriptions. Accepts dataset ID or partial name. Use this to understand what fields exist BEFORE writing a query. Essential for knowing what can be queried.",
    {
      datasetId: z.string().describe("Dataset ID (e.g. 'DS001') or partial name (e.g. 'Diabetes')"),
      includeStatistics: z
        .boolean()
        .optional()
        .describe("Include statistical summaries for numeric columns (default true)"),
    },
    async params => {
      const session = getSession();

      // Rate limit check
      const rateCheck = checkRateLimit(session);
      if (!rateCheck.allowed) {
        createAuditEntry(session.userId, "listColumns", "List Columns", "Rate Limited", rateCheck.reason!);
        return { content: [{ type: "text", text: `⚠️ Rate Limit Exceeded: ${rateCheck.reason}` }], isError: true };
      }

      // Fuzzy resolution
      const resolvedId = resolveDatasetId(params.datasetId) ?? params.datasetId;
      const columns = getDatasetColumns(resolvedId);
      const metadata = getDatasetMetadata(resolvedId);
      const schema = getDatasetSchema(resolvedId);

      if (!columns || !metadata) {
        return {
          content: [
            {
              type: "text",
              text: `❌ Dataset not found: ${params.datasetId}\n\nAvailable datasets:\n${researchDatasets.map(d => `- ${d.datasetId}: ${d.name}`).join("\n")}`,
            },
          ],
          isError: true,
        };
      }

      // Classification check
      const classCheck = checkClassification(session, metadata.classificationLevel);
      if (!classCheck.allowed) {
        createAuditEntry(
          session.userId,
          "listColumns",
          "List Columns",
          "Rejected",
          `Access denied to ${params.datasetId}`,
        );
        return { content: [{ type: "text", text: `🔒 **Access Denied**\n\n${classCheck.reason}` }] };
      }

      // includeStatistics param reserved for future use when statistical metadata is available
      void params.includeStatistics;

      let responseText = `📊 **Column Definitions: ${metadata.name}**\n`;
      responseText += `Table: \`${schema?.tableName ?? params.datasetId}\` | ${columns.length} columns | ${metadata.recordCount.toLocaleString()} rows\n\n`;

      // Group columns by category
      const identifiers = columns.filter(c => c.isIdentifier);
      const aggregatable = columns.filter(c => c.aggregatable && !c.isIdentifier);
      const metrics = columns.filter(c => !c.aggregatable && !c.isIdentifier);

      if (identifiers.length > 0) {
        responseText += `### 🔒 Identifier Columns (not queryable at row level)\n`;
        for (const col of identifiers) {
          responseText += `- **\`${col.name}\`** (${col.type}) — ${col.description}\n`;
        }
        responseText += `\n`;
      }

      responseText += `### ✅ Grouping Columns (safe for GROUP BY / aggregation)\n`;
      for (const col of aggregatable) {
        responseText += `- **\`${col.name}\`** (${col.type}${col.nullable ? ", nullable" : ""}) — ${col.description}\n`;
        responseText += `  Examples: ${col.exampleValues.slice(0, 5).join(", ")}\n`;
      }
      responseText += `\n`;

      responseText += `### 📈 Metric Columns (use with aggregation functions)\n`;
      for (const col of metrics) {
        responseText += `- **\`${col.name}\`** (${col.type}${col.nullable ? ", nullable" : ""}) — ${col.description}\n`;
        responseText += `  Examples: ${col.exampleValues.slice(0, 4).join(", ")}\n`;
      }

      if (schema?.suggestedGroupBy) {
        responseText += `\n---\n**💡 Recommended GROUP BY columns:** ${schema.suggestedGroupBy.map(c => `\`${c}\``).join(", ")}\n`;
      }

      // Audit
      createAuditEntry(
        session.userId,
        "listColumns",
        "List Columns",
        "Success",
        `Listed ${columns.length} columns for ${metadata.name}`,
        { resourceType: "Dataset", resourceId: params.datasetId, projectId: metadata.projectId },
      );

      return { content: [{ type: "text", text: responseText }] };
    },
  );

  // ─── Tool: Explain Dataset ──────────────────────────────────────────────

  server.tool(
    "explainDataset",
    "Get full metadata and documentation for a dataset including field definitions, record counts, and governance constraints. Accepts dataset ID or partial name. Use this to understand what a dataset contains before running a query.",
    {
      datasetId: z.string().describe("Dataset ID (e.g. 'DS001') or partial name (e.g. 'Stroke Recovery')"),
    },
    async params => {
      const session = getSession();

      // Rate limit check
      const rateCheck = checkRateLimit(session);
      if (!rateCheck.allowed) {
        createAuditEntry(session.userId, "explainDataset", "Explain Dataset", "Rate Limited", rateCheck.reason!);
        return { content: [{ type: "text", text: `⚠️ Rate Limit Exceeded: ${rateCheck.reason}` }], isError: true };
      }

      // Fuzzy resolution
      const resolvedId = resolveDatasetId(params.datasetId) ?? params.datasetId;
      const metadata = getDatasetMetadata(resolvedId);
      if (!metadata) {
        return {
          content: [
            {
              type: "text",
              text: `❌ Dataset not found: ${params.datasetId}\n\nAvailable datasets:\n${researchDatasets.map(d => `- ${d.datasetId}: ${d.name}`).join("\n")}`,
            },
          ],
          isError: true,
        };
      }

      const classCheck = checkClassification(session, metadata.classificationLevel);
      if (!classCheck.allowed) {
        createAuditEntry(
          session.userId,
          "explainDataset",
          "Explain Dataset",
          "Rejected",
          `Access denied to ${params.datasetId}`,
        );
        return { content: [{ type: "text", text: `🔒 **Access Denied**\n\n${classCheck.reason}` }] };
      }

      // Get full explanation
      const explanation = getDatasetExplanation(params.datasetId);
      if (!explanation) {
        return { content: [{ type: "text", text: `No detailed explanation available for ${params.datasetId}.` }] };
      }

      // Audit
      createAuditEntry(
        session.userId,
        "explainDataset",
        "Explain Dataset",
        "Success",
        `Explained dataset: ${metadata.name}`,
        { resourceType: "Dataset", resourceId: params.datasetId, projectId: metadata.projectId },
      );

      let responseText = explanation;
      if (classCheck.classificationWarning) {
        responseText += `\n\n⚠️ ${classCheck.classificationWarning}`;
      }

      return { content: [{ type: "text", text: responseText }] };
    },
  );

  // ─── Tool: Validate Query ───────────────────────────────────────────────

  server.tool(
    "validateQuery",
    "Pre-validate a query against governance rules BEFORE submitting with submitQuery. Checks for PII patterns, prohibited operations, and column validity. Always call this first — if validation fails, do NOT proceed to submitQuery. Accepts dataset ID or partial name.",
    {
      query: z.string().describe("The natural language analytical question to validate"),
      datasetId: z.string().describe("Dataset ID (e.g. 'DS001') or partial name (e.g. 'Diabetes')"),
      translatedSQL: z
        .string()
        .optional()
        .describe("Optional: the SQL translation to validate column references and aggregation"),
    },
    async params => {
      const session = getSession();

      // This tool doesn't count against rate limit (it's a pre-flight check)
      // but we still audit it

      // Fuzzy resolution
      const resolvedId = resolveDatasetId(params.datasetId) ?? params.datasetId;
      const metadata = getDatasetMetadata(resolvedId);
      if (!metadata) {
        return {
          content: [
            {
              type: "text",
              text: `❌ Dataset not found: ${params.datasetId}\n\nAvailable datasets:\n${researchDatasets.map(d => `- ${d.datasetId}: ${d.name}`).join("\n")}`,
            },
          ],
          isError: true,
        };
      }

      // Run comprehensive validation
      const result = runQueryValidation(params.query, params.datasetId, {
        checkColumnsAgainstSQL: params.translatedSQL,
      });

      // Format the response
      let responseText = result.valid ? `✅ **Query Validation: PASSED**\n\n` : `🚫 **Query Validation: FAILED**\n\n`;

      responseText += `**Query:** "${params.query}"\n`;
      responseText += `**Target:** ${metadata.name} (\`${params.datasetId}\`)\n\n`;

      // Issues
      if (result.issues.length > 0) {
        responseText += `### Issues Found\n\n`;
        for (const issue of result.issues) {
          const icon = issue.severity === "error" ? "🚫" : issue.severity === "warning" ? "⚠️" : "ℹ️";
          responseText += `${icon} **[${issue.severity.toUpperCase()}]** ${issue.code}\n`;
          responseText += `   ${issue.message}\n`;
          if (issue.suggestion) {
            responseText += `   💡 *Suggestion:* ${issue.suggestion}\n`;
          }
          responseText += `\n`;
        }
      } else {
        responseText += `No issues found. Query appears safe to submit.\n\n`;
      }

      // Parsed elements
      if (result.parsed.referencedColumns.length > 0) {
        responseText += `### Parsed Elements\n`;
        responseText += `- **Columns referenced:** ${result.parsed.referencedColumns.join(", ")}\n`;
        if (result.parsed.aggregationFunctions.length > 0) {
          responseText += `- **Aggregation functions:** ${result.parsed.aggregationFunctions.join(", ")}\n`;
        }
        if (result.parsed.groupByColumns.length > 0) {
          responseText += `- **GROUP BY columns:** ${result.parsed.groupByColumns.join(", ")}\n`;
        }
        responseText += `\n`;
      }

      // Suggestions
      if (result.suggestions.length > 0) {
        responseText += `### Suggestions\n`;
        for (const suggestion of result.suggestions) {
          responseText += `💡 ${suggestion}\n`;
        }
      }

      // Audit
      const errorCount = result.issues.filter(i => i.severity === "error").length;
      const auditDetail = result.valid
        ? `Validated query: "${params.query}" against ${params.datasetId} - PASSED`
        : `Validated query: "${params.query}" against ${params.datasetId} - FAILED (${errorCount} errors)`;
      createAuditEntry(
        session.userId,
        "validateQuery",
        "Validate Query",
        result.valid ? "Success" : "Rejected",
        auditDetail,
        { resourceType: "AnalyticalQuery", projectId: metadata.projectId },
      );

      return { content: [{ type: "text", text: responseText }] };
    },
  );
}
