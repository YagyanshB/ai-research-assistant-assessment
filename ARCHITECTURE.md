# ATHENA - AI Powered Research Assistant for the NHS 

A lightweight AI Research Agent for an NHS Regional Research & Analytics Platform. Researchers ask questions in natural language; the agent autonomously determines which tools to call, enforces governance, and returns traceable answers.

Built on the **Model Context Protocol (MCP)** with an LLM-powered ReAct agent loop.

---

## Architecture

```
Researcher                    AI Agent                         MCP Server
    |                            |                                |
    |  POST /query               |                                |
    |  "Which datasets are       |                                |
    |   available for diabetes?" |                                |
    |--------------------------->|                                |
    |                            |                                |
    |                            |  GPT-4o decides:               |
    |                            |  "I need searchDatasets"       |
    |                            |------------------------------->|
    |                            |                                |
    |                            |                                | Governance:
    |                            |                                | - Rate limit
    |                            |                                | - Access tier
    |                            |                                | - Classification
    |                            |<-------------------------------|
    |                            |  Results: DS001, DS016...      |
    |                            |                                |
    |                            |  GPT-4o decides:               |
    |                            |  "I have enough info"          |
    |                            |                                |
    |  { answer, sources,        |                                |
    |    trace_id, observability }|                                |
    |<---------------------------|                                |
```

### Three Layers

| Layer          | Role                                                  | Technology                                 |
| -------------- | ----------------------------------------------------- | ------------------------------------------ |
| **REST API**   | Receives questions, returns answers                   | Express.js on port 3002                    |
| **AI Agent**   | Decides which tools to call and in what order         | OpenAI GPT-4o function calling, ReAct loop |
| **MCP Server** | Executes tools, enforces governance, logs audit trail | MCP SDK over stdio transport               |

---

## Quick Start

### Prerequisites

- Node.js 20+
- OpenAI API key or your preferred Model Provider

### Run Locally

```bash
# Install
cd mcp-server && npm install
cd ../agent && npm install

# Start the API
cd ../agent
export OPENAI_API_KEY=sk-your-key-here
npx tsx src/api.ts
```

### Run with Docker

```bash
docker build -t nhs-research-agent .
docker run -p 3002:3002 -e OPENAI_API_KEY=sk-your-key-here nhs-research-agent
```

### Test It

```bash
# Health check
curl http://localhost:3002/health

# Ask a question
curl -X POST http://localhost:3002/query \
  -H "Content-Type: application/json" \
  -d '{"question": "Which datasets are available for diabetes research?"}'

# View audit trail
curl http://localhost:3002/audit
```

---

## API Endpoints

| Method | Endpoint          | Description                           |
| ------ | ----------------- | ------------------------------------- |
| `POST` | `/query`          | Submit a research question            |
| `GET`  | `/health`         | Health check and agent status         |
| `GET`  | `/tools`          | List available MCP tools              |
| `GET`  | `/audit`          | List recent audit records             |
| `GET`  | `/audit/:traceId` | Get full audit for a specific request |

### POST /query

**Request:**

```json
{
  "question": "Which datasets are available for diabetes research?",
  "researcher_id": "diana"
}
```

The `researcher_id` field is optional. When provided, the agent personalises responses based on the researcher's role and project assignments.

**Response:**

```json
{
  "answer": "The Primary Care Diabetes Cohort is available with 45,405 synthetic GP records...",
  "sources": ["DS001", "PRJ001"],
  "trace_id": "a1b2c3d4",
  "grounding": {
    "grounded": true,
    "unverified_claims": [],
    "verified_references": ["45,405", "DS001"]
  },
  "researcher": {
    "id": "diana",
    "name": "Diana Fitzgerald",
    "role": "Clinical Research Fellow",
    "projects": ["PRJ001", "PRJ006"]
  },
  "observability": {
    "request_id": "a1b2c3d4",
    "total_duration_ms": 4520,
    "tools_invoked": [
      { "tool": "searchDatasets", "args": { "query": "diabetes" }, "duration_ms": 320, "success": true }
    ],
    "timing": { "llm_thinking_ms": 3800, "tool_execution_ms": 500, "overhead_ms": 220 },
    "token_usage": { "total_tokens": 2830, "estimated_cost_usd": 0.0099 },
    "governance": [{ "policy_id": "GOV-001", "policy_name": "Rate Limiting", "result": "passed" }],
    "decision_chain": [
      "Iteration 1: LLM decided to call 1 tool(s): [searchDatasets]",
      "Iteration 2: LLM produced final answer"
    ]
  }
}
```

---

## MCP Tools (14)

All tools accept both exact IDs (e.g. `DS001`) and partial names (e.g. `"Diabetes Cohort"`) via fuzzy resolution.

| Category           | Tool                     | Description                                             |
| ------------------ | ------------------------ | ------------------------------------------------------- |
| Research Discovery | `searchProjects`         | Search projects by domain, status, keyword              |
| Research Discovery | `searchDatasets`         | Search/filter datasets by keyword, classification       |
| Research Discovery | `getProjectDetails`      | Full details for a project (by ID or name)              |
| Data Exploration   | `previewDataset`         | View sample rows from a dataset                         |
| Data Exploration   | `listColumns`            | Column definitions, types, descriptions                 |
| Data Exploration   | `explainDataset`         | Full dataset documentation and constraints              |
| Query Execution    | `validateQuery`          | Pre-validate a query against governance rules           |
| Query Execution    | `submitQuery`            | Execute an analytical query with governance enforcement |
| Query Execution    | `getQueryStatus`         | Check query approval status                             |
| Governance         | `getAuditTrail`          | View governance audit log                               |
| Governance         | `getRateLimit`           | Check daily query quota                                 |
| Governance         | `listGovernancePolicies` | List all active governance policies                     |
| Governance         | `listResearchers`        | Discover researchers, filter by role                    |
| Governance         | `getResearcher`          | Look up a specific researcher by username               |

---

## Governance Policies

| ID      | Policy                                | Enforcement |
| ------- | ------------------------------------- | ----------- |
| GOV-001 | Rate Limiting (50/day)                | Hard block  |
| GOV-002 | Tiered Access Control                 | Hard block  |
| GOV-003 | Data Classification                   | Hard block  |
| GOV-004 | PII Pattern Detection                 | Hard block  |
| GOV-005 | Small-Number Suppression (<5 records) | Automatic   |
| GOV-006 | Aggregate-Only Queries                | Hard block  |
| GOV-007 | Read-Only Data Access                 | Hard block  |
| GOV-008 | Approval Workflow                     | Hard block  |
| GOV-009 | Full Audit Trail                      | Automatic   |

Governance is enforced **inside the MCP server**, not the agent. Even if someone connects directly to the MCP server bypassing the AI, all rules still apply.

---

## Architectural Decisions

### Why MCP (not hardcoded tool logic)?

- **Separation of concerns** - the agent reasons; the server executes and enforces rules
- **Protocol standard** - any MCP-compatible client (Claude Desktop, Cursor, custom) can connect
- **Independently testable** - test tools without the LLM, test agent with mock tools
- **Swappable LLM** - change from GPT-4o to Claude to a local model without touching the server

### Why native OpenAI function calling (not LangChain/LangGraph/CrewAI)?

- **MCP already IS the tool abstraction** - LangChain would be a redundant layer
- **80 lines of orchestration** vs thousands of framework code
- **Full observability** - we control the loop, so we capture every token, every timing, every decision
- **2 dependencies** (`openai` + `@modelcontextprotocol/sdk`) vs 50+ with LangChain
- **No framework lock-in** - easier to audit for NHS security requirements

### Why stdio transport (not HTTP between agent and server)?

- **Zero network config** - agent spawns the MCP server as a child process
- **Single container deployment** - one `docker run` command starts everything
- **Lower latency** - no HTTP overhead for internal tool calls

### Why in-memory data (not a database)?

- **Assessment/demonstration context** - JSON files are transparent and auditable
- **Easy to swap** - the data layer is one file (`data.ts`); replace with database queries for production

### Answer Grounding (anti-hallucination)

After the LLM produces a final answer, we cross-check it against actual tool results:

- Numeric claims are verified against the tool output text
- Dataset/project ID references are confirmed present in results
- The response includes `grounding.grounded: true/false` with lists of verified vs unverified claims
- This prevents the LLM from fabricating data that wasn't returned by any tool

### Fuzzy ID/Name Resolution

All tools accept both exact IDs (`DS005`) and partial names (`"Stroke Recovery"`):

- Prevents LLM failures when it passes a name instead of an ID
- Resolution chain: exact ID match -> exact name match -> substring match
- Graceful "not found" when nothing resolves

### Researcher Identity Injection

When `researcher_id` is provided in the request:

- The researcher's profile is looked up (name, role, assigned projects)
- Context is injected into the system prompt for personalised responses
- The agent can say "Based on your access to PRJ001..." rather than generic responses
- Restricted datasets enforce project-level access: you must be assigned to the relevant project

---

## Assumptions

1. **Synthetic data only** - all datasets are synthetic/mock; no real patient data is accessed
2. **Single-user session** - the MCP server runs one session at a time (production would need per-request sessions)
3. **OpenAI availability** - requires internet access to OpenAI API; no offline fallback
4. **Trusted network** - the REST API has no authentication; production would need JWT/OAuth
5. **Assessment scale** - 20 datasets, 20 projects, 15 researchers; data is loaded into memory on startup

---

## Observability

Every request produces a full audit record containing:

- **trace_id** - unique request identifier
- **tools_invoked** - each tool called with arguments, duration, success/failure, iteration number
- **timing breakdown** - LLM thinking time vs tool execution time vs overhead
- **token_usage** - prompt/completion/total tokens + estimated USD cost
- **governance checks** - which policies were evaluated and their results
- **decision_chain** - human-readable trace of the agent's reasoning
- **errors** - any failures with tool name, message, and timestamp

Audit records are retrievable via `GET /audit/:traceId` after the request completes.

---

## Project Structure

```
.
├── Dockerfile
├── docker-compose.yml
├── mcp-server/
│   ├── data/
│   │   ├── datasets.json             # 20 research datasets
│   │   ├── projects.json             # 20 research projects
│   │   ├── researchers.json          # 15 researchers with roles
│   │   └── sample_query_results.json # Sample query output
│   └── src/
│       ├── index.ts                  # MCP server (stdio entry)
│       ├── http-server.ts            # MCP server (HTTP/SSE entry)
│       ├── types.ts
│       ├── data.ts                   # Data loading & transformation
│       ├── data-access.ts            # Schema, columns, previews
│       ├── governance.ts             # Policy registry & enforcement
│       ├── validation.ts             # Query validation logic
│       └── tools/
│           ├── index.ts              # Tool registry
│           ├── research.ts           # Project & dataset discovery
│           ├── data-exploration.ts   # Preview, columns, explain
│           └── governance.ts         # Audit, rate limit, policies
└── agent/
    └── src/
        ├── api.ts                    # REST API (Express)
        ├── agent.ts                  # ReAct loop + observability
        ├── mcp-client.ts             # MCP client (stdio transport)
        ├── index.ts                  # Interactive CLI
        └── run.ts                    # Single-question JSON runner
```

---

## Limitations

- No persistent storage - audit records lost on restart
- Single concurrent session - not horizontally scalable without session management
- No authentication on the API - relies on network-level security
- LLM latency - responses take 3-10 seconds depending on tool call depth
- Cost - each query costs ~$0.01-0.05 in OpenAI API fees

---

## Future Improvements

- Real database (PostgreSQL) for persistent data and audit
- Authentication via JWT mapping to researcher profiles
- Streaming responses showing tool calls in real-time via SSE
- Multi-LLM fallback chain (GPT-4o -> Claude -> local model)
- Vector search for semantic dataset discovery
- Integration tests for automated end-to-end pipeline validation
- Horizontal scaling with Redis-backed session management

---

## Environment Variables

| Variable          | Required | Default                      | Description               |
| ----------------- | -------- | ---------------------------- | ------------------------- |
| `OPENAI_API_KEY`  | Yes      | -                            | OpenAI API key            |
| `OPENAI_MODEL`    | No       | `gpt-4o`                     | LLM model                 |
| `API_PORT`        | No       | `3002`                       | REST API port             |
| `API_HOST`        | No       | `0.0.0.0`                    | Bind address              |
| `MCP_SERVER_PATH` | No       | `../mcp-server/src/index.ts` | Path to MCP server        |
| `MAX_ITERATIONS`  | No       | `10`                         | Max agent loop iterations |
| `LOG_LEVEL`       | No       | `info`                       | Logging verbosity         |
