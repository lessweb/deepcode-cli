import type { McpServerConfig } from "../settings";
import type { McpTransport } from "./mcp-transport";
import { StdioTransport, createMcpSpawnSpec } from "./mcp-stdio-transport";
import { HttpTransport } from "./mcp-http-transport";

export { createMcpSpawnSpec };
export type { McpSpawnSpec } from "./mcp-stdio-transport";
export type { McpTransport } from "./mcp-transport";

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
};

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

type JsonRpcNotification = {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
};

export type McpToolDefinition = {
  name: string;
  description?: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
};

type ListToolsResult = {
  tools: McpToolDefinition[];
  nextCursor?: string;
};

type CallToolResult = {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
};

export type McpPromptArgument = {
  name: string;
  description?: string;
  required?: boolean;
};

export type McpPromptDefinition = {
  name: string;
  description?: string;
  arguments?: McpPromptArgument[];
};

type ListPromptsResult = {
  prompts: McpPromptDefinition[];
  nextCursor?: string;
};

export type McpPromptMessage = {
  role: "user" | "assistant";
  content: { type: string; text?: string };
};

type GetPromptResult = {
  description?: string;
  messages: McpPromptMessage[];
};

export type McpResourceDefinition = {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
};

type ListResourcesResult = {
  resources: McpResourceDefinition[];
  nextCursor?: string;
};

export type McpResourceContent = {
  uri: string;
  mimeType?: string;
  text?: string;
  blob?: string;
};

type ReadResourceResult = {
  contents: McpResourceContent[];
};

export type McpNotificationHandler = (method: string, params?: Record<string, unknown>) => void;

const PROTOCOL_VERSION = "2025-03-26";
const SUPPORTED_PROTOCOL_VERSIONS = new Set([PROTOCOL_VERSION, "2024-11-05"]);

/**
 * MCP JSON-RPC client. Owns request/response correlation, the initialize
 * handshake and notification dispatch; the underlying byte transport (stdio
 * subprocess or remote HTTP) is injected via {@link McpTransport}.
 */
export class McpClient {
  private nextId = 1;
  private pendingRequests = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
  >();
  private notificationHandler: McpNotificationHandler | null;
  private disconnectHandler: ((reason: string) => void) | null;
  private connected = false;

  constructor(
    private readonly serverName: string,
    private readonly transport: McpTransport,
    onNotification?: McpNotificationHandler,
    onDisconnect?: (reason: string) => void
  ) {
    this.notificationHandler = onNotification ?? null;
    this.disconnectHandler = onDisconnect ?? null;
  }

  async connect(timeoutMs: number): Promise<void> {
    await this.transport.start({
      onMessage: (message) => this.handleSingleMessage(message),
      onClose: (reason) => this.handleTransportClose(reason),
    });

    // MCP protocol handshake
    const result = await this.sendRequest(
      "initialize",
      {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "deepcode-cli", version: "0.1.0" },
      },
      timeoutMs
    );

    // Validate protocol version from server response (per MCP spec §4.2.1.2)
    const serverVersion = (result as { protocolVersion?: string } | undefined)?.protocolVersion;
    if (serverVersion && !SUPPORTED_PROTOCOL_VERSIONS.has(serverVersion)) {
      throw new Error(
        `Unsupported MCP protocol version "${serverVersion}" from server "${this.serverName}". ` +
          `Client supports ${[...SUPPORTED_PROTOCOL_VERSIONS].join(" and ")}.`
      );
    }

    this.sendNotification("notifications/initialized");
    this.connected = true;
  }

  async listTools(timeoutMs: number): Promise<McpToolDefinition[]> {
    const tools: McpToolDefinition[] = [];
    let cursor: string | undefined;

    for (let page = 0; page < 100; page++) {
      const params = cursor ? { cursor } : {};
      const result = (await this.sendRequest("tools/list", params, timeoutMs)) as ListToolsResult;
      tools.push(...(result.tools ?? []));
      cursor = typeof result.nextCursor === "string" && result.nextCursor ? result.nextCursor : undefined;
      if (!cursor) {
        return tools;
      }
    }

    throw this.transport.decorateError(`MCP server "${this.serverName}" returned too many tools/list pages`);
  }

  async callTool(name: string, args: Record<string, unknown>, timeoutMs = 60_000): Promise<CallToolResult> {
    return (await this.sendRequest("tools/call", { name, arguments: args }, timeoutMs)) as CallToolResult;
  }

  async listPrompts(timeoutMs: number): Promise<McpPromptDefinition[]> {
    const prompts: McpPromptDefinition[] = [];
    let cursor: string | undefined;

    for (let page = 0; page < 100; page++) {
      const params = cursor ? { cursor } : {};
      const result = (await this.sendRequest("prompts/list", params, timeoutMs)) as ListPromptsResult;
      prompts.push(...(result.prompts ?? []));
      cursor = typeof result.nextCursor === "string" && result.nextCursor ? result.nextCursor : undefined;
      if (!cursor) {
        return prompts;
      }
    }

    throw this.transport.decorateError(`MCP server "${this.serverName}" returned too many prompts/list pages`);
  }

  async getPrompt(name: string, args: Record<string, unknown>, timeoutMs = 30_000): Promise<GetPromptResult> {
    return (await this.sendRequest("prompts/get", { name, arguments: args }, timeoutMs)) as GetPromptResult;
  }

  async listResources(timeoutMs: number): Promise<McpResourceDefinition[]> {
    const resources: McpResourceDefinition[] = [];
    let cursor: string | undefined;

    for (let page = 0; page < 100; page++) {
      const params = cursor ? { cursor } : {};
      const result = (await this.sendRequest("resources/list", params, timeoutMs)) as ListResourcesResult;
      resources.push(...(result.resources ?? []));
      cursor = typeof result.nextCursor === "string" && result.nextCursor ? result.nextCursor : undefined;
      if (!cursor) {
        return resources;
      }
    }

    throw this.transport.decorateError(`MCP server "${this.serverName}" returned too many resources/list pages`);
  }

  async readResource(uri: string, timeoutMs = 30_000): Promise<ReadResourceResult> {
    return (await this.sendRequest("resources/read", { uri }, timeoutMs)) as ReadResourceResult;
  }

  disconnect(): void {
    this.connected = false;
    this.transport.close();
  }

  isConnected(): boolean {
    return this.connected && this.transport.isConnected();
  }

  private sendRequest(method: string, params: Record<string, unknown>, timeoutMs = 30_000): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const request: JsonRpcRequest = {
        jsonrpc: "2.0",
        id,
        method,
        params,
      };
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(
          this.transport.decorateError(
            `Timed out after ${timeoutMs}ms waiting for MCP server "${this.serverName}" to respond to ${method}`
          )
        );
      }, timeoutMs);
      this.pendingRequests.set(id, { resolve, reject, timer });
      this.transport.send(request);
    });
  }

  private sendNotification(method: string, params?: Record<string, unknown>): void {
    const notification: JsonRpcNotification = {
      jsonrpc: "2.0",
      method,
      params,
    };
    this.transport.send(notification);
  }

  private handleTransportClose(reason: string): void {
    const error = this.transport.decorateError(reason);
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pendingRequests.clear();

    // Only surface a crash once the server was fully connected; failures during
    // the initial handshake are reported via connect() rejecting instead.
    const wasConnected = this.connected;
    this.connected = false;
    if (wasConnected) {
      this.disconnectHandler?.(reason);
    }
  }

  private handleSingleMessage(msg: object): void {
    // Handle notifications (no id field — server-initiated)
    if (!("id" in msg)) {
      const notification = msg as unknown as JsonRpcNotification;
      if (this.notificationHandler && typeof notification.method === "string") {
        try {
          this.notificationHandler(notification.method, notification.params);
        } catch {
          // Swallow handler errors to avoid crashing the reader loop
        }
      }
      return;
    }

    // Handle responses to our requests
    const message = msg as unknown as JsonRpcResponse;
    if (message.id !== undefined && this.pendingRequests.has(message.id)) {
      const pending = this.pendingRequests.get(message.id)!;
      this.pendingRequests.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) {
        pending.reject(this.transport.decorateError(`MCP error: ${message.error.message}`));
      } else {
        pending.resolve(message.result);
      }
    }
  }
}

/**
 * Build an {@link McpClient} for a configured server, selecting the transport
 * from the config (remote Streamable HTTP when a `url`/`type: "http"` is given,
 * otherwise a local stdio subprocess).
 */
export function createMcpClient(
  serverName: string,
  config: McpServerConfig,
  onNotification?: McpNotificationHandler,
  onDisconnect?: (reason: string) => void
): McpClient {
  const isRemote = config.type === "http" || (config.type !== "stdio" && !!config.url);
  const transport: McpTransport = isRemote
    ? new HttpTransport(serverName, { url: config.url ?? "", headers: config.headers })
    : new StdioTransport(serverName, config.command ?? "", config.args ?? [], config.env);
  return new McpClient(serverName, transport, onNotification, onDisconnect);
}
