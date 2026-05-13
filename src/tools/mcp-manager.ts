import { McpClient, type McpToolDefinition } from "./mcp-client";
import type { McpServerConfig } from "../settings";

type McpToolEntry = {
  serverName: string;
  originalName: string;
  namespacedName: string;
  definition: McpToolDefinition;
  client: McpClient;
};

export type McpServerStatus = {
  name: string;
  connected: boolean;
  error?: string;
  toolCount: number;
  tools: string[];
};

export class McpManager {
  private clients: McpClient[] = [];
  private tools: McpToolEntry[] = [];
  private initialized = false;
  private serverStatuses: McpServerStatus[] = [];

  async initialize(servers?: Record<string, McpServerConfig>): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    if (!servers || Object.keys(servers).length === 0) return;

    const entries = Object.entries(servers);
    for (const [name, config] of entries) {
      try {
        const client = new McpClient(name, config.command, config.args ?? [], config.env);
        await client.connect();
        this.clients.push(client);

        const serverTools = await client.listTools();
        const toolNames: string[] = [];
        for (const tool of serverTools) {
          const namespacedName = `mcp__${name}__${tool.name}`;
          this.tools.push({
            serverName: name,
            originalName: tool.name,
            namespacedName,
            definition: tool,
            client,
          });
          toolNames.push(tool.name);
        }
        this.serverStatuses.push({
          name,
          connected: true,
          toolCount: serverTools.length,
          tools: toolNames,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[deepcode] MCP server "${name}" failed to initialize: ${message}\n`);
        this.serverStatuses.push({
          name,
          connected: false,
          error: message,
          toolCount: 0,
          tools: [],
        });
      }
    }
  }

  getStatus(): McpServerStatus[] {
    return this.serverStatuses;
  }

  getMcpToolDefinitions(): Array<{
    type: "function";
    function: {
      name: string;
      description: string;
      parameters: {
        type: "object";
        properties: Record<string, unknown>;
        required?: string[];
        additionalProperties?: boolean;
      };
    };
  }> {
    return this.tools.map((t) => ({
      type: "function" as const,
      function: {
        name: t.namespacedName,
        description: t.definition.description ?? `${t.serverName}: ${t.originalName}`,
        parameters: {
          type: "object" as const,
          properties: t.definition.inputSchema.properties,
          required: t.definition.inputSchema.required,
          additionalProperties: false,
        },
      },
    }));
  }

  isMcpTool(name: string): boolean {
    return name.startsWith("mcp__");
  }

  async executeMcpTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<{ ok: boolean; name: string; output?: string; error?: string }> {
    const tool = this.tools.find((t) => t.namespacedName === name);
    if (!tool) {
      return { ok: false, name, error: `Unknown MCP tool: ${name}` };
    }

    try {
      const result = await tool.client.callTool(tool.originalName, args);
      const text = result.content
        .filter((c) => c.type === "text" && c.text)
        .map((c) => c.text)
        .join("\n");
      return {
        ok: !result.isError,
        name,
        output: text || JSON.stringify(result.content),
      };
    } catch (err) {
      return {
        ok: false,
        name,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  disconnect(): void {
    for (const client of this.clients) {
      client.disconnect();
    }
    this.clients = [];
    this.tools = [];
    this.serverStatuses = [];
    this.initialized = false;
  }
}
