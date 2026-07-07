# ─── NHS Research Platform - Container Image ─────────────────────────────────
# Packages the MCP Server + AI Research Agent (REST API) into a single container.
#
# Build:  docker build -t nhs-research-agent .
# Run:    docker run -p 3002:3002 -e OPENAI_API_KEY=sk-... nhs-research-agent
# ──────────────────────────────────────────────────────────────────────────────

FROM node:22-slim

LABEL maintainer="NHS Regional Research Platform"
LABEL description="AI Research Agent with MCP Server for NHS Research & Analytics"

WORKDIR /app

# ─── Install MCP Server dependencies ─────────────────────────────────────────
COPY mcp-server/package.json mcp-server/package-lock.json* ./mcp-server/
RUN cd mcp-server && npm ci --omit=dev 2>/dev/null || npm install --omit=dev

# ─── Install Agent dependencies ──────────────────────────────────────────────
COPY agent/package.json agent/package-lock.json* ./agent/
RUN cd agent && npm ci --omit=dev 2>/dev/null || npm install --omit=dev

# ─── Install tsx globally for running TypeScript directly ────────────────────
RUN npm install -g tsx

# ─── Copy MCP Server source ─────────────────────────────────────────────────
COPY mcp-server/src ./mcp-server/src
COPY mcp-server/data ./mcp-server/data
COPY mcp-server/tsconfig.json ./mcp-server/

# ─── Copy Agent source ───────────────────────────────────────────────────────
COPY agent/src ./agent/src
COPY agent/tsconfig.json ./agent/

# ─── Environment defaults ────────────────────────────────────────────────────
ENV NODE_ENV=production
ENV API_PORT=3002
ENV API_HOST=0.0.0.0
ENV MCP_SERVER_PATH=/app/mcp-server/src/index.ts
ENV OPENAI_MODEL=gpt-4o
ENV MAX_ITERATIONS=10
ENV LOG_LEVEL=info

# ─── Expose the API port ────────────────────────────────────────────────────
EXPOSE 3002

# ─── Health check ────────────────────────────────────────────────────────────
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:3002/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

# ─── Start the Agent REST API (which spawns MCP server internally) ───────────
CMD ["tsx", "/app/agent/src/api.ts"]
