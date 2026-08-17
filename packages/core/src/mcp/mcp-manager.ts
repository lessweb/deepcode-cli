import { createHash } from "crypto";
import {
  McpClient,
  type McpToolDefinition,
  type McpPromptDefinition,
  type McpResourceDefinition,
} from "./mcp-client";
import { McpHttpClient } from "./mcp-http-client";
import type { McpServerConfig } from "../settings";

const MCP_STARTUP_TIMEOUT_MS = process.env.DEEPCODE_MCP_TIMEOUT
  ? parseInt(process.env.DEEPCODE_MCP_TIMEOUT, 10)
  : 30_000;
const MCP_CALL_TOOL_TIMEOUT_MS = 60_000;
const API_TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;
const API_TOOL_NAME_MAX_LENGTH = 64;

type McpToolEntry = {
  serverName: string;
  originalName: string;
  namespacedName: string;
  definition: McpToolDefinition;
  client: McpClient | McpHttpClient;
};

export type McpServerStatus = {
  name: string;
  status: "starting" | "ready" | "failed" | "reconnecting";
  connected: boolean;
  error?: string;
  deferred?: boolean;
  toolCount: number;
  tools: string[];
  promptCount: number;
  prompts: string[];
  resourceCount: number;
  resources: string[];
};

export type McpInitFailure = {
  name: string;
  error: string;
};

function buildMcpNamespacedName(
  serverName: string,
  toolName: string,
  usedNames: ReadonlySet<string> = new Set()
): string {
  const rawName = buildRawMcpNamespacedName(serverName, toolName);
  const sanitizedName = `mcp__${sanitizeApiToolNamePart(serverName)}__${sanitizeApiToolNamePart(toolName)}`;
  let candidate = fitApiToolName(sanitizedName, rawName);
  if (!usedNames.has(candidate)) {
    return candidate;
  }

  const hash = hashToolName(rawName);
  candidate = fitApiToolNameWithSuffix(sanitizedName, `_${hash}`);
  if (!usedNames.has(candidate)) {
    return candidate;
  }

  for (let index = 2; ; index += 1) {
    candidate = fitApiToolNameWithSuffix(sanitizedName, `_${hash}_${index}`);
    if (!usedNames.has(candidate)) {
      return candidate;
    }
  }
}

/**
 * Module-level pool of spawned stdio MCP clients keyed by (command,args,env).
 * Lets several managers / sessions in the same process reuse one spawned
 * server instead of re-spawning the same python/node process every time.
 */
const pooledMcpClients = new Map<string, McpClient>();

function mcpSpawnKey(config: McpServerConfig): string {
  return JSON.stringify([config.command, config.args ?? [], config.env ?? {}]);
}

function configHash(config: McpServerConfig): string {
  return createHash("sha256").update(JSON.stringify(config)).digest("hex").slice(0, 16);
}

function filterTools(tools: McpToolDefinition[], config: McpServerConfig): McpToolDefinition[] {
  if (config.enabledTools && config.enabledTools.length > 0) {
    const allow = new Set(config.enabledTools);
    tools = tools.filter((t) => allow.has(t.name));
  }
  if (config.disabledTools && config.disabledTools.length > 0) {
    const deny = new Set(config.disabledTools);
    tools = tools.filter((t) => !deny.has(t.name));
  }
  return tools;
}

export class McpManager {
  private clients: Array<McpClient | McpHttpClient> = [];
  private tools: McpToolEntry[] = [];
  private prompts: Array<{
    serverName: string;
    namespacedName: string;
    definition: McpPromptDefinition;
    client: McpClient | McpHttpClient;
  }> = [];
  private resources: Array<{
    serverName: string;
    namespacedName: string;
    definition: McpResourceDefinition;
    client: McpClient | McpHttpClient;
  }> = [];
  private initialized = false;
  private disposed = false;
  private configuredServerNames: string[] = [];
  private configHashes: Record<string, string> = {};
  private deferredServers = new Set<string>();
  private serverStatuses: McpServerStatus[] = [];
  private onToolsListChanged: (() => void) | null = null;
  private onStatusChanged: (() => void) | null = null;
  private serverConfigs: Record<string, McpServerConfig> = {};

  prepare(servers?: Record<string, McpServerConfig>): void {
    if (!servers || Object.keys(servers).length === 0) return;
    this.disposed = false;

    for (const name of Object.keys(servers)) {
      if (!this.configuredServerNames.includes(name)) {
        this.configuredServerNames.push(name);
      }
      if (this.serverStatuses.some((status) => status.name === name)) {
        continue;
      }
      this.setStatus({
        name,
        status: "starting",
        connected: false,
        ...(servers[name]?.deferLoading ? { deferred: true } : {}),
        toolCount: 0,
        tools: [],
        promptCount: 0,
        prompts: [],
        resourceCount: 0,
        resources: [],
      });
    }
  }

  /**
   * Connect all configured (non-deferred) MCP servers. Serial like before, but:
   * - per-server connectTimeoutMs (P0-3)
   * - required servers fail startup, optional ones just report (P0-3)
   * - deferLoading servers are skipped here and connect lazily (P0-1)
   * - failures are returned as a summary for the caller to surface (P1-6)
   */
  async initialize(servers?: Record<string, McpServerConfig>): Promise<McpInitFailure[]> {
    if (this.initialized || this.disposed) return [];
    this.initialized = true;

    if (!servers || Object.keys(servers).length === 0) return [];

    this.serverConfigs = servers;
    this.prepare(servers);

    const failures: McpInitFailure[] = [];
    for (const [name, config] of Object.entries(servers)) {
      if (this.disposed) break;
      this.configHashes[name] = configHash(config);
      if (config.deferLoading) {
        this.deferredServers.add(name);
        continue;
      }
      try {
        await this.connectServer(name, config);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        failures.push({ name, error: message });
        if (config.required) {
          throw new Error(`Required MCP server "${name}" failed to initialize: ${message}`);
        }
      }
    }
    return failures;
  }

  async reconnect(name: string, config?: McpServerConfig): Promise<void> {
    if (this.disposed) return;
    const effectiveConfig = config ?? this.serverConfigs[name];
    if (!effectiveConfig) return;
    if (config) {
      this.serverConfigs[name] = config;
      this.configHashes[name] = configHash(config);
      if (config.deferLoading) {
        this.deferredServers.add(name);
      } else {
        this.deferredServers.delete(name);
      }
    }

    this.setStatus({
      name,
      status: "reconnecting",
      connected: false,
      error: "Reconnecting...",
      toolCount: 0,
      tools: [],
      promptCount: 0,
      prompts: [],
      resourceCount: 0,
      resources: [],
    });

    try {
      await this.connectServer(name, effectiveConfig);
    } catch {
      // status is already marked failed inside connectServer
    }
  }

  /**
   * Reconcile the configured servers against a (possibly changed) config map.
   * New/changed servers are connected, removed ones are disconnected. Used for
   * hot reload without restarting the process (P1-5).
   */
  async refreshServers(servers?: Record<string, McpServerConfig>): Promise<McpInitFailure[]> {
    if (this.disposed) return [];
    if (!servers) return [];

    const nextNames = new Set(Object.keys(servers));
    for (const name of [...this.configuredServerNames]) {
      if (!nextNames.has(name)) {
        this.disconnectServer(name);
      }
    }

    this.serverConfigs = servers;
    const failures: McpInitFailure[] = [];
    for (const [name, config] of Object.entries(servers)) {
      const nextHash = configHash(config);
      const changed = this.configHashes[name] !== nextHash;
      this.configHashes[name] = nextHash;
      if (config.deferLoading) {
        this.deferredServers.add(name);
        continue;
      }
      this.deferredServers.delete(name);
      if (!changed && this.isConnected(name)) {
        continue;
      }
      try {
        await this.connectServer(name, config);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        failures.push({ name, error: message });
        if (config.required) {
          throw new Error(`Required MCP server "${name}" failed: ${message}`);
        }
      }
    }
    return failures;
  }

  /** Connect a server that is configured but not connected (lazy / deferred / crashed). */
  async ensureConnected(name: string): Promise<boolean> {
    if (this.disposed) return false;
    if (this.isConnected(name)) return true;
    const config = this.serverConfigs[name];
    if (!config) return false;
    try {
      await this.connectServer(name, config);
      return true;
    } catch {
      return false;
    }
  }

  private isConnected(name: string): boolean {
    return this.clients.some((c) => c.name === name && c.isConnected());
  }

  private disconnectServer(name: string): void {
    const client = this.clients.find((c) => c.name === name);
    if (client) {
      client.disconnect();
      this.clients = this.clients.filter((c) => c.name !== name);
    }
    // Drop any pooled stdio client we spawned for this server (its pid died
    // with disconnect above; a stale pooled entry would resurrect nothing).
    for (const [key, pooled] of pooledMcpClients) {
      if (pooled.name === name && !pooled.isConnected()) {
        pooledMcpClients.delete(key);
      }
    }
    this.tools = this.tools.filter((t) => t.serverName !== name);
    this.prompts = this.prompts.filter((p) => p.serverName !== name);
    this.resources = this.resources.filter((r) => r.serverName !== name);
    this.configuredServerNames = this.configuredServerNames.filter((n) => n !== name);
    this.deferredServers.delete(name);
    this.serverStatuses = this.serverStatuses.filter((s) => s.name !== name);
    this.onToolsListChanged?.();
  }

  private async connectServer(name: string, config: McpServerConfig): Promise<void> {
    if (this.disposed) return;

    // Clean up stale entries from previous connection attempts
    this.clients = this.clients.filter((c) => c.isConnected());
    this.tools = this.tools.filter((t) => t.serverName !== name);
    this.prompts = this.prompts.filter((p) => p.serverName !== name);
    this.resources = this.resources.filter((r) => r.serverName !== name);

    const timeout = config.connectTimeoutMs ?? MCP_STARTUP_TIMEOUT_MS;
    let client: McpClient | McpHttpClient | null = null;
    let pooled = false;
    try {
      if (config.url) {
        // Remote MCP (streamable-http/SSE)
        client = new McpHttpClient(name, config.url, config.headers, timeout);
        await client.connect();
        if (this.disposed) {
          client.disconnect();
          return;
        }
      } else {
        // stdio with reuse pool
        const key = mcpSpawnKey(config);
        const existing = pooledMcpClients.get(key);
        if (existing?.isConnected()) {
          client = existing;
          pooled = true;
        } else {
          client = new McpClient(
            name,
            config.command,
            config.args ?? [],
            config.env,
            (method) => {
              if (method === "notifications/tools/list_changed") {
                this.refreshServerTools(name, client!).catch(() => {});
              }
            },
            (reason) => {
              if (!this.disposed && this.serverConfigs[name]) {
                this.onServerCrash(name, reason);
              }
            }
          );
          await client.connect(timeout);
          pooledMcpClients.set(key, client);
        }
        if (this.disposed) {
          if (!pooled) client.disconnect();
          return;
        }
      }
      this.clients.push(client);

      const serverTools = filterTools(await client.listTools(timeout), config);
      if (this.disposed) return;
      const toolNamespacedNames: string[] = [];
      const usedToolNames = new Set(this.tools.map((tool) => tool.namespacedName));
      for (const tool of serverTools) {
        const namespacedName = buildMcpNamespacedName(name, tool.name, usedToolNames);
        usedToolNames.add(namespacedName);
        this.tools.push({
          serverName: name,
          originalName: tool.name,
          namespacedName,
          definition: tool,
          client,
        });
        toolNamespacedNames.push(namespacedName);
      }

      let serverPrompts: McpPromptDefinition[] = [];
      try {
        serverPrompts = await client.listPrompts(timeout);
      } catch {
        // server may not support prompts
      }
      if (this.disposed) return;
      const promptNamespacedNames: string[] = [];
      for (const prompt of serverPrompts) {
        const namespacedName = `mcp__${name}__${prompt.name}`;
        this.prompts.push({
          serverName: name,
          namespacedName,
          definition: prompt,
          client,
        });
        promptNamespacedNames.push(namespacedName);
      }

      let serverResources: McpResourceDefinition[] = [];
      try {
        serverResources = await client.listResources(timeout);
      } catch {
        // server may not support resources
      }
      if (this.disposed) return;
      const resourceNamespacedNames: string[] = [];
      for (const resource of serverResources) {
        const namespacedName = `mcp__${name}__${resource.name}`;
        this.resources.push({
          serverName: name,
          namespacedName,
          definition: resource,
          client,
        });
        resourceNamespacedNames.push(namespacedName);
      }

      this.setStatus({
        name,
        status: "ready",
        connected: true,
        toolCount: serverTools.length,
        tools: toolNamespacedNames,
        promptCount: serverPrompts.length,
        prompts: promptNamespacedNames,
        resourceCount: serverResources.length,
        resources: resourceNamespacedNames,
      });
    } catch (err) {
      client?.disconnect();
      const message = err instanceof Error ? err.message : String(err);
      this.setStatus({
        name,
        status: "failed",
        connected: false,
        error: message,
        toolCount: 0,
        tools: [],
        promptCount: 0,
        prompts: [],
        resourceCount: 0,
        resources: [],
      });
      throw err;
    }
  }

  private onServerCrash(name: string, reason: string): void {
    if (this.disposed) return;
    this.clients = this.clients.filter((c) => c.isConnected());
    this.tools = this.tools.filter((t) => t.serverName !== name);
    this.prompts = this.prompts.filter((p) => p.serverName !== name);
    this.resources = this.resources.filter((r) => r.serverName !== name);
    this.onToolsListChanged?.();
    this.setStatus({
      name,
      status: "failed",
      connected: false,
      error: reason,
      toolCount: 0,
      tools: [],
      promptCount: 0,
      prompts: [],
      resourceCount: 0,
      resources: [],
    });
  }

  getStatus(): McpServerStatus[] {
    const result = [...this.serverStatuses];
    const knownNames = new Set(result.map((s) => s.name));
    for (const name of this.configuredServerNames) {
      if (!knownNames.has(name)) {
        result.push({
          name,
          status: "starting",
          connected: false,
          ...(this.deferredServers.has(name) ? { deferred: true } : {}),
          toolCount: 0,
          tools: [],
          promptCount: 0,
          prompts: [],
          resourceCount: 0,
          resources: [],
        });
      }
    }
    return result;
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
        description: this.buildMcpToolDescription(t),
        parameters: {
          type: "object" as const,
          properties: t.definition.inputSchema.properties,
          required: t.definition.inputSchema.required,
          ...(t.definition.inputSchema.additionalProperties !== undefined
            ? { additionalProperties: t.definition.inputSchema.additionalProperties }
            : {}),
        },
      },
    }));
  }

  isMcpTool(name: string): boolean {
    return name.startsWith("mcp__");
  }

  private owningServerForName(name: string): string | null {
    if (!name.startsWith("mcp__")) return null;
    const rest = name.slice("mcp__".length);
    const sep = rest.indexOf("__");
    if (sep === -1) return null;
    const candidate = rest.slice(0, sep);
    if (this.serverConfigs[candidate]) {
      return candidate;
    }
    return null;
  }

  async executeMcpTool(
    name: string,
    args: Record<string, unknown>,
    timeoutMs = MCP_CALL_TOOL_TIMEOUT_MS
  ): Promise<{ ok: boolean; name: string; output?: string; error?: string }> {
    let tool = this.tools.find((t) => t.namespacedName === name);

    // Lazy connect (P0-1): if the owning server is configured but not yet
    // connected (deferred / crashed), bring it up and retry the lookup.
    if (!tool) {
      const serverName = this.owningServerForName(name);
      if (serverName && (await this.ensureConnected(serverName))) {
        tool = this.tools.find((t) => t.namespacedName === name);
      }
    }
    if (!tool) {
      return { ok: false, name, error: `Unknown MCP tool: ${name}` };
    }

    try {
      const result = await tool.client.callTool(tool.originalName, args, timeoutMs);
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

  async getMcpPrompt(
    name: string,
    args: Record<string, unknown>
  ): Promise<{ ok: boolean; name: string; output?: string; error?: string }> {
    let prompt = this.prompts.find((p) => p.namespacedName === name);
    if (!prompt) {
      const serverName = this.owningServerForName(name);
      if (serverName && (await this.ensureConnected(serverName))) {
        prompt = this.prompts.find((p) => p.namespacedName === name);
      }
    }
    if (!prompt) {
      return { ok: false, name, error: `Unknown MCP prompt: ${name}` };
    }

    try {
      const result = await prompt.client.getPrompt(prompt.definition.name, args);
      const text = result.messages
        .filter((m) => m.content.type === "text" && m.content.text)
        .map((m) => `[${m.role}] ${m.content.text}`)
        .join("\n");
      return {
        ok: true,
        name,
        output: text || JSON.stringify(result),
      };
    } catch (err) {
      return {
        ok: false,
        name,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async readMcpResource(
    name: string,
    uri: string
  ): Promise<{ ok: boolean; name: string; output?: string; error?: string }> {
    let resource = this.resources.find((r) => r.namespacedName === name);
    if (!resource) {
      const serverName = this.owningServerForName(name);
      if (serverName && (await this.ensureConnected(serverName))) {
        resource = this.resources.find((r) => r.namespacedName === name);
      }
    }
    if (!resource) {
      return { ok: false, name, error: `Unknown MCP resource: ${name}` };
    }

    try {
      const result = await resource.client.readResource(uri);
      const text = result.contents
        .filter((c) => c.text)
        .map((c) => c.text)
        .join("\n");
      return {
        ok: true,
        name,
        output: text || JSON.stringify(result.contents),
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
    this.disposed = true;
    for (const client of this.clients) {
      client.disconnect();
    }
    // Drop pooled entries we spawned; their processes were killed above.
    for (const [key, pooled] of pooledMcpClients) {
      if (!pooled.isConnected()) {
        pooledMcpClients.delete(key);
      }
    }
    this.clients = [];
    this.tools = [];
    this.prompts = [];
    this.resources = [];
    this.serverStatuses = [];
    this.configuredServerNames = [];
    this.configHashes = {};
    this.deferredServers.clear();
    this.serverConfigs = {};
    this.initialized = false;
  }

  private async refreshServerTools(serverName: string, client: McpClient | McpHttpClient): Promise<void> {
    const serverTools = await client.listTools(MCP_STARTUP_TIMEOUT_MS);
    this.tools = this.tools.filter((t) => t.serverName !== serverName);
    const toolNamespacedNames: string[] = [];
    const usedToolNames = new Set(this.tools.map((tool) => tool.namespacedName));
    for (const tool of serverTools) {
      const namespacedName = buildMcpNamespacedName(serverName, tool.name, usedToolNames);
      usedToolNames.add(namespacedName);
      this.tools.push({
        serverName,
        originalName: tool.name,
        namespacedName,
        definition: tool,
        client,
      });
      toolNamespacedNames.push(namespacedName);
    }
    const existing = this.serverStatuses.find((s) => s.name === serverName);
    if (existing) {
      existing.toolCount = serverTools.length;
      existing.tools = toolNamespacedNames;
    }
    this.onToolsListChanged?.();
  }

  setOnToolsListChanged(handler: () => void): void {
    this.onToolsListChanged = handler;
  }

  setOnStatusChanged(handler: () => void): void {
    this.onStatusChanged = handler;
  }

  private setStatus(status: McpServerStatus): void {
    if (this.disposed) return;
    const index = this.serverStatuses.findIndex((s) => s.name === status.name);
    if (index === -1) {
      this.serverStatuses.push(status);
    } else {
      this.serverStatuses[index] = status;
    }
    this.onStatusChanged?.();
  }

  private buildMcpToolDescription(tool: McpToolEntry): string {
    const description = tool.definition.description?.trim();
    const source = `${tool.serverName}: ${tool.originalName}`;
    if (!description) {
      return source;
    }
    if (tool.namespacedName === buildRawMcpNamespacedName(tool.serverName, tool.originalName)) {
      return description;
    }
    return `${description}\nMCP source: ${source}`;
  }
}

function buildRawMcpNamespacedName(serverName: string, toolName: string): string {
  return `mcp__${serverName}__${toolName}`;
}

function sanitizeApiToolNamePart(value: string): string {
  const sanitized = value.replace(/[^a-zA-Z0-9_-]/g, "_");
  return sanitized || "unnamed";
}

function fitApiToolName(name: string, rawName: string): string {
  if (API_TOOL_NAME_PATTERN.test(name) && name.length <= API_TOOL_NAME_MAX_LENGTH) {
    return name;
  }
  return fitApiToolNameWithSuffix(name, `_${hashToolName(rawName)}`);
}

function fitApiToolNameWithSuffix(name: string, suffix: string): string {
  const maxPrefixLength = API_TOOL_NAME_MAX_LENGTH - suffix.length;
  const prefix = name.slice(0, Math.max(1, maxPrefixLength));
  return `${prefix}${suffix}`;
}

function hashToolName(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 8);
}
