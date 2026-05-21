import { spawn, type ChildProcess } from "child_process";
import { createInterface, type Interface } from "readline";
import * as os from "os";
import * as path from "path";
import { killProcessTree } from "../common/process-tree";

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

export class McpClient {
  private process: ChildProcess | null = null;
  private reader: Interface | null = null;
  private nextId = 1;
  private pendingRequests = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
  >();
  private stderrBuffer = "";
  private notificationHandler: McpNotificationHandler | null = null;
  private disconnectHandler: ((reason: string) => void) | null = null;
  private intentionallyDisconnected = false;

  constructor(
    private readonly serverName: string,
    private readonly command: string,
    private readonly args: string[] = [],
    private readonly env?: Record<string, string>,
    onNotification?: McpNotificationHandler,
    onDisconnect?: (reason: string) => void
  ) {
    this.notificationHandler = onNotification ?? null;
    this.disconnectHandler = onDisconnect ?? null;
  }

  async connect(timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.intentionallyDisconnected = false;
      const childEnv = {
        ...process.env,
        ...this.env,
      };
      const args = this.withNpxYesArg(this.command, this.args);

      const isWindows = os.platform() === "win32";

      if (isWindows) {
        // On Windows, shell: true lets cmd.exe resolve the command via
        // PATHEXT (npx → npx.cmd, etc.) without blindly appending .cmd,
        // which would break absolute paths like process.execPath.
        this.process = spawn(this.command, args, {
          stdio: ["pipe", "pipe", "pipe"],
          env: childEnv,
          shell: true,
          windowsHide: true,
        });
      } else {
        this.process = spawn(this.command, args, {
          stdio: ["pipe", "pipe", "pipe"],
          env: childEnv,
        });
      }

      let resolved = false;
      const safeReject = (err: Error) => {
        if (!resolved) {
          resolved = true;
          reject(err);
        }
      };

      this.process.on("error", (err) => {
        safeReject(
          this.withStderr(`Failed to start MCP server "${this.serverName}" (${this.command}): ${err.message}`)
        );
      });

      this.process.on("close", (code) => {
        const reason = `MCP server "${this.serverName}" exited with code ${code}`;
        const error = this.withStderr(reason);
        for (const [, pending] of this.pendingRequests) {
          clearTimeout(pending.timer);
          pending.reject(error);
        }
        this.pendingRequests.clear();
        this.reader?.close();
        this.reader = null;
        this.process = null;
        if (!this.intentionallyDisconnected && this.disconnectHandler) {
          this.disconnectHandler(reason);
        }
        safeReject(error);
      });

      if (this.process.stderr) {
        this.process.stderr.on("data", (data: Buffer) => {
          this.appendStderr(data.toString("utf8"));
        });
      }

      this.reader = createInterface({ input: this.process.stdout! });
      this.reader.on("line", (line: string) => {
        this.handleLine(line);
      });

      // Send initialize request (MCP protocol handshake)
      this.sendRequest(
        "initialize",
        {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "deepcode-cli", version: "0.1.0" },
        },
        timeoutMs
      )
        .then((result) => {
          // Validate protocol version from server response (per MCP spec §4.2.1.2)
          const initResult = result as { protocolVersion?: string } | undefined;
          const serverVersion = initResult?.protocolVersion;
          if (serverVersion && serverVersion !== "2025-03-26" && serverVersion !== "2024-11-05") {
            reject(
              new Error(
                `Unsupported MCP protocol version "${serverVersion}" from server "${this.serverName}". ` +
                  `Client supports 2025-03-26 and 2024-11-05.`
              )
            );
            return;
          }
          // Send initialized notification
          this.sendNotification("notifications/initialized");
          resolve();
        })
        .catch(reject);
    });
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

    throw this.withStderr(`MCP server "${this.serverName}" returned too many tools/list pages`);
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

    throw this.withStderr(`MCP server "${this.serverName}" returned too many prompts/list pages`);
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

    throw this.withStderr(`MCP server "${this.serverName}" returned too many resources/list pages`);
  }

  async readResource(uri: string, timeoutMs = 30_000): Promise<ReadResourceResult> {
    return (await this.sendRequest("resources/read", { uri }, timeoutMs)) as ReadResourceResult;
  }

  disconnect(): void {
    this.intentionallyDisconnected = true;
    if (this.reader) {
      this.reader.close();
      this.reader = null;
    }
    if (this.process) {
      if (typeof this.process.pid === "number") {
        killProcessTree(this.process.pid, "SIGTERM", { killGroupOnNonWindows: false });
      } else {
        this.process.kill();
      }
      this.process = null;
    }
  }

  isConnected(): boolean {
    return this.process !== null && this.process.exitCode === null;
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
          this.withStderr(
            `Timed out after ${timeoutMs}ms waiting for MCP server "${this.serverName}" to respond to ${method}`
          )
        );
      }, timeoutMs);
      this.pendingRequests.set(id, { resolve, reject, timer });
      this.writeLine(JSON.stringify(request));
    });
  }

  private sendNotification(method: string, params?: Record<string, unknown>): void {
    const notification = {
      jsonrpc: "2.0" as const,
      method,
      params,
    };
    this.writeLine(JSON.stringify(notification));
  }

  private writeLine(data: string): void {
    if (this.process?.stdin) {
      this.process.stdin.write(data + "\n");
    }
  }

  private handleLine(line: string): void {
    try {
      const parsed: unknown = JSON.parse(line);

      // Handle JSON-RPC batch (array of requests/notifications/responses)
      // Per MCP 2025-03-26 §4.1.1.3: implementations MUST support receiving batches.
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && typeof item === "object") {
            this.handleSingleMessage(item);
          }
        }
        return;
      }

      // Handle single message
      if (parsed && typeof parsed === "object") {
        this.handleSingleMessage(parsed);
      }
    } catch {
      // Ignore unparseable lines
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
        pending.reject(this.withStderr(`MCP error: ${message.error.message}`));
      } else {
        pending.resolve(message.result);
      }
    }
  }

  private withNpxYesArg(command: string, args: string[]): string[] {
    const executable = path
      .basename(command)
      .toLowerCase()
      .replace(/\.cmd$/, "");
    if (executable !== "npx") {
      return args;
    }
    if (args.includes("-y") || args.includes("--yes")) {
      return args;
    }
    return ["-y", ...args];
  }

  private appendStderr(text: string): void {
    this.stderrBuffer = `${this.stderrBuffer}${text}`;
    if (this.stderrBuffer.length > 4000) {
      this.stderrBuffer = this.stderrBuffer.slice(-4000);
    }
  }

  private withStderr(message: string): Error {
    const stderr = this.stderrBuffer.trim();
    return new Error(stderr ? `${message}. stderr: ${stderr}` : message);
  }
}
