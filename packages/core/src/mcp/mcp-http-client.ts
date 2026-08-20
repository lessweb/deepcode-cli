import type {
  McpPromptDefinition,
  McpResourceDefinition,
  McpToolDefinition,
} from "./mcp-client";

/**
 * Minimal remote MCP client (streamable-http / SSE) for servers configured
 * with `url` instead of `command`. JSON-RPC over POST; tolerates both plain
 * JSON and `text/event-stream` responses. OAuth flows are not implemented —
 * a server that demands it will fail the handshake with a clear error.
 *
 * P2-7 from the CodeWhale learnings report.
 */
type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
};

type CallToolResult = {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
};

function parseSseLastEvent(text: string): unknown {
  const events = text.split(/\r?\n\r?\n/);
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const dataLine = events[i]
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("\n");
    if (dataLine) {
      try {
        return JSON.parse(dataLine);
      } catch {
        // keep scanning older events
      }
    }
  }
  throw new Error("MCP remote server returned no parseable SSE data event");
}

export class McpHttpClient {
  private nextId = 1;
  private initialized = false;
  private connected = false;

  constructor(
    private readonly serverName: string,
    private readonly url: string,
    private readonly headers: Record<string, string> = {},
    private readonly timeoutMs = 30_000
  ) {}

  /** Server name for manager bookkeeping. */
  get name(): string {
    return this.serverName;
  }

  async connect(): Promise<void> {
    const result = await this.request(
      "initialize",
      {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "deepcode-cli", version: "0.1.0" },
      },
      this.timeoutMs
    );
    const serverVersion = (result as { protocolVersion?: string } | undefined)?.protocolVersion;
    if (serverVersion && serverVersion !== "2025-03-26" && serverVersion !== "2024-11-05") {
      throw new Error(
        `Unsupported MCP protocol version "${serverVersion}" from remote server "${this.serverName}". ` +
          `Client supports 2025-03-26 and 2024-11-05.`
      );
    }
    this.initialized = true;
    this.connected = true;
  }

  async listTools(timeoutMs = this.timeoutMs): Promise<McpToolDefinition[]> {
    if (!this.initialized) await this.connect();
    const result = await this.request("tools/list", {}, timeoutMs);
    return (result as { tools?: McpToolDefinition[] })?.tools ?? [];
  }

  async callTool(name: string, args: Record<string, unknown>, timeoutMs = 60_000): Promise<CallToolResult> {
    if (!this.initialized) await this.connect();
    const result = await this.request("tools/call", { name, arguments: args }, timeoutMs);
    return result as CallToolResult;
  }

  async listPrompts(timeoutMs = this.timeoutMs): Promise<McpPromptDefinition[]> {
    if (!this.initialized) await this.connect();
    const result = await this.request("prompts/list", {}, timeoutMs);
    return (result as { prompts?: McpPromptDefinition[] })?.prompts ?? [];
  }

  async getPrompt(_name: string, _args: Record<string, unknown>): Promise<never> {
    throw new Error(`Remote MCP server "${this.serverName}" does not support prompts/get`);
  }

  async listResources(timeoutMs = this.timeoutMs): Promise<McpResourceDefinition[]> {
    if (!this.initialized) await this.connect();
    const result = await this.request("resources/list", {}, timeoutMs);
    return (result as { resources?: McpResourceDefinition[] })?.resources ?? [];
  }

  async readResource(_uri: string): Promise<never> {
    throw new Error(`Remote MCP server "${this.serverName}" does not support resources/read`);
  }

  isConnected(): boolean {
    return this.connected;
  }

  disconnect(): void {
    // Stateless HTTP transport: nothing to kill. Mark disconnected so a later
    // connect() re-runs the handshake.
    this.connected = false;
    this.initialized = false;
  }

  private async request(method: string, params: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let resp: Response;
    try {
      resp = await fetch(this.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          ...this.headers,
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: this.nextId++, method, params }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!resp.ok) {
      throw new Error(`MCP remote server "${this.serverName}" HTTP ${resp.status} (${this.url})`);
    }
    const contentType = resp.headers.get("content-type") ?? "";
    let payload: unknown;
    if (contentType.includes("text/event-stream")) {
      payload = parseSseLastEvent(await resp.text());
    } else {
      payload = await resp.json();
    }
    const message = payload as JsonRpcResponse;
    if (message.error) {
      throw new Error(`MCP error from "${this.serverName}": ${message.error.message}`);
    }
    return message.result;
  }
}
