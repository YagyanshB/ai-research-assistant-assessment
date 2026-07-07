// ─── NHS Research Platform - Research Discovery Tools ────────────────────────
// MCP tools for discovering projects, searching datasets, and managing queries:
//   - searchProjects:     Find approved research projects
//   - searchDatasets:     Explore available datasets
//   - getProjectDetails:  View full project information
//   - submitQuery:        Submit analytical queries
//   - getQueryStatus:     Check query approval status

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { UserSession } from "../types.js";
import {
  researchProjects,
  researchDatasets,
  analyticalQueries,
  sampleQueryResults,
  resolveDatasetId,
  resolveProjectId,
  researchers,
} from "../data.js";
import {
  checkRateLimit,
  checkAccessControl,
  checkClassification,
  validateQueryContent,
  determineApprovalRequirement,
  createAuditEntry,
  applySmallNumberSuppression,
} from "../governance.js";

// ─── Helper: Simulate SQL Translation ───────────────────────────────────────

function generateSimulatedSQL(query: string, dataset: { name: string; dataCategory: string }): string {
  const tableName = dataset.name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "_")
    .replace(/_+/g, "_");

  if (query.toLowerCase().includes("average") || query.toLowerCase().includes("mean")) {
    return `SELECT category, AVG(value) AS average_value, COUNT(*) AS sample_size\nFROM ${tableName}\nGROUP BY category\nORDER BY average_value DESC`;
  }
  if (query.toLowerCase().includes("trend") || query.toLowerCase().includes("monthly")) {
    return `SELECT DATE_TRUNC('month', event_date) AS month, COUNT(*) AS count\nFROM ${tableName}\nWHERE event_date >= CURRENT_DATE - INTERVAL '12 months'\nGROUP BY month\nORDER BY month`;
  }
  if (query.toLowerCase().includes("compare") || query.toLowerCase().includes("by")) {
    return `SELECT group_category, COUNT(*) AS total, AVG(metric) AS avg_metric\nFROM ${tableName}\nGROUP BY group_category\nORDER BY total DESC`;
  }
  if (query.toLowerCase().includes("top") || query.toLowerCase().includes("highest")) {
    return `SELECT item, value, category\nFROM ${tableName}\nORDER BY value DESC\nLIMIT 10`;
  }

  return `SELECT *\nFROM ${tableName}\nWHERE condition = 'filtered'\nLIMIT 1000`;
}

// ─── Register Research Tools ────────────────────────────────────────────────

export function registerResearchTools(server: McpServer, getSession: () => UserSession): void {
  // ─── Tool: Search Research Projects ─────────────────────────────────────

  server.tool(
    "searchProjects",
    "Discover NHS research projects. Filter by status ('Active'/'Completed'), domain/organisation (case-insensitive), or keyword (matches title and description). Use this to answer 'what projects exist?' or 'which projects are active?'. For details on a single project, use getProjectDetails instead.",
    {
      query: z.string().optional().describe("Search term to filter projects (matches title, description, domain, PI)"),
      status: z.enum(["Active", "Completed", "Suspended"]).optional().describe("Filter by project status"),
      domain: z
        .string()
        .optional()
        .describe("Filter by research domain (e.g., 'Mental Health', 'Respiratory Medicine')"),
      accessTier: z.enum(["Tier 1", "Tier 2", "Tier 3"]).optional().describe("Filter by access tier"),
    },
    async params => {
      const session = getSession();

      const rateCheck = checkRateLimit(session);
      if (!rateCheck.allowed) {
        createAuditEntry(session.userId, "searchProjects", "Search Projects", "Rate Limited", rateCheck.reason!);
        return { content: [{ type: "text", text: `⚠️ Rate Limit Exceeded: ${rateCheck.reason}` }], isError: true };
      }

      let results = researchProjects.filter(p => checkAccessControl(session, p.accessTier).allowed);

      if (params.status) results = results.filter(p => p.status === params.status);
      if (params.domain)
        results = results.filter(p => p.researchDomain.toLowerCase().includes(params.domain!.toLowerCase()));
      if (params.accessTier) results = results.filter(p => p.accessTier === params.accessTier);
      if (params.query) {
        const q = params.query.toLowerCase();
        results = results.filter(
          p =>
            p.title.toLowerCase().includes(q) ||
            p.description.toLowerCase().includes(q) ||
            p.principalInvestigator.toLowerCase().includes(q) ||
            p.researchDomain.toLowerCase().includes(q),
        );
      }

      createAuditEntry(
        session.userId,
        "searchProjects",
        "Search Projects",
        "Success",
        `Searched projects with: ${JSON.stringify(params)}. Found ${results.length} results.`,
      );

      const text =
        results.length > 0
          ? `Found ${results.length} research project(s):\n\n` +
            results
              .map(
                p =>
                  `📋 **${p.title}**\n` +
                  `   PI: ${p.principalInvestigator}\n` +
                  `   Domain: ${p.researchDomain}\n` +
                  `   Status: ${p.status} | Access: ${p.accessTier}\n` +
                  `   Ethics: ${p.ethicsReference}\n` +
                  `   Funding: ${p.fundingBody}\n` +
                  `   Approval: ${p.approvalDate} → ${p.expiryDate}\n` +
                  `   ${p.description}`,
              )
              .join("\n\n")
          : "No projects found matching your criteria.";

      return { content: [{ type: "text", text }] };
    },
  );

  // ─── Tool: Search Datasets ──────────────────────────────────────────────

  server.tool(
    "searchDatasets",
    "Search and filter available research datasets. Use this (not submitQuery) to answer questions like 'which datasets are available?', 'which datasets are restricted?', or 'what data do we have for diabetes?'. Returns metadata including classification, record counts, and ownership.",
    {
      query: z.string().optional().describe("Search term to filter datasets (matches name, description, category)"),
      classification: z
        .enum(["Official", "Official - Sensitive"])
        .optional()
        .describe("Filter by classification level"),
      category: z.string().optional().describe("Filter by data category (e.g., 'Mental Health', 'Emergency Care')"),
      projectId: z.string().optional().describe("Filter datasets belonging to a specific project"),
      syntheticOnly: z.boolean().optional().describe("If true, only return synthetic datasets"),
    },
    async params => {
      const session = getSession();

      const rateCheck = checkRateLimit(session);
      if (!rateCheck.allowed) {
        createAuditEntry(session.userId, "searchDatasets", "Search Datasets", "Rate Limited", rateCheck.reason!);
        return { content: [{ type: "text", text: `⚠️ Rate Limit Exceeded: ${rateCheck.reason}` }], isError: true };
      }

      let results = researchDatasets.filter(d => checkClassification(session, d.classificationLevel).allowed);

      if (params.classification) results = results.filter(d => d.classificationLevel === params.classification);
      if (params.category)
        results = results.filter(d => d.dataCategory.toLowerCase().includes(params.category!.toLowerCase()));
      if (params.projectId) results = results.filter(d => d.projectId === params.projectId);
      if (params.syntheticOnly) results = results.filter(d => d.isSynthetic);
      if (params.query) {
        const q = params.query.toLowerCase();
        results = results.filter(
          d =>
            d.name.toLowerCase().includes(q) ||
            d.description.toLowerCase().includes(q) ||
            d.dataCategory.toLowerCase().includes(q),
        );
      }

      createAuditEntry(
        session.userId,
        "searchDatasets",
        "Search Datasets",
        "Success",
        `Searched datasets with: ${JSON.stringify(params)}. Found ${results.length} results.`,
        { resourceType: "Dataset" },
      );

      const text =
        results.length > 0
          ? `Found ${results.length} dataset(s):\n\n` +
            results
              .map(
                d =>
                  `🗃️ **${d.name}**\n` +
                  `   Classification: [${d.classificationLevel}]\n` +
                  `   Records: ${d.recordCount.toLocaleString()} | Category: ${d.dataCategory}\n` +
                  `   Owner: ${d.dataOwner}\n` +
                  `   Synthetic: ${d.isSynthetic ? "Yes" : "No"}\n` +
                  `   Last Updated: ${d.lastUpdated}\n` +
                  `   Retention: ${d.retentionPolicy}\n` +
                  `   ${d.description}`,
              )
              .join("\n\n")
          : "No datasets found matching your criteria.";

      return { content: [{ type: "text", text }] };
    },
  );

  // ─── Tool: Get Project Details ──────────────────────────────────────────

  server.tool(
    "getProjectDetails",
    "Retrieve full details for a single research project by its ID (e.g. 'PRJ001') or partial title (e.g. 'Diabetes', 'Heart Failure'). Always call this to check whether a specific project exists. If it returns not found, the project does not exist — do not fall back to searchProjects.",
    {
      projectId: z.string().describe("Project ID (e.g. 'PRJ001') or partial title (e.g. 'Diabetes')"),
    },
    async params => {
      const session = getSession();

      // Fuzzy resolution: accepts ID or partial name
      const resolvedId = resolveProjectId(params.projectId);
      const project = resolvedId ? researchProjects.find(p => p.projectId === resolvedId) : null;
      if (!project) {
        return { content: [{ type: "text", text: `Project '${params.projectId}' not found.` }], isError: true };
      }

      const accessCheck = checkAccessControl(session, project.accessTier);
      if (!accessCheck.allowed) {
        createAuditEntry(
          session.userId,
          "getProjectDetails",
          "View Project Details",
          "Rejected",
          `Access denied: ${accessCheck.reason}`,
          { resourceType: "ResearchProject", resourceId: params.projectId },
        );
        return { content: [{ type: "text", text: `🔒 **Access Denied**\n\n${accessCheck.reason}` }] };
      }

      const datasets = researchDatasets.filter(d => d.projectId === project.projectId);
      const queries = analyticalQueries.filter(q => q.projectId === project.projectId);

      createAuditEntry(
        session.userId,
        "getProjectDetails",
        "View Project Details",
        "Success",
        `Viewed: ${project.title}`,
        { resourceType: "ResearchProject", resourceId: project.projectId, projectId: project.projectId },
      );

      const text =
        `📋 **${project.title}**\n\n` +
        `**PI:** ${project.principalInvestigator}\n` +
        `**Status:** ${project.status} | **Domain:** ${project.researchDomain}\n` +
        `**Access Tier:** ${project.accessTier}\n` +
        `**Ethics:** ${project.ethicsReference} | **Funding:** ${project.fundingBody}\n` +
        `**Duration:** ${project.approvalDate} → ${project.expiryDate}\n\n` +
        `**Description:**\n${project.description}\n\n` +
        `---\n` +
        `**📁 Datasets (${datasets.length}):**\n` +
        (datasets.length > 0
          ? datasets
              .map(
                d =>
                  `- ${d.name} [${d.classificationLevel}] — ${d.recordCount.toLocaleString()} records (${d.datasetId})`,
              )
              .join("\n")
          : "None") +
        `\n\n**🔍 Queries (${queries.length}):**\n` +
        (queries.length > 0
          ? queries.map(q => `- [${q.status}] ${q.naturalLanguageQuery.slice(0, 60)}...`).join("\n")
          : "None");

      return { content: [{ type: "text", text }] };
    },
  );

  // ─── Tool: Submit Analytical Query ──────────────────────────────────────

  server.tool(
    "submitQuery",
    "Execute an analytical query against a research dataset. Accepts a dataset ID (e.g. 'DS001') or partial name (e.g. 'Diabetes Cohort'). Returns sample results or a governance suppression notice. IMPORTANT: Always call validateQuery first. Restricted datasets require authorised access. Do NOT use this to answer 'which datasets exist?' — use searchDatasets for that.",
    {
      query: z.string().describe("Natural language analytical question"),
      datasetId: z.string().describe("Dataset ID (e.g. 'DS001') or partial name (e.g. 'Diabetes Cohort')"),
      projectId: z.string().describe("Project ID (e.g. 'PRJ001') or partial title (e.g. 'Diabetes')"),
    },
    async params => {
      const session = getSession();

      const rateCheck = checkRateLimit(session);
      if (!rateCheck.allowed) {
        createAuditEntry(session.userId, "submitQuery", "Submit Query", "Rate Limited", rateCheck.reason!);
        return { content: [{ type: "text", text: `⚠️ Rate Limit Exceeded: ${rateCheck.reason}` }], isError: true };
      }

      const contentCheck = validateQueryContent(params.query);
      if (!contentCheck.allowed) {
        createAuditEntry(
          session.userId,
          "submitQuery",
          "Submit Query",
          "Rejected",
          `Rejected: "${params.query}" - ${contentCheck.reason}`,
          { resourceType: "AnalyticalQuery", projectId: params.projectId },
        );
        return {
          content: [
            {
              type: "text",
              text:
                `🚫 **Query Rejected by Information Governance**\n\n` +
                `Reason: ${contentCheck.reason}\n\n` +
                `Your query: "${params.query}"\n\n` +
                `ℹ️ Only aggregate, anonymised analyses are permitted.`,
            },
          ],
        };
      }

      // Fuzzy resolution for dataset and project
      const resolvedDatasetId = resolveDatasetId(params.datasetId);
      const dataset = resolvedDatasetId ? researchDatasets.find(d => d.datasetId === resolvedDatasetId) : null;
      if (!dataset)
        return { content: [{ type: "text", text: `Dataset '${params.datasetId}' not found.` }], isError: true };

      const classCheck = checkClassification(session, dataset.classificationLevel);
      if (!classCheck.allowed) {
        createAuditEntry(
          session.userId,
          "submitQuery",
          "Submit Query",
          "Rejected",
          `Access denied to dataset ${params.datasetId}`,
          { resourceType: "Dataset", resourceId: params.datasetId, projectId: params.projectId },
        );
        return { content: [{ type: "text", text: `🔒 **Access Denied**\n\n${classCheck.reason}` }] };
      }

      const resolvedProjectId = resolveProjectId(params.projectId);
      const project = resolvedProjectId ? researchProjects.find(p => p.projectId === resolvedProjectId) : null;
      if (!project)
        return { content: [{ type: "text", text: `Project '${params.projectId}' not found.` }], isError: true };

      const accessCheck = checkAccessControl(session, project.accessTier);
      if (!accessCheck.allowed)
        return { content: [{ type: "text", text: `🔒 **Access Denied**\n\n${accessCheck.reason}` }] };

      // ─── Restricted Dataset Authorization ─────────────────────────────
      // For restricted datasets, verify the current user is assigned to a project that uses this dataset
      if (dataset.classificationLevel === "Official - Sensitive") {
        const currentResearcher = researchers.find(r => r.username === session.userId);
        if (currentResearcher && !currentResearcher.projects.includes("*")) {
          const hasProjectAccess = currentResearcher.projects.includes(project.projectId);
          if (!hasProjectAccess) {
            createAuditEntry(
              session.userId,
              "submitQuery",
              "Submit Query",
              "Rejected",
              `Researcher '${session.userId}' not authorised for restricted dataset '${dataset.datasetId}' via project '${project.projectId}'`,
              { resourceType: "Dataset", resourceId: dataset.datasetId, projectId: project.projectId },
            );
            return {
              content: [
                {
                  type: "text",
                  text:
                    `🔒 **Access Denied**\n\nDataset '${dataset.name}' is restricted. ` +
                    `Researcher '${session.userId}' is not assigned to project '${project.title}'. ` +
                    `Only researchers assigned to the project can query its restricted datasets.`,
                },
              ],
            };
          }
        }
      }

      // Check for pre-computed results
      const existingQuery = analyticalQueries.find(
        q =>
          q.naturalLanguageQuery.toLowerCase() === params.query.toLowerCase() ||
          params.query.toLowerCase().includes(q.naturalLanguageQuery.toLowerCase().slice(0, 30)),
      );

      if (existingQuery && existingQuery.status === "Approved") {
        // ─── GOV-005: Small-Number Suppression Check ────────────────────
        // Check if the sample results for this dataset have groups below threshold
        const sampleData = sampleQueryResults[dataset.datasetId];
        const suppressionCheck = applySmallNumberSuppression(sampleData?.count ?? 0);

        if (suppressionCheck.suppressed) {
          createAuditEntry(
            session.userId,
            "submitQuery",
            "Execute Query (Suppressed)",
            "Rejected",
            `Query result suppressed by GOV-005: ${suppressionCheck.reason}`,
            { resourceType: "AnalyticalQuery", resourceId: existingQuery.queryId, projectId: params.projectId },
          );
          return {
            content: [
              {
                type: "text",
                text:
                  `⚠️ **Result Suppressed (Governance Policy GOV-005)**\n\n` +
                  `**Query:** ${existingQuery.naturalLanguageQuery}\n\n` +
                  `**Translated SQL:**\n\`\`\`sql\n${existingQuery.translatedQuery}\n\`\`\`\n\n` +
                  `**Suppression Reason:**\n${suppressionCheck.reason}\n\n` +
                  `ℹ️ To avoid suppression, broaden your query criteria to ensure all result groups contain at least 5 records.`,
              },
            ],
          };
        }

        createAuditEntry(session.userId, "submitQuery", "Execute Query", "Success", `Executed: "${params.query}"`, {
          resourceType: "AnalyticalQuery",
          resourceId: existingQuery.queryId,
          projectId: params.projectId,
        });
        return {
          content: [
            {
              type: "text",
              text:
                `✅ **Query Executed Successfully**\n\n` +
                `**Natural Language:** ${existingQuery.naturalLanguageQuery}\n\n` +
                `**Translated SQL:**\n\`\`\`sql\n${existingQuery.translatedQuery}\n\`\`\`\n\n` +
                `**Result Summary:**\n${existingQuery.resultSummary}\n\n` +
                `**Governance:**\n- ✅ Small-number suppression check passed (all groups ≥ 5 records)\n- ✅ Aggregate-only validation passed\n\n` +
                `**Metadata:**\n- Dataset: ${dataset.name}\n- Classification: ${dataset.classificationLevel}\n- Reviewed by: ${existingQuery.reviewedBy}\n- Query ID: ${existingQuery.queryId}`,
            },
          ],
        };
      }

      // Check approval requirements
      const approvalCheck = determineApprovalRequirement(dataset.classificationLevel, "moderate");
      if (approvalCheck.requiresApproval) {
        createAuditEntry(
          session.userId,
          "submitQuery",
          "Submit Query (Pending)",
          "Pending",
          `Pending approval: "${params.query}"`,
          { resourceType: "AnalyticalQuery", projectId: params.projectId },
        );
        return {
          content: [
            {
              type: "text",
              text:
                `⏳ **Query Submitted for Governance Review**\n\n` +
                `Query: "${params.query}"\n` +
                `Dataset: ${dataset.name} [${dataset.classificationLevel}]\n\n` +
                `${approvalCheck.reason}\n\nTypical review time: 1-4 hours.`,
            },
          ],
        };
      }

      // Execute with simulated SQL
      const simulatedSQL = generateSimulatedSQL(params.query, dataset);

      // ─── GOV-005: Small-Number Suppression Check ──────────────────────
      const sampleData = sampleQueryResults[dataset.datasetId];
      const suppressionCheck = applySmallNumberSuppression(sampleData?.count ?? dataset.recordCount);

      if (suppressionCheck.suppressed) {
        createAuditEntry(
          session.userId,
          "submitQuery",
          "Execute Query (Suppressed)",
          "Rejected",
          `Result suppressed by GOV-005 for query: "${params.query}"`,
          { resourceType: "AnalyticalQuery", projectId: params.projectId },
        );
        return {
          content: [
            {
              type: "text",
              text:
                `⚠️ **Result Suppressed (Governance Policy GOV-005)**\n\n` +
                `**Query:** ${params.query}\n\n` +
                `**Translated SQL:**\n\`\`\`sql\n${simulatedSQL}\n\`\`\`\n\n` +
                `**Suppression Reason:**\n${suppressionCheck.reason}\n\n` +
                `ℹ️ To avoid suppression, broaden your query criteria to ensure all result groups contain at least 5 records.`,
            },
          ],
        };
      }

      createAuditEntry(
        session.userId,
        "submitQuery",
        "Execute Query",
        "Success",
        `Executed new query: "${params.query}"`,
        { resourceType: "AnalyticalQuery", projectId: params.projectId },
      );

      return {
        content: [
          {
            type: "text",
            text:
              `✅ **Query Executed Successfully**\n\n` +
              `**Natural Language:** ${params.query}\n\n` +
              `**Translated SQL:**\n\`\`\`sql\n${simulatedSQL}\n\`\`\`\n\n` +
              `**Result Summary:**\nQuery executed against ${dataset.recordCount.toLocaleString()} records in "${dataset.name}". ` +
              `Results are aggregate-level and comply with information governance requirements.\n\n` +
              `**Governance:**\n- ✅ Small-number suppression check passed (all groups ≥ 5 records)\n- ✅ PII pattern detection passed\n- ✅ Aggregate-only validation passed\n\n` +
              `**Metadata:**\n- Dataset: ${dataset.name}\n- Classification: ${dataset.classificationLevel}\n- Records scanned: ${dataset.recordCount.toLocaleString()}`,
          },
        ],
      };
    },
  );

  // ─── Tool: Get Query Status ─────────────────────────────────────────────

  server.tool(
    "getQueryStatus",
    "Check the status of a previously submitted analytical query by its ID.",
    {
      queryId: z.string().describe("The query ID to check (e.g., 'q-001')"),
    },
    async params => {
      const session = getSession();

      const query = analyticalQueries.find(q => q.queryId === params.queryId);
      if (!query) return { content: [{ type: "text", text: `❌ Query not found: ${params.queryId}` }], isError: true };

      const dataset = researchDatasets.find(d => d.datasetId === query.datasetId);
      const emoji = query.status === "Approved" ? "✅" : query.status === "Pending" ? "⏳" : "🚫";

      createAuditEntry(
        session.userId,
        "getQueryStatus",
        "Check Query Status",
        "Success",
        `Checked ${params.queryId}: ${query.status}`,
        { resourceType: "AnalyticalQuery", resourceId: params.queryId },
      );

      let text =
        `${emoji} **Query Status: ${query.status}**\n\n` +
        `**ID:** ${query.queryId}\n**Query:** ${query.naturalLanguageQuery}\n` +
        `**Dataset:** ${dataset?.name ?? query.datasetId}\n**Submitted:** ${query.submittedBy} at ${query.submittedAt}\n`;

      if (query.translatedQuery) text += `\n**SQL:**\n\`\`\`sql\n${query.translatedQuery}\n\`\`\`\n`;
      if (query.reviewedBy) text += `\n**Reviewed by:** ${query.reviewedBy} at ${query.reviewedAt}\n`;
      if (query.resultSummary) text += `\n**Result:** ${query.resultSummary}\n`;
      if (query.rejectionReason) text += `\n**Rejection:** ${query.rejectionReason}\n`;

      return { content: [{ type: "text", text }] };
    },
  );
}
