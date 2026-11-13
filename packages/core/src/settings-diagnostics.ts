import { resolveHistorySettings, type HistorySettings } from "./common/message-history";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { validateCompactRetention } from "./common/compaction";
import {
  resolveSettingsSources,
  DEFAULT_MODEL,
  DEFAULT_BASE_URL,
  type DeepcodingSettings,
  type ResolvedDeepcodingSettings,
  type SettingsTrace,
} from "./settings";
import { normalizePlusApiKey, type DeepcodePlusSettings } from "./common/plus-subscription";

export type DiagnosticCheck = {
  status: "PASS" | "WARN" | "FAIL" | "SKIP";
  name: string;
  detail: string;
};
export type InspectedFile = {
  path: string;
  status: "loaded" | "missing" | "unreadable" | "invalid";
  value?: Record<string, unknown>;
  detail: string;
};
const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** Never return parser messages: they can contain fragments of credentials. */
export function inspectJsonFile(filePath: string): InspectedFile {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return { path: filePath, status: code === "ENOENT" ? "missing" : "unreadable", detail: code ?? "Read failed" };
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { path: filePath, status: "invalid", detail: "Invalid JSON. Correct the file syntax." };
  }
  if (!isObject(value)) return { path: filePath, status: "invalid", detail: "Expected a JSON object." };
  return { path: filePath, status: "loaded", value, detail: "Loaded" };
}

export function collectSecrets(value: unknown, secrets: Set<string>, parent = ""): void {
  if (!isObject(value) && !Array.isArray(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    if (
      typeof entry === "string" &&
      entry &&
      (/key|token|password|secret|authorization/i.test(key) ||
        (parent === "env" &&
          !/^(MODEL|BASE_URL|TEMPERATURE|THINKING_ENABLED|REASONING_EFFORT|DEBUG_LOG_ENABLED|TELEMETRY_ENABLED|MULTIMODAL|CONTEXT_WINDOW|AUTO_COMPACT_WINDOW)$/.test(
            key
          )))
    )
      secrets.add(entry);
    if (typeof entry === "object") collectSecrets(entry, secrets, key);
  }
}

export function inspectSettings(options: {
  projectRoot: string;
  home?: string;
  settingsFile?: string;
  env?: NodeJS.ProcessEnv;
}) {
  const home = options.home ?? os.homedir();
  const processEnv = options.env ?? process.env;
  const userPath = path.resolve(home, ".deepcode/settings.json");
  const defaultProjectPath = path.resolve(options.projectRoot, ".deepcode/settings.json");
  const projectPath =
    options.settingsFile === undefined ? defaultProjectPath : path.resolve(options.projectRoot, options.settingsFile);
  const plusPath = path.join(home, ".deepcode-plus/settings.json");
  const checks: DiagnosticCheck[] = [];
  const secrets = new Set<string>();
  for (const [key, value] of Object.entries(processEnv)) {
    if (value && /key|token|password|secret|authorization/i.test(key)) secrets.add(value);
  }
  const files = new Map<string, InspectedFile>();
  const inspect = (filePath: string, name: string, explicit = false) => {
    let file = files.get(filePath);
    if (!file) {
      file = inspectJsonFile(filePath);
      files.set(filePath, file);
      collectSecrets(file.value, secrets);
      checks.push({
        status: file.status === "loaded" ? "PASS" : file.status === "missing" && !explicit ? "SKIP" : "FAIL",
        name,
        detail: `${filePath}: ${file.detail}${!explicit && (file.status === "invalid" || file.status === "unreadable") ? ". Normal loading may ignore this file; correct it to apply its settings." : ""}`,
      });
    }
    return file;
  };
  const user = inspect(userPath, "User settings", options.settingsFile !== undefined && userPath === projectPath);
  const project =
    userPath === projectPath
      ? undefined
      : inspect(
          projectPath,
          options.settingsFile === undefined ? "Project settings" : "Explicit settings",
          options.settingsFile !== undefined
        );
  if (userPath === projectPath)
    checks.push({
      status: "SKIP",
      name: "Project settings",
      detail: `${projectPath}: same file as user settings; loaded once.`,
    });
  if (options.settingsFile !== undefined && projectPath !== defaultProjectPath)
    checks.push({
      status: "SKIP",
      name: "Default project settings",
      detail: `${defaultProjectPath}: replaced by --settings.`,
    });
  const plus = inspect(plusPath, "DeepCode Plus settings");
  for (const file of [user, project, plus]) {
    if (!file?.value) continue;
    if (file.value.env !== undefined && !isObject(file.value.env))
      checks.push({ status: "FAIL", name: "Configuration structure", detail: `${file.path}: env must be an object.` });
    if (isObject(file.value.env))
      for (const [key, value] of Object.entries(file.value.env)) {
        if (typeof value !== "string")
          checks.push({
            status: key === "PLUS_API_KEY" ? "FAIL" : "WARN",
            name: "Configuration value",
            detail: `${file.path}: env.${key} must be a string; non-string environment values are ignored.`,
          });
      }
    if (file === plus) continue;
    try {
      validateCompactRetention(file.value);
    } catch (error) {
      checks.push({
        status: "FAIL",
        name: "Compaction settings",
        detail: `${file.path}: ${error instanceof Error ? error.message : "Invalid retention settings."}`,
      });
    }
    try {
      resolveHistorySettings(file.value.history as HistorySettings | undefined);
    } catch (error) {
      checks.push({
        status: "FAIL",
        name: "History settings",
        detail: `${file.path}: ${error instanceof Error ? error.message : "Invalid history settings."}`,
      });
    }
    const knownFields = new Set([
      "env",
      "contextWindow",
      "autoCompactWindow",
      "streamIdleTimeoutMs",
      "retainRatio",
      "retainTokens",
      "model",
      "temperature",
      "thinkingEnabled",
      "reasoningEffort",
      "debugLogEnabled",
      "telemetryEnabled",
      "notify",
      "webSearchTool",
      "deepseekSearchApiEnabled",
      "multimodal",
      "filesApiEnabled",
      "filesApiTimeoutMs",
      "fileExpiresAfterSeconds",
      "fileRefreshMarginSeconds",
      "fileQuotaCleanupBatch",
      "maxRequestFilesBytes",
      "mcpServers",
      "permissions",
      "enabledSkills",
      "statusline",
      "history",
      "experimental",
    ]);
    for (const key of Object.keys(file.value))
      if (!knownFields.has(key))
        checks.push({
          status: "WARN",
          name: "Unknown configuration field",
          detail: `${file.path}: ${key} is not a recognized top-level setting and is ignored.`,
        });
    if (isObject(file.value.experimental)) {
      const experimental = file.value.experimental;
      if (
        experimental.reasoningSummary !== undefined &&
        experimental.reasoningSummary !== "on" &&
        experimental.reasoningSummary !== "off"
      )
        checks.push({
          status: "WARN",
          name: "Experimental configuration",
          detail: `${file.path}: experimental.reasoningSummary must be "on" or "off".`,
        });
      if (
        experimental.reasoningSummaryModel !== undefined &&
        (typeof experimental.reasoningSummaryModel !== "string" || !experimental.reasoningSummaryModel.trim())
      )
        checks.push({
          status: "WARN",
          name: "Experimental configuration",
          detail: `${file.path}: experimental.reasoningSummaryModel must be a non-empty string.`,
        });
    }
    if (isObject(file.value.mcpServers))
      for (const [name, server] of Object.entries(file.value.mcpServers)) {
        if (
          !isObject(server) ||
          (server.command !== undefined && typeof server.command !== "string") ||
          (server.args !== undefined &&
            (!Array.isArray(server.args) || server.args.some((arg) => typeof arg !== "string"))) ||
          (server.env !== undefined && !isObject(server.env))
        )
          checks.push({
            status: "WARN",
            name: "MCP configuration",
            detail: `${file.path}: mcpServers.${name} has an invalid command, args, or env. Check its field types.`,
          });
      }
    for (const key of ["permissions", "enabledSkills", "mcpServers", "statusline", "experimental"]) {
      if (file.value[key] !== undefined && !isObject(file.value[key]))
        checks.push({
          status: "WARN",
          name: "Configuration structure",
          detail: `${file.path}: ${key} must be an object.`,
        });
    }
  }
  const environmentNames = Object.keys(processEnv)
    .filter((key) => key.startsWith("DEEPCODE_"))
    .sort();
  checks.push({
    status: environmentNames.length ? "PASS" : "SKIP",
    name: "Environment settings",
    detail: environmentNames.join(", ") || "No DEEPCODE_* variables set.",
  });
  for (const key of ["API_KEY", "PLUS_API_KEY", "MODEL", "BASE_URL"]) {
    if (processEnv[key] !== undefined)
      checks.push({
        status: "WARN",
        name: "Unused environment variable",
        detail: `${key} is not read from the process environment. Use DEEPCODE_${key} or settings.env.${key}.`,
      });
  }
  const trace: SettingsTrace = { sources: {}, ignored: [] };
  const sourceName = (source: string): string =>
    source.startsWith("user.")
      ? `${userPath} → ${source.slice(5)}`
      : source.startsWith("project.")
        ? `${projectPath} → ${source.slice(8)}`
        : source.startsWith("environment.")
          ? `DEEPCODE_${source.slice(12)}`
          : source;
  let settings: ResolvedDeepcodingSettings | undefined;
  // An explicit unreadable input stops real startup: do not invent an effective configuration.
  const explicitFailed = options.settingsFile !== undefined && (project ?? user).status !== "loaded";
  if (!explicitFailed) {
    try {
      settings = resolveSettingsSources(
        user.value as DeepcodingSettings | undefined,
        project?.value as DeepcodingSettings | undefined,
        { model: DEFAULT_MODEL, baseURL: DEFAULT_BASE_URL },
        processEnv,
        trace
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Configuration resolution failed.";
      checks.push({
        status: "FAIL",
        name: "Effective settings",
        detail: message.includes("PLUS_API_KEY")
          ? `Invalid PLUS_API_KEY at ${(trace.sources["env.PLUS_API_KEY"] ?? []).map(sourceName).join(", ")}.`
          : /retain|retention|context window|compaction/i.test(message)
            ? message
            : "Unable to resolve settings. Check field types in the files above.",
      });
    }
  }
  for (const ignored of trace.ignored)
    checks.push({
      status: "WARN",
      name: "Ignored configuration value",
      detail: `${sourceName(ignored.source)}: invalid or empty ${ignored.field}; a lower-priority value or default applies.`,
    });
  let plusSettings: DeepcodePlusSettings | undefined;
  const override = settings?.env.PLUS_API_KEY;
  try {
    const apiKey = normalizePlusApiKey(
      override ?? (isObject(plus.value?.env) ? plus.value.env.PLUS_API_KEY : undefined),
      plusPath
    );
    const plan = plus.value?.subscriptionPlan;
    plusSettings = {
      apiKey,
      subscriptionPlan: override !== undefined ? "default" : plan === "on" || plan === "off" ? plan : "default",
    };
    if (plan !== undefined && !["default", "on", "off"].includes(String(plan)))
      checks.push({
        status: "WARN",
        name: "Plus subscriptionPlan",
        detail: `${plusPath}: expected default, on, or off; default applies.`,
      });
    checks.push({
      status: "PASS",
      name: "Plus configuration",
      detail: `PLUS_API_KEY: ${apiKey ? "configured" : "not configured"}; source: ${override !== undefined ? (trace.sources["env.PLUS_API_KEY"] ?? []).map(sourceName).join(", ") : plusPath + " → env.PLUS_API_KEY"}. subscriptionPlan: ${plusSettings.subscriptionPlan}${override !== undefined ? "; independent Plus settings are bypassed by the effective PLUS_API_KEY override" : `; source: ${plan === undefined ? "default" : plusPath + " → subscriptionPlan"}`}.`,
    });
  } catch {
    checks.push({
      status: "FAIL",
      name: "Plus configuration",
      detail: `${plusPath}: invalid PLUS_API_KEY.`,
    });
  }
  // The independent Plus file may be unused, but still diagnose malformed keys in it.
  if (override !== undefined && isObject(plus.value?.env) && plus.value.env.PLUS_API_KEY !== undefined) {
    try {
      normalizePlusApiKey(plus.value.env.PLUS_API_KEY);
    } catch {
      checks.push({
        status: "WARN",
        name: "Unused Plus key",
        detail: `${plusPath}: invalid PLUS_API_KEY; currently overridden.`,
      });
    }
  }
  return { checks, settings, plusSettings, trace, sourceName, secrets, files };
}
