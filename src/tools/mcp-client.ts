import { spawn, type ChildProcess } from "child_process";
import { createInterface, type Interface } from "readline";
import * as os from "os";

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

export type McpToolDefinition = {
  name: string;
  description?: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
};

type ListToolsResult = {
  tools: McpToolDefinition[];
};

type CallToolResult = {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
};

export class McpClient {
  private process: ChildProcess | null = null;
  private reader: Interface | null = null;
  private nextId = 1;
  private pendingRequests = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private buffer = "";

  constructor(
    private readonly serverName: string,
    private readonly command: string,
    private readonly args: string[] = [],
    private readonly env?: Record<string, string>
  ) {}

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const childEnv = {
        ...process.env,
        ...this.env,
      };

      const isWindows = os.platform() === "win32";

      if (isWindows) {
        // On Windows, .cmd files require shell: true to be spawned.
        // Build a single command string so cmd.exe handles quoting correctly.
        const cmd = [this.command + ".cmd", ...this.args].join(" ");
        this.process = spawn(cmd, [], {
          stdio: ["pipe", "pipe", "pipe"],
          env: childEnv,
          shell: true,
          windowsHide: true,
        });
      } else {
        this.process = spawn(this.command, this.args, {
          stdio: ["pipe", "pipe", "pipe"],
          env: childEnv,
        });
      }

      this.process.on("error", (err) => {
        reject(new Error(`Failed to start MCP server "${this.serverName}" (${this.command}): ${err.message}`));
      });

      this.process.on("exit", (code) => {
        const error = new Error(`MCP server "${this.serverName}" exited with code ${code}`);
        for (const [, pending] of this.pendingRequests) {
          pending.reject(error);
        }
        this.pendingRequests.clear();
      });

      if (this.process.stderr) {
        this.process.stderr.on("data", (_data: Buffer) => {
          // MCP servers log to stderr; we ignore for now
        });
      }

      this.reader = createInterface({ input: this.process.stdout! });
      this.reader.on("line", (line: string) => {
        this.handleLine(line);
      });

      // Send initialize request (MCP protocol handshake)
      this.sendRequest("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "deepcode-cli", version: "0.1.0" },
      })
        .then(() => {
          // Send initialized notification
          this.sendNotification("notifications/initialized");
          resolve();
        })
        .catch(reject);
    });
  }

  async listTools(): Promise<McpToolDefinition[]> {
    const result = (await this.sendRequest("tools/list", {})) as ListToolsResult;
    return result.tools ?? [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    return (await this.sendRequest("tools/call", { name, arguments: args })) as CallToolResult;
  }

  disconnect(): void {
    if (this.reader) {
      this.reader.close();
      this.reader = null;
    }
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
  }

  private sendRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const request: JsonRpcRequest = {
        jsonrpc: "2.0",
        id,
        method,
        params,
      };
      this.pendingRequests.set(id, { resolve, reject });
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
      const message = JSON.parse(line) as JsonRpcResponse;
      if (message.id !== undefined && this.pendingRequests.has(message.id)) {
        const pending = this.pendingRequests.get(message.id)!;
        this.pendingRequests.delete(message.id);
        if (message.error) {
          pending.reject(new Error(`MCP error: ${message.error.message}`));
        } else {
          pending.resolve(message.result);
        }
      }
    } catch {
      // Ignore unparseable lines
    }
  }
}
