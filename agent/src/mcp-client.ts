// ─── NHS Research Agent - MCP Client ─────────────────────────────────────────
// Connects to the NHS Research MCP Server via stdio transport and exposes
// tool discovery and invocation methods for the agent.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface MCPToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

export class MCPClient {
  private client: Client;
  private transport: StdioClientTransport | null = null;
  private connected = false;

  constructor() {
    this.client = new Client({ name: "nhs-research-agent", version: "1.0.0" }, { capabilities: {} });
  }

  /**
   * Connect to the MCP server via stdio transport.
   */
  async connect(): Promise<void> {
    if (this.connected) return;

    const serverPath = process.env.MCP_SERVER_PATH ?? resolve(__dirname, "../../mcp-server/src/index.ts");

    this.transport = new StdioClientTransport({
      command: "npx",
      args: ["tsx", serverPath],
      env: {
        ...process.env,
        MCP_USER_ID: process.env.MCP_USER_ID ?? "diana",
        MCP_USERNAME: process.env.MCP_USERNAME ?? "diana.fitzgerald@nhs-research.uk",
        MCP_DISPLAY_NAME: process.env.MCP_DISPLAY_NAME ?? "Diana Fitzgerald",
      },
    });

    await this.client.connect(this.transport);
    this.connected = true;
  }

  /**
   * Disconnect from the MCP server.
   */
  async disconnect(): Promise<void> {
    if (!this.connected) return;
    await this.client.close();
    this.connected = false;
  }

  /**
   * List all available tools from the MCP server.
   */
  async listTools(): Promise<MCPTool[]> {
    if (!this.connected) throw new Error("Not connected to MCP server");

    const response = await this.client.listTools();
    return response.tools.map(tool => ({
      name: tool.name,
      description: tool.description ?? "",
      inputSchema: tool.inputSchema as Record<string, unknown>,
    }));
  }

  /**
   * Call a tool on the MCP server with given arguments.
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<MCPToolResult> {
    if (!this.connected) throw new Error("Not connected to MCP server");

    const result = await this.client.callTool({ name, arguments: args });
    return {
      content: result.content as Array<{ type: string; text: string }>,
      isError: result.isError as boolean | undefined,
    };
  }

  /**
   * List available resources from the MCP server.
   */
  async listResources(): Promise<Array<{ uri: string; name: string }>> {
    if (!this.connected) throw new Error("Not connected to MCP server");

    const response = await this.client.listResources();
    return response.resources.map(r => ({
      uri: r.uri,
      name: r.name,
    }));
  }

  /**
   * Read a resource from the MCP server.
   */
  async readResource(uri: string): Promise<string> {
    if (!this.connected) throw new Error("Not connected to MCP server");

    const response = await this.client.readResource({ uri });
    const textContent = response.contents.find(c => c.mimeType === "text/plain" || !c.mimeType);
    return (textContent as { text?: string })?.text ?? "";
  }

  get isConnected(): boolean {
    return this.connected;
  }
}
