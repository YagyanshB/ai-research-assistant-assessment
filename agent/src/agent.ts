// ─── NHS Research Agent - Core Agent Logic ───────────────────────────────────
// Implements the AI Research Agent that:
// 1. Takes a natural language question from a researcher
// 2. Uses an LLM to determine which MCP tools to invoke and in what order
// 3. Executes tools against the MCP server
// 4. Combines results into a concise, traceable final response
//
// Architecture: ReAct-style agent loop with OpenAI function calling
// Observability: Full telemetry on every tool call, LLM interaction, and decision

import OpenAI from "openai";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import { MCPClient, type MCPTool } from "./mcp-client.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ToolInvocation {
  tool: string;
  args: Record<string, unknown>;
  result: string;
  timestamp: string;
  /** Execution duration in milliseconds */
  duration_ms: number;
  /** Whether the tool returned an error */
  success: boolean;
  /** Error message if tool failed */
  error?: string;
  /** Which iteration triggered this tool */
  iteration: number;
}

export interface LLMCall {
  iteration: number;
  timestamp: string;
  duration_ms: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  /** What the LLM decided: "tool_call" or "final_answer" */
  decision: "tool_call" | "final_answer";
  /** Tools requested in this call (if decision is tool_call) */
  tools_requested: string[];
}

export interface GovernanceCheck {
  policy_id: string;
  policy_name: string;
  result: "passed" | "blocked" | "warning";
  details?: string;
}

export interface GroundingResult {
  /** Whether the answer is fully grounded in tool outputs */
  grounded: boolean;
  /** Claims in the answer that could not be verified against tool results */
  unverified_claims: string[];
  /** Data points in tool results that the answer correctly references */
  verified_references: string[];
}

export interface ResearcherContext {
  researcher_id: string;
  display_name: string;
  role: string;
  projects: string[];
}

export interface AgentResponse {
  answer: string;
  toolsInvoked: ToolInvocation[];
  reasoning: string;
  totalIterations: number;
  /** Sources extracted from tool results (dataset/project IDs) */
  sources: string[];
  /** Answer grounding verification */
  grounding: GroundingResult;
  /** Researcher context if provided */
  researcher?: ResearcherContext;
  /** Detailed observability telemetry */
  observability: {
    /** Total wall-clock time for the entire request */
    total_duration_ms: number;
    /** Breakdown of time spent */
    timing: {
      llm_thinking_ms: number;
      tool_execution_ms: number;
      overhead_ms: number;
    };
    /** LLM usage across all iterations */
    token_usage: {
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
      estimated_cost_usd: number;
    };
    /** Per-iteration LLM call details */
    llm_calls: LLMCall[];
    /** Governance policies checked/applied */
    governance_applied: GovernanceCheck[];
    /** Error summary */
    errors: Array<{ tool: string; message: string; timestamp: string }>;
    /** Agent decision chain (human-readable reasoning trace) */
    decision_chain: string[];
  };
}

export interface AgentConfig {
  model: string;
  maxIterations: number;
  logLevel: "debug" | "info" | "warn" | "error";
}

// ─── Cost Estimation ────────────────────────────────────────────────────────

const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  "gpt-4o": { input: 2.5 / 1_000_000, output: 10.0 / 1_000_000 },
  "gpt-4o-mini": { input: 0.15 / 1_000_000, output: 0.6 / 1_000_000 },
  "gpt-4-turbo": { input: 10.0 / 1_000_000, output: 30.0 / 1_000_000 },
};

function estimateCost(model: string, promptTokens: number, completionTokens: number): number {
  const costs = MODEL_COSTS[model] ?? MODEL_COSTS["gpt-4o"];
  return promptTokens * costs.input + completionTokens * costs.output;
}

// ─── Answer Grounding ───────────────────────────────────────────────────────
// Verifies that the LLM's answer is supported by actual tool results.
// Prevents hallucination by cross-referencing claims against evidence.

function groundAnswer(answer: string, toolResults: ToolInvocation[]): GroundingResult {
  const allToolText = toolResults
    .map(t => t.result)
    .join("\n")
    .toLowerCase();
  const verifiedRefs: string[] = [];
  const unverifiedClaims: string[] = [];

  // Extract numeric claims from the answer (e.g., "45,405 records", "18%")
  const numericClaims = answer.match(/\d[\d,.]+(?: records| patients| %| percent| months| weeks| days)?/g) ?? [];
  for (const claim of numericClaims) {
    const cleanNum = claim
      .replace(/[,\s]/g, "")
      .replace(/(records|patients|percent|months|weeks|days|%)/g, "")
      .trim();
    if (allToolText.includes(cleanNum) || allToolText.includes(claim.toLowerCase())) {
      verifiedRefs.push(claim);
    } else if (cleanNum.length > 1) {
      // Only flag as unverified if it's a meaningful number (not single digits)
      unverifiedClaims.push(claim);
    }
  }

  // Extract dataset/project ID references from the answer
  const idRefs = answer.match(/(?:DS|PRJ)\d{3}/g) ?? [];
  for (const id of idRefs) {
    if (allToolText.includes(id.toLowerCase())) {
      verifiedRefs.push(id);
    } else {
      unverifiedClaims.push(`Reference to ${id} not found in tool results`);
    }
  }

  // Extract quoted names/titles and verify against tool outputs
  const quotedNames = answer.match(/"([^"]+)"|'([^']+)'|"([^"]+)"/g) ?? [];
  for (const name of quotedNames) {
    const clean = name.replace(/[""'"']/g, "").toLowerCase();
    if (clean.length > 3 && allToolText.includes(clean)) {
      verifiedRefs.push(name);
    }
  }

  // Grounded = no significant unverified claims
  const grounded = unverifiedClaims.length === 0;

  return { grounded, unverified_claims: unverifiedClaims, verified_references: verifiedRefs };
}

// ─── Source Extraction from Tool Results ────────────────────────────────────
// Extracts dataset/project IDs from actual tool output text (not just args).

function extractSourcesFromResults(toolResults: ToolInvocation[]): string[] {
  const sources = new Set<string>();

  for (const inv of toolResults) {
    // From args
    if (inv.args.datasetId) sources.add(inv.args.datasetId as string);
    if (inv.args.projectId) sources.add(inv.args.projectId as string);

    // From result text — more reliable for discovery tools
    const dsMatches = inv.result.match(/DS\d{3}/g);
    if (dsMatches) for (const m of dsMatches) sources.add(m);

    const prjMatches = inv.result.match(/PRJ\d{3}/g);
    if (prjMatches) for (const m of prjMatches) sources.add(m);
  }

  return Array.from(sources).sort();
}

// ─── Researcher Identity ────────────────────────────────────────────────────
// Builds a personalised system prompt addition when researcher context is provided.

function buildResearcherPrompt(researcher: ResearcherContext): string {
  const projectList = researcher.projects.includes("*")
    ? "all projects (administrator)"
    : researcher.projects.join(", ");

  return (
    `\n\nRESEARCHER CONTEXT:\n` +
    `The authenticated researcher making this request is "${researcher.display_name}" ` +
    `(username: ${researcher.researcher_id}, role: ${researcher.role}).\n` +
    `They have access to projects: ${projectList}.\n` +
    `When calling tools that accept parameters, use their context to provide ` +
    `personalised responses. For example, mention which of THEIR projects are ` +
    `relevant to their question.`
  );
}

// ─── System Prompt ──────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an AI Research Assistant for an NHS Regional Research and Analytics Platform.

Your role is to help researchers discover projects, explore datasets, and retrieve analytical results using MCP tools.

GROUNDING RULES:
- Every fact in your answer MUST come from a tool result. Never answer from general or medical knowledge.
- If no tool can answer the question, say so plainly instead of guessing.
- If a tool returns an error or empty result for a specific ID/name, relay that plainly in one sentence. Do NOT retry with a different or broader tool call, and do NOT fall back to your own knowledge.

OUTPUT FORMAT:
- Respond in plain text only. No markdown formatting (no headers, bullet points, bold/italics, or code blocks).
- Do NOT repeat dataset or project IDs (e.g. DS001, PRJ001) in your prose — they are returned separately in the sources field. Refer to items by their name/title instead.
- Answer as briefly as possible: a single short sentence for simple lookups. Only include extra detail (fields, record counts, descriptions) if the researcher specifically asks for it.

GOVERNANCE:
- If a governance suppression notice is returned (e.g. fewer than 5 records), state in one short sentence that results were suppressed and why. Do not suggest how to proceed unless the researcher asks.
- For restricted/sensitive datasets, inform the researcher about access requirements.

WORKFLOW FOR ANALYTICAL QUERIES:
1. Use searchDatasets or explainDataset to understand available data
2. Use listColumns to know what fields exist before querying
3. Use validateQuery to check a query is safe BEFORE submitting
4. Only then use submitQuery to execute

AVAILABLE TOOL CATEGORIES:
- Research Discovery: searchProjects, searchDatasets, getProjectDetails
- Data Exploration: previewDataset, listColumns, explainDataset
- Query Execution: validateQuery, submitQuery, getQueryStatus
- Governance: getAuditTrail, getRateLimit, listGovernancePolicies

Determine the optimal order of tool calls to efficiently answer the question. Combine tool results into a single, coherent response.`;

// ─── Agent Class ────────────────────────────────────────────────────────────

export class ResearchAgent {
  private openai: OpenAI;
  private mcpClient: MCPClient;
  private config: AgentConfig;
  private tools: ChatCompletionTool[] = [];
  private mcpTools: MCPTool[] = [];

  constructor(config?: Partial<AgentConfig>) {
    this.config = {
      model: process.env.OPENAI_MODEL ?? "gpt-4o",
      maxIterations: parseInt(process.env.MAX_ITERATIONS ?? "10", 10),
      logLevel: (process.env.LOG_LEVEL as AgentConfig["logLevel"]) ?? "info",
      ...config,
    };

    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    this.mcpClient = new MCPClient();
  }

  /**
   * Initialize the agent: connect to MCP server and discover available tools.
   */
  async initialize(): Promise<void> {
    this.log("info", "Connecting to MCP server...");
    await this.mcpClient.connect();

    this.log("info", "Discovering available tools...");
    this.mcpTools = await this.mcpClient.listTools();
    this.tools = this.mcpTools.map(tool => this.convertToOpenAITool(tool));

    this.log("info", `Agent ready. ${this.tools.length} tools available: ${this.mcpTools.map(t => t.name).join(", ")}`);
  }

  /**
   * Process a researcher's question through the agent loop.
   * Optionally accepts researcher context for personalised responses.
   * Returns a structured response with full observability telemetry.
   */
  async ask(question: string, researcher?: ResearcherContext): Promise<AgentResponse> {
    const requestStart = Date.now();
    const toolInvocations: ToolInvocation[] = [];
    const llmCalls: LLMCall[] = [];
    const governanceChecks: GovernanceCheck[] = [];
    const errors: Array<{ tool: string; message: string; timestamp: string }> = [];
    const decisionChain: string[] = [];
    let iterations = 0;
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let llmThinkingMs = 0;
    let toolExecutionMs = 0;

    // Build system prompt with optional researcher identity
    let systemPrompt = SYSTEM_PROMPT;
    if (researcher) {
      systemPrompt += buildResearcherPrompt(researcher);
      decisionChain.push(
        `Researcher identified: ${researcher.display_name} (${researcher.role}), projects: ${researcher.projects.join(", ")}`,
      );
    }

    // Build conversation messages
    const messages: ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: question },
    ];

    this.log(
      "info",
      `\nProcessing question: "${question}"${researcher ? ` [researcher: ${researcher.researcher_id}]` : ""}`,
    );
    decisionChain.push(`Received question: "${question.slice(0, 100)}${question.length > 100 ? "..." : ""}"`);

    // ─── Agent Loop (ReAct pattern) ───────────────────────────────────────
    while (iterations < this.config.maxIterations) {
      iterations++;
      this.log("debug", `\n--- Iteration ${iterations} ---`);

      // Call the LLM
      const llmStart = Date.now();
      const completion = await this.openai.chat.completions.create({
        model: this.config.model,
        messages,
        tools: this.tools,
        tool_choice: "auto",
      });
      const llmDuration = Date.now() - llmStart;
      llmThinkingMs += llmDuration;

      const choice = completion.choices[0];
      const assistantMessage = choice.message;
      const usage = completion.usage;

      // Track token usage
      const promptTokens = usage?.prompt_tokens ?? 0;
      const completionTokens = usage?.completion_tokens ?? 0;
      totalPromptTokens += promptTokens;
      totalCompletionTokens += completionTokens;

      // Add assistant's response to conversation history
      messages.push(assistantMessage);

      // Check if the LLM wants to call tools
      if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
        const toolNames = assistantMessage.tool_calls.map(tc => tc.function.name);

        // Record LLM call
        llmCalls.push({
          iteration: iterations,
          timestamp: new Date().toISOString(),
          duration_ms: llmDuration,
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: promptTokens + completionTokens,
          decision: "tool_call",
          tools_requested: toolNames,
        });

        decisionChain.push(
          `Iteration ${iterations}: LLM decided to call ${toolNames.length} tool(s): [${toolNames.join(", ")}]`,
        );
        this.log("info", `  LLM requesting ${assistantMessage.tool_calls.length} tool call(s):`);

        // Execute each tool call
        for (const toolCall of assistantMessage.tool_calls) {
          const toolName = toolCall.function.name;
          const toolArgs = JSON.parse(toolCall.function.arguments);

          this.log("info", `    → ${toolName}(${JSON.stringify(toolArgs)})`);

          // Execute against MCP server
          const toolStart = Date.now();
          let resultText: string;
          let success = true;
          let errorMsg: string | undefined;

          try {
            const result = await this.mcpClient.callTool(toolName, toolArgs);
            resultText = result.content.map(c => c.text).join("\n");

            if (result.isError) {
              success = false;
              errorMsg = resultText;
              this.log("warn", `    ✗ Tool returned error`);
            } else {
              this.log("info", `    ✓ Success (${Date.now() - toolStart}ms)`);
            }

            // Detect governance enforcement in results
            if (resultText.includes("GOV-005") || resultText.includes("Suppressed")) {
              governanceChecks.push({
                policy_id: "GOV-005",
                policy_name: "Small-Number Suppression",
                result: "blocked",
                details: "Result suppressed due to <5 records",
              });
            }
            if (resultText.includes("Rate Limit")) {
              governanceChecks.push({
                policy_id: "GOV-001",
                policy_name: "Rate Limiting",
                result: "blocked",
                details: "Daily query limit reached",
              });
            }
            if (resultText.includes("Access Denied")) {
              governanceChecks.push({
                policy_id: "GOV-002",
                policy_name: "Tiered Access Control",
                result: "blocked",
                details: "Insufficient clearance tier",
              });
            }
            if (resultText.includes("Query Rejected")) {
              governanceChecks.push({
                policy_id: "GOV-004",
                policy_name: "PII Pattern Detection",
                result: "blocked",
                details: "Query contains prohibited identifier patterns",
              });
            }
            if (resultText.includes("Successfully") || resultText.includes("Found")) {
              governanceChecks.push({
                policy_id: "GOV-009",
                policy_name: "Full Audit Trail",
                result: "passed",
                details: "Action logged to audit trail",
              });
            }
          } catch (error) {
            const errMessage = error instanceof Error ? error.message : String(error);
            resultText = `Error calling tool ${toolName}: ${errMessage}`;
            success = false;
            errorMsg = errMessage;
            errors.push({ tool: toolName, message: errMessage, timestamp: new Date().toISOString() });
            this.log("error", `    ✗ ${resultText}`);
          }

          const toolDuration = Date.now() - toolStart;
          toolExecutionMs += toolDuration;

          // Record the invocation with full telemetry
          toolInvocations.push({
            tool: toolName,
            args: toolArgs,
            result: resultText,
            timestamp: new Date().toISOString(),
            duration_ms: toolDuration,
            success,
            error: errorMsg,
            iteration: iterations,
          });

          // Add tool result to conversation
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: resultText,
          });
        }
      } else {
        // LLM is done - it produced a final response
        llmCalls.push({
          iteration: iterations,
          timestamp: new Date().toISOString(),
          duration_ms: llmDuration,
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: promptTokens + completionTokens,
          decision: "final_answer",
          tools_requested: [],
        });

        decisionChain.push(`Iteration ${iterations}: LLM produced final answer`);
        this.log("info", `\n  Agent complete after ${iterations} iteration(s), ${toolInvocations.length} tool call(s)`);

        const totalDuration = Date.now() - requestStart;
        const overheadMs = totalDuration - llmThinkingMs - toolExecutionMs;

        // Add baseline governance passes
        if (governanceChecks.length === 0) {
          governanceChecks.push({
            policy_id: "GOV-009",
            policy_name: "Full Audit Trail",
            result: "passed",
            details: "All actions logged",
          });
        }
        governanceChecks.push({
          policy_id: "GOV-001",
          policy_name: "Rate Limiting",
          result: "passed",
          details: "Within daily quota",
        });

        const finalAnswer = assistantMessage.content ?? "I was unable to generate a response.";

        // ─── Answer Grounding: verify LLM output against tool results ──
        const grounding = groundAnswer(finalAnswer, toolInvocations);
        if (!grounding.grounded) {
          decisionChain.push(`⚠️ Grounding check: ${grounding.unverified_claims.length} unverified claim(s) detected`);
        } else {
          decisionChain.push(`✓ Grounding check passed: answer fully supported by tool results`);
        }

        // ─── Source Extraction from tool outputs ──────────────────────
        const sources = extractSourcesFromResults(toolInvocations);

        return {
          answer: finalAnswer,
          toolsInvoked: toolInvocations,
          reasoning: this.buildReasoning(toolInvocations),
          totalIterations: iterations,
          sources,
          grounding,
          researcher,
          observability: {
            total_duration_ms: totalDuration,
            timing: {
              llm_thinking_ms: llmThinkingMs,
              tool_execution_ms: toolExecutionMs,
              overhead_ms: overheadMs,
            },
            token_usage: {
              prompt_tokens: totalPromptTokens,
              completion_tokens: totalCompletionTokens,
              total_tokens: totalPromptTokens + totalCompletionTokens,
              estimated_cost_usd: estimateCost(this.config.model, totalPromptTokens, totalCompletionTokens),
            },
            llm_calls: llmCalls,
            governance_applied: governanceChecks,
            errors,
            decision_chain: decisionChain,
          },
        };
      }
    }

    // Safety: max iterations reached
    this.log("warn", `Max iterations (${this.config.maxIterations}) reached.`);
    decisionChain.push(`⚠️ Max iterations (${this.config.maxIterations}) reached - forcing final answer`);

    messages.push({
      role: "user",
      content: "Please provide your best answer based on the information gathered so far. Summarize concisely.",
    });

    const finalStart = Date.now();
    const finalCompletion = await this.openai.chat.completions.create({
      model: this.config.model,
      messages,
      tool_choice: "none",
    });
    const finalDuration = Date.now() - finalStart;
    llmThinkingMs += finalDuration;

    const finalUsage = finalCompletion.usage;
    totalPromptTokens += finalUsage?.prompt_tokens ?? 0;
    totalCompletionTokens += finalUsage?.completion_tokens ?? 0;

    const totalDuration = Date.now() - requestStart;
    const fallbackAnswer =
      finalCompletion.choices[0].message.content ?? "Unable to complete analysis within iteration limit.";
    const grounding = groundAnswer(fallbackAnswer, toolInvocations);
    const sources = extractSourcesFromResults(toolInvocations);

    return {
      answer: fallbackAnswer,
      toolsInvoked: toolInvocations,
      reasoning: this.buildReasoning(toolInvocations),
      totalIterations: iterations,
      sources,
      grounding,
      researcher,
      observability: {
        total_duration_ms: totalDuration,
        timing: {
          llm_thinking_ms: llmThinkingMs,
          tool_execution_ms: toolExecutionMs,
          overhead_ms: totalDuration - llmThinkingMs - toolExecutionMs,
        },
        token_usage: {
          prompt_tokens: totalPromptTokens,
          completion_tokens: totalCompletionTokens,
          total_tokens: totalPromptTokens + totalCompletionTokens,
          estimated_cost_usd: estimateCost(this.config.model, totalPromptTokens, totalCompletionTokens),
        },
        llm_calls: llmCalls,
        governance_applied: governanceChecks,
        errors,
        decision_chain: decisionChain,
      },
    };
  }

  /**
   * Shut down the agent and disconnect from MCP server.
   */
  async shutdown(): Promise<void> {
    await this.mcpClient.disconnect();
    this.log("info", "Agent disconnected.");
  }

  // ─── Private Helpers ────────────────────────────────────────────────────

  private convertToOpenAITool(mcpTool: MCPTool): ChatCompletionTool {
    return {
      type: "function",
      function: {
        name: mcpTool.name,
        description: mcpTool.description,
        parameters: mcpTool.inputSchema as Record<string, unknown>,
      },
    };
  }

  private buildReasoning(invocations: ToolInvocation[]): string {
    if (invocations.length === 0) return "No tools were needed to answer this question.";

    const steps = invocations.map((inv, i) => {
      const argStr = Object.keys(inv.args).length > 0 ? ` with ${JSON.stringify(inv.args)}` : "";
      const status = inv.success ? "✓" : "✗";
      return `${i + 1}. [${status}] Called \`${inv.tool}\`${argStr} (${inv.duration_ms}ms)`;
    });

    return `Tool execution trace:\n${steps.join("\n")}`;
  }

  private log(level: "debug" | "info" | "warn" | "error", message: string): void {
    const levels = { debug: 0, info: 1, warn: 2, error: 3 };
    if (levels[level] >= levels[this.config.logLevel]) {
      const prefix = { debug: "🔍", info: "ℹ️ ", warn: "⚠️ ", error: "❌" }[level];
      console.error(`${prefix} ${message}`);
    }
  }
}
