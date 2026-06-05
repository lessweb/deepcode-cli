import * as fs from "fs";
import * as path from "path";
import type { DeepcodingSettings, PermissionScope, PermissionSettings } from "../settings";
import { isAbsoluteFilePath, normalizeFilePath } from "./state";

export type BashPermissionScope = Exclude<PermissionScope, "mcp"> | "unknown";

export type PermissionDecision = "allow" | "deny" | "ask";

export type UserToolPermission = {
  toolCallId: string;
  permission: "allow" | "deny";
};

export type MessageToolPermission = {
  toolCallId: string;
  permission: PermissionDecision;
};

export type AskPermissionScope = PermissionScope | "unknown";

export type AskPermissionRequest = {
  toolCallId: string;
  scopes: AskPermissionScope[];
  name: string;
  command: string;
  description?: string;
};

export type PermissionToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type PermissionToolExecution = {
  toolCallId: string;
  content: string;
  result: {
    ok: boolean;
    name: string;
    output?: string;
    error?: string;
    metadata?: Record<string, unknown>;
    awaitUserResponse?: boolean;
    followUpMessages?: Array<{ role: "system"; content: string; contentParams?: unknown | null }>;
  };
};

export type PermissionPlan = {
  permissions: MessageToolPermission[];
  askPermissions: AskPermissionRequest[];
};

export type ComputeToolCallPermissionsOptions = {
  sessionId: string;
  projectRoot: string;
  toolCalls: unknown[];
  settings?: Required<PermissionSettings>;
  readPermissionExemptPaths?: string[];
  resolveSnippetPath?: (sessionId: string, snippetId: string) => string | null | undefined;
};

export function parseToolCallForPermissions(toolCall: unknown): PermissionToolCall | null {
  if (!toolCall || typeof toolCall !== "object") {
    return null;
  }
  const record = toolCall as {
    id?: unknown;
    type?: unknown;
    function?: { name?: unknown; arguments?: unknown };
  };
  if (typeof record.id !== "string" || !record.function || typeof record.function !== "object") {
    return null;
  }
  if (typeof record.function.name !== "string") {
    return null;
  }
  return {
    id: record.id,
    type: "function",
    function: {
      name: record.function.name,
      arguments: typeof record.function.arguments === "string" ? record.function.arguments : "",
    },
  };
}

export function buildPermissionToolExecution(
  toolCall: PermissionToolCall,
  options: {
    permissionOverrides?: UserToolPermission[];
    messagePermissions?: MessageToolPermission[];
  }
): PermissionToolExecution | null {
  const permission = resolveToolCallPermission(toolCall.id, options);
  if (permission === "allow") {
    return null;
  }
  if (permission === "deny") {
    return buildSyntheticToolExecution(
      toolCall,
      "User denied the required permission for this tool call. Do not try to bypass this decision."
    );
  }
  return buildSyntheticToolExecution(
    toolCall,
    "The user has not authorized this tool call yet. Retry only if the permission is still necessary."
  );
}

export function resolveToolCallPermission(
  toolCallId: string,
  options: {
    permissionOverrides?: UserToolPermission[];
    messagePermissions?: MessageToolPermission[];
  }
): PermissionDecision {
  const override = options.permissionOverrides?.find((item) => item.toolCallId === toolCallId);
  if (override?.permission === "allow" || override?.permission === "deny") {
    return override.permission;
  }
  const messagePermission = options.messagePermissions?.find((item) => item.toolCallId === toolCallId);
  if (
    messagePermission?.permission === "allow" ||
    messagePermission?.permission === "deny" ||
    messagePermission?.permission === "ask"
  ) {
    return messagePermission.permission;
  }
  return "allow";
}

export function buildSyntheticToolExecution(toolCall: PermissionToolCall, error: string): PermissionToolExecution {
  const result = {
    ok: false,
    name: toolCall.function.name,
    error,
  };
  return {
    toolCallId: toolCall.id,
    content: JSON.stringify(result, null, 2),
    result,
  };
}

export function computeToolCallPermissions(options: ComputeToolCallPermissionsOptions): PermissionPlan {
  const permissions: MessageToolPermission[] = [];
  const askPermissions: AskPermissionRequest[] = [];

  for (const rawToolCall of options.toolCalls) {
    const toolCall = parseToolCallForPermissions(rawToolCall);
    if (!toolCall) {
      continue;
    }
    const request = describeToolPermissionRequest({
      sessionId: options.sessionId,
      projectRoot: options.projectRoot,
      toolCall,
      readPermissionExemptPaths: options.readPermissionExemptPaths,
      resolveSnippetPath: options.resolveSnippetPath,
    });
    const permission = evaluatePermissionScopes(request.scopes, options.settings);
    permissions.push({ toolCallId: toolCall.id, permission });
    if (permission === "ask") {
      const askScopes = getPermissionScopesRequiringAsk(request.scopes, options.settings);
      askPermissions.push({
        toolCallId: toolCall.id,
        scopes: askScopes.length > 0 ? askScopes : request.scopes,
        name: request.name,
        command: request.command,
        description: request.description,
      });
    }
  }

  return { permissions, askPermissions };
}

export function describeToolPermissionRequest(options: {
  sessionId: string;
  projectRoot: string;
  toolCall: PermissionToolCall;
  readPermissionExemptPaths?: string[];
  resolveSnippetPath?: (sessionId: string, snippetId: string) => string | null | undefined;
}): AskPermissionRequest {
  const name = options.toolCall.function.name;
  const args = parseToolArgumentsForPermissions(options.toolCall.function.arguments);

  if (name === "read" || name === "Read") {
    const filePath = typeof args.file_path === "string" ? args.file_path : "";
    return {
      toolCallId: options.toolCall.id,
      name,
      command: formatToolPathCommand("read", filePath),
      scopes:
        filePath && !isPathInAnyDirectory(options.projectRoot, filePath, options.readPermissionExemptPaths)
          ? [isPathInProject(options.projectRoot, filePath) ? "read-in-cwd" : "read-out-cwd"]
          : [],
    };
  }

  if (name === "write" || name === "Write") {
    const filePath = typeof args.file_path === "string" ? args.file_path : "";
    return {
      toolCallId: options.toolCall.id,
      name,
      command: formatToolPathCommand("write", filePath),
      scopes: filePath ? [isPathInProject(options.projectRoot, filePath) ? "write-in-cwd" : "write-out-cwd"] : [],
    };
  }

  if (name === "edit" || name === "Edit") {
    const filePath = resolveEditPermissionPath(options.sessionId, args, options.resolveSnippetPath);
    return {
      toolCallId: options.toolCall.id,
      name,
      command: formatToolPathCommand("edit", filePath),
      scopes: filePath
        ? [isPathInProject(options.projectRoot, filePath) ? "write-in-cwd" : "write-out-cwd"]
        : ["write-out-cwd"],
    };
  }

  if (name === "bash" || name === "Bash") {
    const command = typeof args.command === "string" ? args.command : "bash";
    const description = typeof args.description === "string" ? args.description : undefined;
    return {
      toolCallId: options.toolCall.id,
      name: "bash",
      command,
      description,
      scopes: parseBashSideEffects(args.sideEffects),
    };
  }

  if (name === "WebSearch") {
    const query = typeof args.query === "string" ? args.query : "WebSearch";
    return {
      toolCallId: options.toolCall.id,
      name,
      command: query,
      scopes: ["network"],
    };
  }

  if (name.startsWith("mcp__")) {
    return {
      toolCallId: options.toolCall.id,
      name,
      command: name,
      scopes: ["mcp"],
    };
  }

  return {
    toolCallId: options.toolCall.id,
    name,
    command: name,
    scopes: [],
  };
}

export function evaluatePermissionScopes(
  scopes: AskPermissionScope[],
  settings: Required<PermissionSettings> = {
    allow: [],
    deny: [],
    ask: [],
    defaultMode: "allowAll",
  }
): PermissionDecision {
  if (scopes.includes("unknown")) {
    return "ask";
  }
  if (scopes.length === 0) {
    return "allow";
  }
  const permissionScopes = scopes.filter((scope): scope is PermissionScope => scope !== "unknown");
  if (permissionScopes.some((scope) => settings.deny.includes(scope))) {
    return "deny";
  }
  if (permissionScopes.some((scope) => settings.ask.includes(scope))) {
    return "ask";
  }
  if (permissionScopes.every((scope) => settings.allow.includes(scope))) {
    return "allow";
  }
  return settings.defaultMode === "askAll" ? "ask" : "allow";
}

export function getPermissionScopesRequiringAsk(
  scopes: AskPermissionScope[],
  settings: Required<PermissionSettings> = {
    allow: [],
    deny: [],
    ask: [],
    defaultMode: "allowAll",
  }
): AskPermissionScope[] {
  const result: AskPermissionScope[] = [];
  for (const scope of scopes) {
    if (scope === "unknown") {
      result.push(scope);
      continue;
    }
    if (settings.deny.includes(scope)) {
      continue;
    }
    if (settings.ask.includes(scope)) {
      result.push(scope);
      continue;
    }
    if (settings.allow.includes(scope)) {
      continue;
    }
    if (settings.defaultMode === "askAll") {
      result.push(scope);
    }
  }
  return result;
}

export function parseBashSideEffects(value: unknown): AskPermissionScope[] {
  const validScopes = new Set<AskPermissionScope>([
    "read-in-cwd",
    "read-out-cwd",
    "write-in-cwd",
    "write-out-cwd",
    "delete-in-cwd",
    "delete-out-cwd",
    "query-git-log",
    "mutate-git-log",
    "network",
    "unknown",
  ]);
  if (!Array.isArray(value)) {
    return ["unknown"];
  }
  const scopes: AskPermissionScope[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !validScopes.has(item as AskPermissionScope)) {
      return ["unknown"];
    }
    const scope = item as AskPermissionScope;
    if (!scopes.includes(scope)) {
      scopes.push(scope);
    }
  }
  if (scopes.includes("unknown")) {
    return ["unknown"];
  }
  return scopes;
}

export function parseToolArgumentsForPermissions(rawArguments: string): Record<string, unknown> {
  if (!rawArguments) {
    return {};
  }
  try {
    const parsed = JSON.parse(rawArguments);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function resolveEditPermissionPath(
  sessionId: string,
  args: Record<string, unknown>,
  resolveSnippetPath?: (sessionId: string, snippetId: string) => string | null | undefined
): string {
  const filePath = typeof args.file_path === "string" ? args.file_path : "";
  if (filePath) {
    return filePath;
  }
  const snippetId = typeof args.snippet_id === "string" ? args.snippet_id : "";
  return snippetId ? (resolveSnippetPath?.(sessionId, snippetId) ?? "") : "";
}

export function formatToolPathCommand(toolName: string, filePath: string): string {
  return filePath ? `${toolName} ${filePath}` : toolName;
}

export function isPathInProject(projectRoot: string, filePath: string): boolean {
  const normalized = normalizeFilePath(filePath);
  const absolutePath = isAbsoluteFilePath(normalized) ? normalized : path.resolve(projectRoot, normalized);
  const relative = path.relative(path.resolve(projectRoot), path.resolve(absolutePath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function isPathInAnyDirectory(
  projectRoot: string,
  filePath: string,
  directories: string[] | undefined
): boolean {
  if (!directories?.length) {
    return false;
  }

  const normalized = normalizeFilePath(filePath);
  const absolutePath = isAbsoluteFilePath(normalized) ? normalized : path.resolve(projectRoot, normalized);
  for (const directory of directories) {
    const normalizedDirectory = normalizeFilePath(directory);
    const absoluteDirectory = isAbsoluteFilePath(normalizedDirectory)
      ? normalizedDirectory
      : path.resolve(projectRoot, normalizedDirectory);
    const relative = path.relative(path.resolve(absoluteDirectory), path.resolve(absolutePath));
    if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
      return true;
    }
  }
  return false;
}

export function hasUserPermissionReplies(value: { permissions?: unknown; alwaysAllows?: unknown }): boolean {
  return Boolean(
    (Array.isArray(value.permissions) && value.permissions.length > 0) ||
    (Array.isArray(value.alwaysAllows) && value.alwaysAllows.length > 0)
  );
}

export function appendProjectPermissionAllows(
  projectRoot: string,
  scopes: PermissionScope[] | undefined,
  options: { inheritedPermissions?: Required<PermissionSettings> } = {}
): void {
  if (!Array.isArray(scopes) || scopes.length === 0) {
    return;
  }
  const validScopes = new Set<PermissionScope>([
    "read-in-cwd",
    "read-out-cwd",
    "write-in-cwd",
    "write-out-cwd",
    "delete-in-cwd",
    "delete-out-cwd",
    "query-git-log",
    "mutate-git-log",
    "network",
    "mcp",
  ]);
  const nextScopes = scopes.filter((scope) => validScopes.has(scope));
  if (nextScopes.length === 0) {
    return;
  }
  const settingsPath = path.join(projectRoot, ".deepcode", "settings.json");
  let settings: DeepcodingSettings = {};
  try {
    if (fs.existsSync(settingsPath)) {
      const parsed = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        settings = parsed as DeepcodingSettings;
      }
    }
  } catch {
    settings = {};
  }

  const existingPermissions = settings.permissions;
  const permissions: PermissionSettings = existingPermissions
    ? { ...existingPermissions }
    : options.inheritedPermissions
      ? {
          allow: [...options.inheritedPermissions.allow],
          deny: [...options.inheritedPermissions.deny],
          ask: [...options.inheritedPermissions.ask],
          defaultMode: options.inheritedPermissions.defaultMode,
        }
      : {};

  const currentAllow = Array.isArray(permissions.allow) ? permissions.allow : [];
  const allow = [...currentAllow];
  for (const scope of nextScopes) {
    if (!allow.includes(scope)) {
      allow.push(scope);
    }
  }
  const currentDeny = Array.isArray(permissions.deny) ? permissions.deny : undefined;
  const currentAsk = Array.isArray(permissions.ask) ? permissions.ask : undefined;
  const deny = currentDeny ? currentDeny.filter((scope) => !nextScopes.includes(scope)) : permissions.deny;
  const ask = currentAsk ? currentAsk.filter((scope) => !nextScopes.includes(scope)) : permissions.ask;
  const changed =
    allow.length !== currentAllow.length ||
    (currentDeny ? (deny as PermissionScope[]).length !== currentDeny.length : false) ||
    (currentAsk ? (ask as PermissionScope[]).length !== currentAsk.length : false);
  if (existingPermissions && !changed) {
    return;
  }
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(
    settingsPath,
    `${JSON.stringify(
      {
        ...settings,
        permissions: {
          ...permissions,
          deny,
          ask,
          allow,
        },
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

export function normalizeAskPermissions(value: unknown): AskPermissionRequest[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const result: AskPermissionRequest[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const record = item as Record<string, unknown>;
    if (typeof record.toolCallId !== "string" || typeof record.name !== "string") {
      continue;
    }
    const scopes = Array.isArray(record.scopes)
      ? record.scopes.filter((scope): scope is AskPermissionScope => isAskPermissionScope(scope))
      : [];
    result.push({
      toolCallId: record.toolCallId,
      scopes,
      name: record.name,
      command: typeof record.command === "string" ? record.command : record.name,
      description: typeof record.description === "string" ? record.description : undefined,
    });
  }
  return result.length > 0 ? result : undefined;
}

export function isAskPermissionScope(value: unknown): value is AskPermissionScope {
  return (
    value === "read-in-cwd" ||
    value === "read-out-cwd" ||
    value === "write-in-cwd" ||
    value === "write-out-cwd" ||
    value === "delete-in-cwd" ||
    value === "delete-out-cwd" ||
    value === "query-git-log" ||
    value === "mutate-git-log" ||
    value === "network" ||
    value === "mcp" ||
    value === "unknown"
  );
}
