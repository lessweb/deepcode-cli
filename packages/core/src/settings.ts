import { resolveHistorySettings, type HistorySettings, type ResolvedHistorySettings } from "./common/message-history";
import { DEEPSEEK_V4_MODELS, defaultsToThinkingMode, type MultimodalMode } from "./common/model-capabilities";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { compactBudget, validateCompactRetention } from "./common/compaction";
import { normalizePlusApiKey } from "./common/plus-subscription";

export type DeepcodingEnv = Record<string, string | undefined> & {
  MODEL?: string;
  BASE_URL?: string;
  API_KEY?: string;
  PLUS_API_KEY?: string;
  TEMPERATURE?: string;
  THINKING_ENABLED?: string;
  REASONING_EFFORT?: string;
  DEBUG_LOG_ENABLED?: string;
  TELEMETRY_ENABLED?: string;
  MULTIMODAL?: string;
};

export type ReasoningEffort = "low" | "high" | "max";

export type McpServerConfig = {
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

export type PermissionScope =
  | "read-in-cwd"
  | "read-in-tmp"
  | "read-out-cwd"
  | "write-in-cwd"
  | "write-in-tmp"
  | "write-out-cwd"
  | "delete-in-cwd"
  | "delete-out-cwd"
  | "query-git-log"
  | "mutate-git-log"
  | "network"
  | "mcp";

export type PermissionDefaultMode = "allowAll" | "askAll";

export type PermissionSettings = {
  allow?: PermissionScope[];
  deny?: PermissionScope[];
  ask?: PermissionScope[];
  defaultMode?: PermissionDefaultMode;
  addWorkingDirs?: string[];
};

export type EnabledSkillsSettings = Record<string, boolean>;

export type StatusLineProviderConfig =
  | {
      type: "command";
      id?: string;
      command: string;
      cwd?: string;
      timeoutMs?: number;
      color?: string;
      newLine?: boolean;
      maxLength?: number;
    }
  | {
      type: "module";
      id?: string;
      path: string;
      timeoutMs?: number;
      color?: string;
      newLine?: boolean;
      maxLength?: number;
    };

export type StatusLineSettings = {
  enabled?: boolean;
  refreshMs?: number;
  separator?: string;
  providers?: StatusLineProviderConfig[];
};

export type ResolvedStatusLineSettings = {
  enabled: boolean;
  refreshMs: number;
  separator: string;
  providers: StatusLineProviderConfig[];
};

export type ReasoningSummaryMode = "on" | "off";

export type ExperimentalSettings = {
  reasoningSummary?: ReasoningSummaryMode;
  reasoningSummaryModel?: string;
};

export type ResolvedExperimentalSettings = Required<ExperimentalSettings>;

export type DeepcodingSettings = {
  experimental?: ExperimentalSettings;
  history?: HistorySettings;
  env?: DeepcodingEnv;
  contextWindow?: number | string;
  autoCompactWindow?: number | string;
  retainRatio?: number;
  retainTokens?: number;
  model?: string;
  temperature?: number;
  thinkingEnabled?: boolean;
  reasoningEffort?: ReasoningEffort;
  debugLogEnabled?: boolean;
  telemetryEnabled?: boolean;
  notify?: string;
  webSearchTool?: string;
  deepseekSearchApiEnabled?: boolean;
  multimodal?: MultimodalMode;
  filesApiEnabled?: boolean;
  filesApiTimeoutMs?: number;
  fileExpiresAfterSeconds?: number;
  fileRefreshMarginSeconds?: number;
  fileQuotaCleanupBatch?: number;
  maxRequestFilesBytes?: number;
  mcpServers?: Record<string, McpServerConfig>;
  permissions?: PermissionSettings;
  enabledSkills?: EnabledSkillsSettings;
  statusline?: StatusLineSettings;
};

export type ResolvedDeepcodingSettings = {
  experimental: ResolvedExperimentalSettings;
  history: ResolvedHistorySettings;
  env: Record<string, string>;
  apiKey?: string;
  baseURL: string;
  model: string;
  contextWindow: number;
  autoCompactWindow: number;
  retainRatio?: number;
  retainTokens?: number;
  temperature?: number;
  thinkingEnabled: boolean;
  reasoningEffort: ReasoningEffort;
  debugLogEnabled: boolean;
  telemetryEnabled: boolean;
  notify?: string;
  webSearchTool?: string;
  deepseekSearchApiEnabled: boolean;
  multimodal: MultimodalMode;
  filesApiEnabled: boolean;
  filesApiTimeoutMs: number;
  fileExpiresAfterSeconds: number;
  fileRefreshMarginSeconds: number;
  fileQuotaCleanupBatch: number;
  maxRequestFilesBytes: number;
  mcpServers?: Record<string, McpServerConfig>;
  permissions: Required<PermissionSettings>;
  enabledSkills: EnabledSkillsSettings;
  statusline: ResolvedStatusLineSettings;
};

export type ModelConfigSelection = {
  model: string;
  thinkingEnabled: boolean;
  reasoningEffort: ReasoningEffort;
};

export type SettingsTarget = "project" | "user";

export type SettingsProcessEnv = Record<string, string | undefined>;

const DEFAULT_CONTEXT_WINDOW = 256 * 1024;
const DEEPSEEK_V4_CONTEXT_WINDOW = 1024 * 1024;
export const DEFAULT_FILES_API_TIMEOUT_MS = 60_000;
export const DEFAULT_FILE_EXPIRES_AFTER_SECONDS = 7 * 24 * 60 * 60;
export const DEFAULT_FILE_REFRESH_MARGIN_SECONDS = 60 * 60;
export const DEFAULT_FILE_QUOTA_CLEANUP_BATCH = 100;
export const DEFAULT_MAX_REQUEST_FILES_BYTES = 128 * 1024 * 1024;
export const MAX_FILES_API_TIMEOUT_MS = 10 * 60 * 1000;

export function getDefaultContextWindow(model: string): number {
  return DEEPSEEK_V4_MODELS.has(model) ? DEEPSEEK_V4_CONTEXT_WINDOW : DEFAULT_CONTEXT_WINDOW;
}

export function getDefaultAutoCompactWindow(model: string): number {
  return Math.floor(getDefaultContextWindow(model) * 0.8);
}

function parseTokenWindow(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? value : undefined;
  }
  if (typeof value !== "string") {
    return undefined;
  }

  const match = /^(\d+)([km])$/i.exec(value.trim());
  if (!match) {
    return undefined;
  }
  const amount = Number(match[1]);
  const multiplier = match[2]?.toLowerCase() === "m" ? 1024 * 1024 : 1024;
  const tokens = amount * multiplier;
  return Number.isSafeInteger(tokens) && tokens > 0 ? tokens : undefined;
}

function resolveReasoningSummaryMode(value: unknown): ReasoningSummaryMode | undefined {
  return value === "on" || value === "off" ? value : undefined;
}

function resolveReasoningEffort(value: unknown): ReasoningEffort | undefined {
  return value === "low" || value === "high" || value === "max" ? value : undefined;
}

function resolveMultimodalMode(value: unknown): MultimodalMode | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "default" || normalized === "on" || normalized === "off") {
    return normalized;
  }
  return undefined;
}

function parseBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "enabled", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "disabled", "no", "off"].includes(normalized)) {
    return false;
  }
  return undefined;
}

function parseTemperature(value: unknown): number | undefined {
  const raw = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  if (!Number.isFinite(raw) || raw < 0 || raw > 2) {
    return undefined;
  }
  return raw;
}

function parseIntegerInRange(value: unknown, minimum: number, maximum: number): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum
    ? value
    : undefined;
}

function trimString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export const PERMISSION_SCOPES: readonly PermissionScope[] = [
  "read-in-cwd",
  "read-in-tmp",
  "read-out-cwd",
  "write-in-cwd",
  "write-in-tmp",
  "write-out-cwd",
  "delete-in-cwd",
  "delete-out-cwd",
  "query-git-log",
  "mutate-git-log",
  "network",
  "mcp",
];

const VALID_PERMISSION_SCOPES = new Set(PERMISSION_SCOPES);

function normalizePermissionList(value: unknown): PermissionScope[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const result: PermissionScope[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !VALID_PERMISSION_SCOPES.has(item as PermissionScope)) {
      continue;
    }
    const scope = item as PermissionScope;
    if (!result.includes(scope)) {
      result.push(scope);
    }
  }
  return result;
}

function mergePermissionLists(...lists: Array<PermissionScope[] | undefined>): PermissionScope[] {
  const result: PermissionScope[] = [];
  for (const list of lists) {
    for (const scope of list ?? []) {
      if (!result.includes(scope)) {
        result.push(scope);
      }
    }
  }
  return result;
}

function normalizeWorkingDirectories(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const result: string[] = [];
  for (const item of value) {
    const directory = trimString(item);
    if (directory && !result.includes(directory)) {
      result.push(directory);
    }
  }
  return result;
}

function normalizePermissionDefaultMode(value: unknown): PermissionDefaultMode | undefined {
  return value === "allowAll" || value === "askAll" ? value : undefined;
}

function normalizePermissions(settings: PermissionSettings | null | undefined): Required<PermissionSettings> {
  return {
    allow: normalizePermissionList(settings?.allow),
    deny: normalizePermissionList(settings?.deny),
    ask: normalizePermissionList(settings?.ask),
    defaultMode: normalizePermissionDefaultMode(settings?.defaultMode) ?? "allowAll",
    addWorkingDirs: normalizeWorkingDirectories(settings?.addWorkingDirs),
  };
}

export function mergePermissions(
  userSettings: DeepcodingSettings | null | undefined,
  projectSettings: DeepcodingSettings | null | undefined
): Required<PermissionSettings> {
  const userPermissions = normalizePermissions(userSettings?.permissions);
  const projectPermissions = normalizePermissions(projectSettings?.permissions);
  return {
    allow: mergePermissionLists(userPermissions.allow, projectPermissions.allow),
    deny: mergePermissionLists(userPermissions.deny, projectPermissions.deny),
    ask: mergePermissionLists(userPermissions.ask, projectPermissions.ask),
    addWorkingDirs: [...new Set([...userPermissions.addWorkingDirs, ...projectPermissions.addWorkingDirs])],
    defaultMode: projectSettings?.permissions
      ? projectPermissions.defaultMode
      : userSettings?.permissions
        ? userPermissions.defaultMode
        : "allowAll",
  };
}

function normalizeEnabledSkills(value: unknown): EnabledSkillsSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const result: EnabledSkillsSettings = {};
  for (const [name, enabled] of Object.entries(value)) {
    if (!name || typeof enabled !== "boolean") {
      continue;
    }
    result[name] = enabled;
  }
  return result;
}

function mergeEnabledSkills(
  userSettings: DeepcodingSettings | null | undefined,
  projectSettings: DeepcodingSettings | null | undefined
): EnabledSkillsSettings {
  return {
    ...normalizeEnabledSkills(userSettings?.enabledSkills),
    ...normalizeEnabledSkills(projectSettings?.enabledSkills),
  };
}

const DEFAULT_STATUSLINE_REFRESH_MS = 2000;
const MIN_STATUSLINE_REFRESH_MS = 500;
const DEFAULT_STATUSLINE_SEPARATOR = " · ";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeStatusLineProvider(value: unknown): StatusLineProviderConfig | null {
  if (!isPlainObject(value)) {
    return null;
  }
  const type = value["type"];
  const idRaw = trimString(value["id"]);
  const id = idRaw || undefined;
  const timeoutRaw = value["timeoutMs"];
  const timeoutMs =
    typeof timeoutRaw === "number" && Number.isFinite(timeoutRaw) && timeoutRaw > 0
      ? Math.floor(timeoutRaw)
      : undefined;
  const colorRaw = trimString(value["color"]);
  const color = colorRaw || undefined;
  const maxLengthRaw = value["maxLength"];
  const maxLength =
    typeof maxLengthRaw === "number" && Number.isFinite(maxLengthRaw) && maxLengthRaw > 0
      ? Math.floor(maxLengthRaw)
      : undefined;
  const newLine = value["newLine"] === true ? true : undefined;

  if (type === "command") {
    const command = trimString(value["command"]);
    if (!command) {
      return null;
    }
    const cwdRaw = trimString(value["cwd"]);
    return {
      type: "command",
      id,
      command,
      cwd: cwdRaw || undefined,
      timeoutMs,
      color,
      newLine,
      maxLength,
    };
  }
  if (type === "module") {
    const modulePath = trimString(value["path"]);
    if (!modulePath) {
      return null;
    }
    return {
      type: "module",
      id,
      path: modulePath,
      timeoutMs,
      color,
      newLine,
      maxLength,
    };
  }
  return null;
}

function normalizeStatusLine(value: unknown): StatusLineSettings | null {
  if (!isPlainObject(value)) {
    return null;
  }
  const result: StatusLineSettings = {};
  const enabled = parseBoolean(value["enabled"]);
  if (enabled !== undefined) {
    result.enabled = enabled;
  }
  const refreshRaw = value["refreshMs"];
  if (typeof refreshRaw === "number" && Number.isFinite(refreshRaw) && refreshRaw >= MIN_STATUSLINE_REFRESH_MS) {
    result.refreshMs = Math.floor(refreshRaw);
  }
  const separator = value["separator"];
  if (typeof separator === "string") {
    result.separator = separator;
  }
  const providers = value["providers"];
  if (Array.isArray(providers)) {
    const normalized: StatusLineProviderConfig[] = [];
    for (const entry of providers) {
      const provider = normalizeStatusLineProvider(entry);
      if (provider) {
        normalized.push(provider);
      }
    }
    result.providers = normalized;
  }
  return result;
}

function mergeStatusLine(
  userSettings: DeepcodingSettings | null | undefined,
  projectSettings: DeepcodingSettings | null | undefined
): ResolvedStatusLineSettings {
  const userConfig = normalizeStatusLine(userSettings?.statusline) ?? {};
  const projectConfig = normalizeStatusLine(projectSettings?.statusline) ?? {};
  const userProviders = userConfig.providers ?? [];
  const projectProviders = projectConfig.providers ?? [];
  const projectIds = new Set(projectProviders.map((p) => p.id));
  const providers = [...userProviders.filter((p) => !projectIds.has(p.id)), ...projectProviders];
  const enabled = projectConfig.enabled ?? userConfig.enabled ?? providers.length > 0;
  const refreshMs = projectConfig.refreshMs ?? userConfig.refreshMs ?? DEFAULT_STATUSLINE_REFRESH_MS;
  const separator = projectConfig.separator ?? userConfig.separator ?? DEFAULT_STATUSLINE_SEPARATOR;
  return {
    enabled,
    refreshMs,
    separator,
    providers,
  };
}

function normalizeEnv(env: DeepcodingSettings["env"]): Record<string, string> {
  const result: Record<string, string> = {};
  if (!env) {
    return result;
  }

  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") {
      result[key] = value;
    }
  }
  return result;
}

export function collectDeepcodeEnv(processEnv: SettingsProcessEnv = process.env): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(processEnv)) {
    if (!key.startsWith("DEEPCODE_") || typeof value !== "string") {
      continue;
    }
    const strippedKey = key.slice("DEEPCODE_".length);
    if (strippedKey) {
      result[strippedKey] = value;
    }
  }
  return result;
}

function extractMcpEnv(env: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith("MCP_")) {
      continue;
    }
    const strippedKey = key.slice("MCP_".length);
    if (strippedKey) {
      result[strippedKey] = value;
    }
  }
  return result;
}

function mergeMcpServers(
  userSettings: DeepcodingSettings | null | undefined,
  projectSettings: DeepcodingSettings | null | undefined,
  userEnv: Record<string, string>,
  projectEnv: Record<string, string>,
  systemEnv: Record<string, string>
): Record<string, McpServerConfig> | undefined {
  const userServers = userSettings?.mcpServers ?? {};
  const projectServers = projectSettings?.mcpServers ?? {};
  const serverNames = new Set([...Object.keys(userServers), ...Object.keys(projectServers)]);
  if (serverNames.size === 0) {
    return undefined;
  }

  const userMcpEnv = extractMcpEnv(userEnv);
  const projectMcpEnv = extractMcpEnv(projectEnv);
  const systemMcpEnv = extractMcpEnv(systemEnv);
  const merged: Record<string, McpServerConfig> = {};

  for (const name of serverNames) {
    const userConfig = userServers[name];
    const projectConfig = projectServers[name];
    const command = projectConfig?.command ?? userConfig?.command;
    if (!command) {
      continue;
    }

    const env = {
      ...userEnv,
      ...(userConfig?.env ?? {}),
      ...userMcpEnv,
      ...projectEnv,
      ...(projectConfig?.env ?? {}),
      ...projectMcpEnv,
      ...systemEnv,
      ...systemMcpEnv,
    };
    const config: McpServerConfig = {
      command,
      args: projectConfig?.args ?? userConfig?.args,
    };
    if (Object.keys(env).length > 0) {
      config.env = env;
    }
    merged[name] = config;
  }

  return Object.keys(merged).length > 0 ? merged : undefined;
}

/** Origins use user/project field paths, environment names, or a built-in default. */
export type SettingsTrace = {
  sources: Record<string, string[]>;
  ignored: Array<{ field: string; source: string }>;
};

function traceMergedSettings(
  trace: SettingsTrace,
  user: DeepcodingSettings | null | undefined,
  project: DeepcodingSettings | null | undefined,
  userEnv: Record<string, string>,
  projectEnv: Record<string, string>,
  systemEnv: Record<string, string>
): void {
  const record = (field: string, sources: string[]) => {
    trace.sources[field] = sources.length ? sources : ["default"];
  };
  const layers = [
    ["user", user],
    ["project", project],
  ] as const;
  for (const [layer, settings] of layers) {
    const ignored = (field: string) => trace.ignored.push({ field, source: `${layer}.${field}` });
    const permissions = settings?.permissions;
    if (permissions?.defaultMode !== undefined && normalizePermissionDefaultMode(permissions.defaultMode) === undefined)
      ignored("permissions.defaultMode");
    for (const field of ["allow", "deny", "ask"] as const) {
      const raw = permissions?.[field];
      if (raw !== undefined && (!Array.isArray(raw) || raw.some((value) => !VALID_PERMISSION_SCOPES.has(value))))
        ignored(`permissions.${field}`);
    }
    if (
      permissions?.addWorkingDirs !== undefined &&
      (!Array.isArray(permissions.addWorkingDirs) || permissions.addWorkingDirs.some((value) => !trimString(value)))
    )
      ignored("permissions.addWorkingDirs");
    for (const [name, enabled] of Object.entries(settings?.enabledSkills ?? {}))
      if (!name || typeof enabled !== "boolean") ignored(`enabledSkills.${name}`);
    const status = settings?.statusline;
    const normalized = normalizeStatusLine(status);
    for (const key of ["enabled", "refreshMs", "separator"] as const)
      if (status?.[key] !== undefined && normalized?.[key] === undefined) ignored(`statusline.${key}`);
    if (status?.providers !== undefined) {
      if (!Array.isArray(status.providers)) ignored("statusline.providers");
      else
        status.providers.forEach((provider, index) => {
          if (!normalizeStatusLineProvider(provider)) ignored(`statusline.providers.${index}`);
        });
    }
  }
  const permissions = mergePermissions(user, project);
  for (const field of ["allow", "deny", "ask", "addWorkingDirs"] as const) {
    permissions[field].forEach((value, index) =>
      record(
        `permissions.${field}.${index}`,
        layers
          .filter(([, settings]) => (normalizePermissions(settings?.permissions)[field] as string[]).includes(value))
          .map(([layer]) => `${layer}.permissions.${field}`)
      )
    );
    if (!permissions[field].length) record(`permissions.${field}`, []);
  }
  record("permissions.defaultMode", [
    project?.permissions
      ? normalizePermissionDefaultMode(project.permissions.defaultMode) !== undefined
        ? "project.permissions.defaultMode"
        : "default"
      : normalizePermissionDefaultMode(user?.permissions?.defaultMode) !== undefined
        ? "user.permissions.defaultMode"
        : "default",
  ]);
  for (const key of Object.keys(mergeEnabledSkills(user, project))) {
    record(`enabledSkills.${key}`, [
      `${key in normalizeEnabledSkills(project?.enabledSkills) ? "project" : "user"}.enabledSkills.${key}`,
    ]);
  }
  const userStatus = normalizeStatusLine(user?.statusline) ?? {};
  const projectStatus = normalizeStatusLine(project?.statusline) ?? {};
  for (const key of ["enabled", "refreshMs", "separator"] as const) {
    record(`statusline.${key}`, [
      projectStatus[key] !== undefined
        ? `project.statusline.${key}`
        : userStatus[key] !== undefined
          ? `user.statusline.${key}`
          : key === "enabled"
            ? "derived from statusline.providers"
            : "default",
    ]);
  }
  const projectIds = new Set((projectStatus.providers ?? []).map((provider) => provider.id));
  let index = 0;
  for (const [layer, settings] of layers) {
    for (const [sourceIndex, raw] of (Array.isArray(settings?.statusline?.providers)
      ? settings.statusline.providers
      : []
    ).entries()) {
      const provider = normalizeStatusLineProvider(raw);
      if (!provider || (layer === "user" && projectIds.has(provider.id))) continue;
      record(`statusline.providers.${index++}`, [`${layer}.statusline.providers.${sourceIndex}`]);
    }
  }
  const servers = mergeMcpServers(user, project, userEnv, projectEnv, systemEnv) ?? {};
  for (const [name, config] of Object.entries(servers)) {
    for (const key of ["command", "args"] as const) {
      if (config[key] !== undefined)
        record(`mcpServers.${name}.${key}`, [
          `${project?.mcpServers?.[name]?.[key] != null ? "project" : "user"}.mcpServers.${name}.${key}`,
        ]);
    }
    const origins: Record<string, string> = {};
    for (const [layer, env, direct] of [
      ["user", userEnv, user?.mcpServers?.[name]?.env],
      ["project", projectEnv, project?.mcpServers?.[name]?.env],
      ["environment", systemEnv, undefined],
    ] as const) {
      for (const key of Object.keys(env))
        origins[key] = layer === "environment" ? `environment.${key}` : `${layer}.env.${key}`;
      for (const key of Object.keys(direct ?? {})) origins[key] = `${layer}.mcpServers.${name}.env.${key}`;
      for (const key of Object.keys(extractMcpEnv(env)))
        origins[key] = layer === "environment" ? `environment.MCP_${key}` : `${layer}.env.MCP_${key}`;
    }
    for (const [key, source] of Object.entries(origins)) record(`mcpServers.${name}.env.${key}`, [source]);
  }
}

export function resolveSettingsSources(
  userSettings: DeepcodingSettings | null | undefined,
  projectSettings: DeepcodingSettings | null | undefined,
  defaults: { model: string; baseURL: string },
  processEnv: SettingsProcessEnv = process.env,
  trace?: SettingsTrace
): ResolvedDeepcodingSettings {
  const choose = <T>(field: string, candidates: Array<[string, T | undefined]>, fallback: T): T => {
    const selected = candidates.find(([, value]) => value !== undefined);
    if (trace) {
      trace.sources[field] = [selected?.[0] ?? "default"];
      for (const [source, value] of candidates) {
        const [layer, ...keys] = source.split(".");
        let raw: unknown = layer === "environment" ? systemEnv : layer === "project" ? projectSettings : userSettings;
        for (const key of keys)
          raw = raw && typeof raw === "object" ? (raw as Record<string, unknown>)[key] : undefined;
        if (raw !== undefined && value === undefined) trace.ignored.push({ field, source });
      }
    }
    return selected ? selected[1]! : fallback;
  };
  const userEnv = normalizeEnv(userSettings?.env);
  const projectEnv = normalizeEnv(projectSettings?.env);
  const systemEnv = collectDeepcodeEnv(processEnv);
  const env = {
    ...userEnv,
    ...projectEnv,
    ...systemEnv,
  };
  // Select before normalizing so invalid configured values cannot silently fall back.
  const plusKey =
    systemEnv.PLUS_API_KEY !== undefined
      ? systemEnv.PLUS_API_KEY
      : projectSettings?.env?.PLUS_API_KEY !== undefined
        ? projectSettings.env.PLUS_API_KEY
        : userSettings?.env?.PLUS_API_KEY;
  if (plusKey !== undefined) {
    if (trace)
      trace.sources["env.PLUS_API_KEY"] = [
        systemEnv.PLUS_API_KEY !== undefined
          ? "environment.PLUS_API_KEY"
          : projectSettings?.env?.PLUS_API_KEY !== undefined
            ? "project.env.PLUS_API_KEY"
            : "user.env.PLUS_API_KEY",
      ];
    env.PLUS_API_KEY = normalizePlusApiKey(plusKey, "settings env.PLUS_API_KEY")!;
  }

  const model = choose(
    "model",
    [
      ["environment.MODEL", trimString(systemEnv.MODEL) || undefined],
      ["project.model", trimString(projectSettings?.model) || undefined],
      ["project.env.MODEL", trimString(projectEnv.MODEL) || undefined],
      ["user.model", trimString(userSettings?.model) || undefined],
      ["user.env.MODEL", trimString(userEnv.MODEL) || undefined],
    ],
    defaults.model
  );
  const baseURL = trimString(env.BASE_URL) || defaults.baseURL;

  const contextWindow = choose(
    "contextWindow",
    [
      ["environment.CONTEXT_WINDOW", parseTokenWindow(systemEnv.CONTEXT_WINDOW)],
      ["project.contextWindow", parseTokenWindow(projectSettings?.contextWindow)],
      ["user.contextWindow", parseTokenWindow(userSettings?.contextWindow)],
    ],
    getDefaultContextWindow(model)
  );
  const configuredAutoCompactWindow = choose(
    "autoCompactWindow",
    [
      ["environment.AUTO_COMPACT_WINDOW", parseTokenWindow(systemEnv.AUTO_COMPACT_WINDOW)],
      ["project.autoCompactWindow", parseTokenWindow(projectSettings?.autoCompactWindow)],
      ["user.autoCompactWindow", parseTokenWindow(userSettings?.autoCompactWindow)],
    ],
    undefined
  );
  const defaultAutoCompactWindow = Math.max(1, Math.floor(contextWindow * 0.8));
  const autoCompactWindow = Math.min(configuredAutoCompactWindow ?? defaultAutoCompactWindow, contextWindow);
  validateCompactRetention(userSettings ?? {});
  validateCompactRetention(projectSettings ?? {});
  const retention =
    projectSettings?.retainRatio !== undefined || projectSettings?.retainTokens !== undefined
      ? projectSettings
      : userSettings;
  const retainTokens = retention?.retainTokens;
  const retainRatio = retainTokens === undefined ? (retention?.retainRatio ?? 0.16) : undefined;
  compactBudget(contextWindow, autoCompactWindow, { retainRatio, retainTokens });

  const thinkingEnabled = choose(
    "thinkingEnabled",
    [
      ["environment.THINKING_ENABLED", parseBoolean(systemEnv.THINKING_ENABLED)],
      ["project.thinkingEnabled", parseBoolean(projectSettings?.thinkingEnabled)],
      ["project.env.THINKING_ENABLED", parseBoolean(projectEnv.THINKING_ENABLED)],
      ["user.thinkingEnabled", parseBoolean(userSettings?.thinkingEnabled)],
      ["user.env.THINKING_ENABLED", parseBoolean(userEnv.THINKING_ENABLED)],
    ],
    defaultsToThinkingMode(model)
  );

  const reasoningEffort = choose(
    "reasoningEffort",
    [
      ["environment.REASONING_EFFORT", resolveReasoningEffort(systemEnv.REASONING_EFFORT)],
      ["project.reasoningEffort", resolveReasoningEffort(projectSettings?.reasoningEffort)],
      ["project.env.REASONING_EFFORT", resolveReasoningEffort(projectEnv.REASONING_EFFORT)],
      ["user.reasoningEffort", resolveReasoningEffort(userSettings?.reasoningEffort)],
      ["user.env.REASONING_EFFORT", resolveReasoningEffort(userEnv.REASONING_EFFORT)],
    ],
    "max"
  );

  const temperature = choose(
    "temperature",
    [
      ["environment.TEMPERATURE", parseTemperature(systemEnv.TEMPERATURE)],
      ["project.temperature", parseTemperature(projectSettings?.temperature)],
      ["project.env.TEMPERATURE", parseTemperature(projectEnv.TEMPERATURE)],
      ["user.temperature", parseTemperature(userSettings?.temperature)],
      ["user.env.TEMPERATURE", parseTemperature(userEnv.TEMPERATURE)],
    ],
    undefined
  );

  const debugLogEnabled = choose(
    "debugLogEnabled",
    [
      ["environment.DEBUG_LOG_ENABLED", parseBoolean(systemEnv.DEBUG_LOG_ENABLED)],
      ["project.debugLogEnabled", parseBoolean(projectSettings?.debugLogEnabled)],
      ["project.env.DEBUG_LOG_ENABLED", parseBoolean(projectEnv.DEBUG_LOG_ENABLED)],
      ["user.debugLogEnabled", parseBoolean(userSettings?.debugLogEnabled)],
      ["user.env.DEBUG_LOG_ENABLED", parseBoolean(userEnv.DEBUG_LOG_ENABLED)],
    ],
    false
  );

  const telemetryEnabled = choose(
    "telemetryEnabled",
    [
      ["environment.TELEMETRY_ENABLED", parseBoolean(systemEnv.TELEMETRY_ENABLED)],
      ["project.telemetryEnabled", parseBoolean(projectSettings?.telemetryEnabled)],
      ["project.env.TELEMETRY_ENABLED", parseBoolean(projectEnv.TELEMETRY_ENABLED)],
      ["user.telemetryEnabled", parseBoolean(userSettings?.telemetryEnabled)],
      ["user.env.TELEMETRY_ENABLED", parseBoolean(userEnv.TELEMETRY_ENABLED)],
    ],
    true
  );

  const notify = choose(
    "notify",
    [
      ["environment.NOTIFY", trimString(systemEnv.NOTIFY) || undefined],
      ["project.notify", trimString(projectSettings?.notify) || undefined],
      ["user.notify", trimString(userSettings?.notify) || undefined],
    ],
    ""
  );
  const webSearchTool = choose(
    "webSearchTool",
    [
      ["environment.WEB_SEARCH_TOOL", trimString(systemEnv.WEB_SEARCH_TOOL) || undefined],
      ["project.webSearchTool", trimString(projectSettings?.webSearchTool) || undefined],
      ["user.webSearchTool", trimString(userSettings?.webSearchTool) || undefined],
    ],
    ""
  );

  const reasoningSummary = choose<ReasoningSummaryMode>(
    "experimental.reasoningSummary",
    [
      [
        "project.experimental.reasoningSummary",
        resolveReasoningSummaryMode(projectSettings?.experimental?.reasoningSummary),
      ],
      ["user.experimental.reasoningSummary", resolveReasoningSummaryMode(userSettings?.experimental?.reasoningSummary)],
    ],
    "off"
  );
  const reasoningSummaryModel = choose(
    "experimental.reasoningSummaryModel",
    [
      [
        "project.experimental.reasoningSummaryModel",
        trimString(projectSettings?.experimental?.reasoningSummaryModel) || undefined,
      ],
      [
        "user.experimental.reasoningSummaryModel",
        trimString(userSettings?.experimental?.reasoningSummaryModel) || undefined,
      ],
    ],
    "deepseek-flash"
  );

  const deepseekSearchApiEnabled = choose(
    "deepseekSearchApiEnabled",
    [
      ["project.deepseekSearchApiEnabled", parseBoolean(projectSettings?.deepseekSearchApiEnabled)],
      ["user.deepseekSearchApiEnabled", parseBoolean(userSettings?.deepseekSearchApiEnabled)],
    ],
    false
  );

  const multimodal = choose(
    "multimodal",
    [
      ["environment.MULTIMODAL", resolveMultimodalMode(systemEnv.MULTIMODAL)],
      ["project.multimodal", resolveMultimodalMode(projectSettings?.multimodal)],
      ["project.env.MULTIMODAL", resolveMultimodalMode(projectEnv.MULTIMODAL)],
      ["user.multimodal", resolveMultimodalMode(userSettings?.multimodal)],
      ["user.env.MULTIMODAL", resolveMultimodalMode(userEnv.MULTIMODAL)],
    ],
    "default"
  );

  const filesApiEnabled =
    baseURL === DEFAULT_BASE_URL &&
    choose(
      "filesApiEnabled",
      [
        ["project.filesApiEnabled", parseBoolean(projectSettings?.filesApiEnabled)],
        ["user.filesApiEnabled", parseBoolean(userSettings?.filesApiEnabled)],
      ],
      false
    );
  const filesApiTimeoutMs = choose(
    "filesApiTimeoutMs",
    [
      [
        "project.filesApiTimeoutMs",
        parseIntegerInRange(projectSettings?.filesApiTimeoutMs, 1, MAX_FILES_API_TIMEOUT_MS),
      ],
      ["user.filesApiTimeoutMs", parseIntegerInRange(userSettings?.filesApiTimeoutMs, 1, MAX_FILES_API_TIMEOUT_MS)],
    ],
    DEFAULT_FILES_API_TIMEOUT_MS
  );
  const fileExpiresAfterSeconds = choose(
    "fileExpiresAfterSeconds",
    [
      [
        "project.fileExpiresAfterSeconds",
        parseIntegerInRange(projectSettings?.fileExpiresAfterSeconds, 3_600, 2_592_000),
      ],
      ["user.fileExpiresAfterSeconds", parseIntegerInRange(userSettings?.fileExpiresAfterSeconds, 3_600, 2_592_000)],
    ],
    DEFAULT_FILE_EXPIRES_AFTER_SECONDS
  );
  const fileRefreshMarginSeconds = choose(
    "fileRefreshMarginSeconds",
    [
      [
        "project.fileRefreshMarginSeconds",
        parseIntegerInRange(projectSettings?.fileRefreshMarginSeconds, 0, fileExpiresAfterSeconds - 1),
      ],
      [
        "user.fileRefreshMarginSeconds",
        parseIntegerInRange(userSettings?.fileRefreshMarginSeconds, 0, fileExpiresAfterSeconds - 1),
      ],
    ],
    Math.min(DEFAULT_FILE_REFRESH_MARGIN_SECONDS, fileExpiresAfterSeconds - 1)
  );
  const fileQuotaCleanupBatch = choose(
    "fileQuotaCleanupBatch",
    [
      ["project.fileQuotaCleanupBatch", parseIntegerInRange(projectSettings?.fileQuotaCleanupBatch, 1, 1_000)],
      ["user.fileQuotaCleanupBatch", parseIntegerInRange(userSettings?.fileQuotaCleanupBatch, 1, 1_000)],
    ],
    DEFAULT_FILE_QUOTA_CLEANUP_BATCH
  );
  const maxRequestFilesBytes = choose(
    "maxRequestFilesBytes",
    [
      [
        "project.maxRequestFilesBytes",
        parseIntegerInRange(projectSettings?.maxRequestFilesBytes, 1, Number.MAX_SAFE_INTEGER),
      ],
      [
        "user.maxRequestFilesBytes",
        parseIntegerInRange(userSettings?.maxRequestFilesBytes, 1, Number.MAX_SAFE_INTEGER),
      ],
    ],
    DEFAULT_MAX_REQUEST_FILES_BYTES
  );

  if (trace) {
    for (const key of Object.keys(env)) {
      trace.sources[`env.${key}`] = [
        systemEnv[key] !== undefined
          ? `environment.${key}`
          : projectEnv[key] !== undefined
            ? `project.env.${key}`
            : `user.env.${key}`,
      ];
    }
    trace.sources.apiKey = env.API_KEY?.trim() ? trace.sources["env.API_KEY"] : ["default"];
    trace.sources.baseURL = env.BASE_URL?.trim() ? trace.sources["env.BASE_URL"] : ["default"];
    for (const key of ["API_KEY", "BASE_URL"])
      if (env[key] !== undefined && !env[key].trim())
        trace.ignored.push({ field: key === "API_KEY" ? "apiKey" : "baseURL", source: trace.sources[`env.${key}`][0] });
    if (autoCompactWindow !== configuredAutoCompactWindow && configuredAutoCompactWindow !== undefined)
      trace.sources.autoCompactWindow.push("limited by contextWindow");
    for (const field of ["retainRatio", "retainTokens"] as const) {
      trace.sources[field] =
        retention?.[field] !== undefined
          ? [`${retention === projectSettings ? "project" : "user"}.${field}`]
          : ["default"];
    }
    if (baseURL !== DEFAULT_BASE_URL) trace.sources.filesApiEnabled = ["derived from baseURL"];
    for (const key of ["persistence", "maxBytes"] as const) {
      trace.sources[`history.${key}`] = [
        projectSettings?.history?.[key] !== undefined
          ? `project.history.${key}`
          : userSettings?.history?.[key] !== undefined
            ? `user.history.${key}`
            : "default",
      ];
    }
    traceMergedSettings(trace, userSettings, projectSettings, userEnv, projectEnv, systemEnv);
  }

  return {
    env,
    experimental: { reasoningSummary, reasoningSummaryModel },
    apiKey: trimString(env.API_KEY) || undefined,
    baseURL,
    model,
    contextWindow,
    autoCompactWindow,
    retainRatio,
    retainTokens,
    temperature,
    thinkingEnabled,
    reasoningEffort,
    debugLogEnabled,
    telemetryEnabled,
    notify: notify || undefined,
    webSearchTool: webSearchTool || undefined,
    deepseekSearchApiEnabled,
    multimodal,
    filesApiEnabled,
    filesApiTimeoutMs,
    fileExpiresAfterSeconds,
    fileRefreshMarginSeconds,
    fileQuotaCleanupBatch,
    maxRequestFilesBytes,
    mcpServers: mergeMcpServers(userSettings, projectSettings, userEnv, projectEnv, systemEnv),
    permissions: mergePermissions(userSettings, projectSettings),
    enabledSkills: mergeEnabledSkills(userSettings, projectSettings),
    statusline: mergeStatusLine(userSettings, projectSettings),
    history: resolveHistorySettings(userSettings?.history, projectSettings?.history),
  };
}

export function resolveSettings(
  settings: DeepcodingSettings | null | undefined,
  defaults: { model: string; baseURL: string },
  processEnv: SettingsProcessEnv = process.env
): ResolvedDeepcodingSettings {
  return resolveSettingsSources(settings, null, defaults, processEnv);
}

export function modelConfigKey(config: Pick<ModelConfigSelection, "thinkingEnabled" | "reasoningEffort">): string {
  return config.thinkingEnabled ? `thinking:${config.reasoningEffort}` : "thinking:none";
}

export function applyModelConfigSelection(
  settings: DeepcodingSettings | null | undefined,
  current: ModelConfigSelection,
  selected: ModelConfigSelection,
  persistSelection = false
): { settings: DeepcodingSettings; changed: boolean } {
  // An explicit save destination must remember the choice even if it is already inherited.
  if (persistSelection) {
    return {
      settings: {
        ...settings,
        model: selected.model,
        thinkingEnabled: selected.thinkingEnabled,
        reasoningEffort: selected.reasoningEffort,
      },
      changed:
        settings?.model !== selected.model ||
        settings?.thinkingEnabled !== selected.thinkingEnabled ||
        settings?.reasoningEffort !== selected.reasoningEffort,
    };
  }
  const changed = selected.model !== current.model || modelConfigKey(selected) !== modelConfigKey(current);
  const next: DeepcodingSettings = { ...(settings ?? {}) };

  if (!changed) {
    return { settings: next, changed: false };
  }

  if (selected.model !== current.model || Object.prototype.hasOwnProperty.call(next, "model")) {
    next.model = selected.model;
  } else {
    delete next.model;
  }

  next.thinkingEnabled = selected.thinkingEnabled;
  if (selected.thinkingEnabled) {
    next.reasoningEffort = selected.reasoningEffort;
  }

  return { settings: next, changed: true };
}

// ---------------------------------------------------------------------------
// Default constants
// ---------------------------------------------------------------------------

export const DEFAULT_MODEL = "deepseek-flash";
export const DEFAULT_BASE_URL = "https://api.deepseek.com";

// ---------------------------------------------------------------------------
// Settings file I/O
// ---------------------------------------------------------------------------

export {
  getDeepcodePlusSettingsPath,
  readDeepcodePlusSettings,
  readDeepcodePlusApiKey,
  type SubscriptionPlan,
  type DeepcodePlusSettings,
} from "./common/plus-subscription";

export function getUserSettingsPath(): string {
  return path.join(os.homedir(), ".deepcode", "settings.json");
}

export function getProjectSettingsPath(projectRoot: string): string {
  return path.join(projectRoot, ".deepcode", "settings.json");
}

export function getDefaultSettingsTarget(projectRoot: string = process.cwd()): SettingsTarget {
  return fs.existsSync(getProjectSettingsPath(projectRoot)) ? "project" : "user";
}

/** A malformed or unreadable file must never be treated as empty when saving. */
export function readEditableSettings(settingsPath: string): DeepcodingSettings {
  let raw: string;
  try {
    raw = fs.readFileSync(settingsPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  const settings = JSON.parse(raw) as DeepcodingSettings;
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    throw new Error(`Invalid settings in ${settingsPath}`);
  }
  if (settings.env !== undefined && !isPlainObject(settings.env)) {
    throw new Error(`Invalid env in ${settingsPath}`);
  }
  if (settings.experimental !== undefined && !isPlainObject(settings.experimental)) {
    throw new Error(`Invalid experimental settings in ${settingsPath}`);
  }
  return settings;
}

export function readSettingsFile(settingsPath: string): DeepcodingSettings | null {
  try {
    if (!fs.existsSync(settingsPath)) {
      return null;
    }
    const raw = fs.readFileSync(settingsPath, "utf8");
    return JSON.parse(raw) as DeepcodingSettings;
  } catch {
    return null;
  }
}

export function readSettings(): DeepcodingSettings | null {
  return readSettingsFile(getUserSettingsPath());
}

export function readProjectSettings(projectRoot: string = process.cwd()): DeepcodingSettings | null {
  return readSettingsFile(getProjectSettingsPath(projectRoot));
}

function writeSettingsFile(settingsPath: string, settings: DeepcodingSettings): void {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

export function writeSettings(settings: DeepcodingSettings): void {
  const settingsPath = getUserSettingsPath();
  writeSettingsFile(settingsPath, settings);
}

export function writeProjectSettings(settings: DeepcodingSettings, projectRoot: string = process.cwd()): void {
  const settingsPath = getProjectSettingsPath(projectRoot);
  writeSettingsFile(settingsPath, settings);
}

export function writeModelConfigSelection(
  selection: ModelConfigSelection,
  current: ModelConfigSelection = resolveCurrentSettings(),
  projectRoot: string = process.cwd(),
  target: SettingsTarget = getDefaultSettingsTarget(projectRoot)
): { changed: boolean; settings: DeepcodingSettings } {
  const projectSettingsPath = getProjectSettingsPath(projectRoot);
  const userSettingsPath = getUserSettingsPath();
  const rawSettings = readEditableSettings(target === "project" ? projectSettingsPath : userSettingsPath);
  const result = applyModelConfigSelection(rawSettings, current, selection, true);
  let projectSettings: DeepcodingSettings | undefined;
  let projectChanged = false;
  if (target === "user" && path.resolve(projectSettingsPath) !== path.resolve(userSettingsPath)) {
    const previous = readEditableSettings(projectSettingsPath);
    projectSettings = { ...previous };
    delete projectSettings.model;
    delete projectSettings.thinkingEnabled;
    delete projectSettings.reasoningEffort;
    if (previous.env) {
      projectSettings.env = { ...previous.env };
      delete projectSettings.env.MODEL;
      delete projectSettings.env.THINKING_ENABLED;
      delete projectSettings.env.REASONING_EFFORT;
    }
    projectChanged = JSON.stringify(previous) !== JSON.stringify(projectSettings);
  }
  if (result.changed) {
    if (target === "project") {
      writeProjectSettings(result.settings, projectRoot);
    } else {
      writeSettings(result.settings);
    }
  }
  if (projectChanged) writeProjectSettings(projectSettings!, projectRoot);
  return { ...result, changed: result.changed || projectChanged };
}

export function writeReasoningSummarySelection(
  selection: ReasoningSummaryMode,
  projectRoot: string = process.cwd(),
  target: SettingsTarget = getDefaultSettingsTarget(projectRoot)
): { changed: boolean; settings: DeepcodingSettings } {
  const projectPath = getProjectSettingsPath(projectRoot);
  const userPath = getUserSettingsPath();
  const previous = readEditableSettings(target === "project" ? projectPath : userPath);
  const settings: DeepcodingSettings = {
    ...previous,
    experimental: { ...previous.experimental, reasoningSummary: selection },
  };
  const changed = previous.experimental?.reasoningSummary !== selection;
  let projectSettings: DeepcodingSettings | undefined;
  let projectChanged = false;
  if (target === "user" && path.resolve(projectPath) !== path.resolve(userPath)) {
    const project = readEditableSettings(projectPath);
    if (project.experimental?.reasoningSummary !== undefined) {
      projectSettings = { ...project, experimental: { ...project.experimental } };
      delete projectSettings.experimental!.reasoningSummary;
      projectChanged = true;
    }
  }
  if (changed) {
    if (target === "project") writeProjectSettings(settings, projectRoot);
    else writeSettings(settings);
  }
  if (projectChanged) writeProjectSettings(projectSettings!, projectRoot);
  return { changed: changed || projectChanged, settings };
}

/** Explicit input files fail loudly; diagnostics must not include JSON contents. */
function readExplicitSettingsFile(settingsPath: string): DeepcodingSettings {
  let raw: string;
  try {
    raw = fs.readFileSync(settingsPath, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? "read error";
    throw new Error(`Cannot read settings file "${settingsPath}" (${code}).`);
  }
  let settings: unknown;
  try {
    settings = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON in settings file "${settingsPath}".`);
  }
  if (!isPlainObject(settings)) {
    throw new Error(`Settings file "${settingsPath}" must contain a JSON object.`);
  }
  return settings as DeepcodingSettings;
}

export function resolveCurrentSettings(
  projectRoot: string = process.cwd(),
  settingsFile?: string
): ResolvedDeepcodingSettings {
  const userPath = path.resolve(getUserSettingsPath());
  const projectPath =
    settingsFile === undefined
      ? path.resolve(getProjectSettingsPath(projectRoot))
      : path.resolve(projectRoot, settingsFile);
  const explicitSettings = settingsFile === undefined ? undefined : readExplicitSettingsFile(projectPath);
  const sameFile = userPath === projectPath;
  return resolveSettingsSources(
    sameFile && explicitSettings ? explicitSettings : readSettings(),
    sameFile ? null : (explicitSettings ?? readProjectSettings(projectRoot)),
    {
      model: DEFAULT_MODEL,
      baseURL: DEFAULT_BASE_URL,
    },
    process.env
  );
}
