#!/usr/bin/env node
// ─── NHS Research Agent - CLI Entry Point ────────────────────────────────────
// Interactive CLI for the AI Research Agent.
//
// Usage:
//   npx tsx src/index.ts                     # Interactive mode
//   npx tsx src/index.ts "your question"     # Single question mode
//
// Environment:
//   OPENAI_API_KEY     - Required: Your OpenAI API key
//   OPENAI_MODEL       - Optional: Model to use (default: gpt-4o)
//   MCP_SERVER_PATH    - Optional: Path to MCP server (default: ../mcp-server/src/index.ts)
//   MAX_ITERATIONS     - Optional: Max tool call loops (default: 10)
//   LOG_LEVEL          - Optional: debug|info|warn|error (default: info)

import { createInterface } from "readline";
import { ResearchAgent } from "./agent.js";

// ─── ASCII Banner ───────────────────────────────────────────────────────────

function printBanner(): void {
  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║         NHS Research & Analytics Platform                        ║
║         AI Research Agent v1.0.0                                 ║
╠══════════════════════════════════════════════════════════════════╣
║  This agent answers research questions by orchestrating MCP      ║
║  tool calls against the NHS Research Platform.                   ║
║                                                                  ║
║  Type your question and press Enter.                             ║
║  Type 'quit' or 'exit' to leave.                                 ║
║  Type 'tools' to see available MCP tools.                        ║
║  Type 'trace' to toggle tool trace visibility.                   ║
╚══════════════════════════════════════════════════════════════════╝
`);
}

// ─── Format Agent Response ──────────────────────────────────────────────────

function formatResponse(
  response: {
    answer: string;
    toolsInvoked: Array<{ tool: string; args: Record<string, unknown> }>;
    totalIterations: number;
  },
  showTrace: boolean,
): string {
  let output = "";

  // Tool trace (if enabled)
  if (showTrace && response.toolsInvoked.length > 0) {
    output += "\n┌─ Tool Trace ─────────────────────────────────────────────────\n";
    for (const inv of response.toolsInvoked) {
      const args = Object.keys(inv.args).length > 0 ? ` ${JSON.stringify(inv.args)}` : "";
      output += `│  🔧 ${inv.tool}${args}\n`;
    }
    output += `│  (${response.toolsInvoked.length} tool calls, ${response.totalIterations} iterations)\n`;
    output += "└──────────────────────────────────────────────────────────────\n\n";
  }

  // Main answer
  output += response.answer;

  return output;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Check for API key
  if (!process.env.OPENAI_API_KEY) {
    console.error("❌ OPENAI_API_KEY environment variable is required.");
    console.error("   Set it with: export OPENAI_API_KEY=sk-your-key-here");
    process.exit(1);
  }

  const agent = new ResearchAgent();
  let showTrace = true;

  try {
    // Initialize agent (connects to MCP server)
    await agent.initialize();

    // Check for single-question mode (command line argument)
    const singleQuestion = process.argv.slice(2).join(" ").trim();
    if (singleQuestion) {
      const response = await agent.ask(singleQuestion);
      console.log(formatResponse(response, showTrace));
      await agent.shutdown();
      return;
    }

    // Interactive mode
    printBanner();

    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const prompt = (): void => {
      rl.question("\n🔬 Research Question > ", async input => {
        const trimmed = input.trim();

        if (!trimmed) {
          prompt();
          return;
        }

        // Handle special commands
        if (trimmed === "quit" || trimmed === "exit") {
          console.log("\nGoodbye! All interactions have been logged in the audit trail.");
          rl.close();
          await agent.shutdown();
          return;
        }

        if (trimmed === "tools") {
          console.log("\nAvailable MCP Tools:");
          console.log("  Research:   searchProjects, searchDatasets, getProjectDetails");
          console.log("  Explore:    previewDataset, listColumns, explainDataset");
          console.log("  Query:      validateQuery, submitQuery, getQueryStatus");
          console.log("  Governance: getAuditTrail, getRateLimit");
          prompt();
          return;
        }

        if (trimmed === "trace") {
          showTrace = !showTrace;
          console.log(`Tool trace ${showTrace ? "enabled" : "disabled"}.`);
          prompt();
          return;
        }

        // Process the question
        try {
          console.log("\n⏳ Thinking...\n");
          const response = await agent.ask(trimmed);
          console.log(formatResponse(response, showTrace));
        } catch (error) {
          console.error(`\n❌ Error: ${error instanceof Error ? error.message : String(error)}`);
        }

        prompt();
      });
    };

    prompt();
  } catch (error) {
    console.error(`❌ Failed to initialize agent: ${error instanceof Error ? error.message : String(error)}`);
    await agent.shutdown();
    process.exit(1);
  }
}

main().catch(error => {
  console.error("Fatal error:", error);
  process.exit(1);
});
