#!/usr/bin/env node
// ─── NHS Research Agent - Single Question Runner ─────────────────────────────
// Runs a single question and outputs structured JSON response.
// Useful for integration testing, CI/CD, or piping output.
//
// Usage:
//   npx tsx src/run.ts "What datasets are available for diabetes research?"
//
// Output: JSON with { answer, toolsInvoked, reasoning, totalIterations }

import { ResearchAgent } from "./agent.js";

async function run(): Promise<void> {
  const question = process.argv.slice(2).join(" ").trim();

  if (!question) {
    console.error('Usage: npx tsx src/run.ts "<your research question>"');
    process.exit(1);
  }

  if (!process.env.OPENAI_API_KEY) {
    console.error("Error: OPENAI_API_KEY environment variable is required.");
    process.exit(1);
  }

  const agent = new ResearchAgent({ logLevel: "warn" });

  try {
    await agent.initialize();
    const response = await agent.ask(question);

    // Output structured JSON
    console.log(
      JSON.stringify(
        {
          question,
          answer: response.answer,
          toolsInvoked: response.toolsInvoked.map(t => ({
            tool: t.tool,
            args: t.args,
            timestamp: t.timestamp,
          })),
          reasoning: response.reasoning,
          totalIterations: response.totalIterations,
          metadata: {
            model: process.env.OPENAI_MODEL ?? "gpt-4o",
            timestamp: new Date().toISOString(),
          },
        },
        null,
        2,
      ),
    );
  } finally {
    await agent.shutdown();
  }
}

run().catch(error => {
  console.error(JSON.stringify({ error: error.message }));
  process.exit(1);
});
