import os from "node:os";
import { inspectSettings, type DiagnosticCheck } from "@vegamo/deepcode-core/settings-diagnostics";
import { probeModels, type ModelsProbe } from "@vegamo/deepcode-core/common/doctor-api";
import {
  resolveOpenAIConnection,
  resolvePlusLlmHost,
  type PlusSubscriptionStatus,
} from "@vegamo/deepcode-core/common/plus-subscription";
import { inspectRuntime, inspectUpdates } from "./doctor-system";
import { getCliVersion } from "./utils/version";

export type DoctorSection = { name: string; checks: DiagnosticCheck[] };
export type DoctorOptions = { settingsFile?: string; projectRoot?: string; home?: string; env?: NodeJS.ProcessEnv };
type SettingsInspection = ReturnType<typeof inspectSettings>;

/** Sanitize URLs even when they occur in an error or a configured string. */
export function redactDoctorText(text: string, secrets: Iterable<string> = []): string {
  text = text.replace(/https?:\/\/[^\s<>"']+/gi, (raw) => {
    try {
      const url = new URL(raw);
      if (url.username || url.password) {
        url.username = "redacted";
        url.password = "";
      }
      for (const key of [...url.searchParams.keys()]) url.searchParams.set(key, "redacted");
      if (url.hash) url.hash = "redacted";
      return url.toString();
    } catch {
      return "[redacted URL]";
    }
  });
  for (const secret of [...secrets].filter(Boolean).sort((a, b) => b.length - a.length)) {
    text = text.split(secret).join("[redacted]");
    text = text.split(encodeURIComponent(secret)).join("[redacted]");
  }
  return text.replace(/\bsk-[A-Za-z0-9_-]+/g, "[redacted]").replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "");
}

const visibleEnv =
  /^(MODEL|BASE_URL|TEMPERATURE|THINKING_ENABLED|REASONING_EFFORT|DEBUG_LOG_ENABLED|TELEMETRY_ENABLED|MULTIMODAL|CONTEXT_WINDOW|AUTO_COMPACT_WINDOW)$/;
function displayValue(field: string, value: unknown): string {
  if (value === undefined) return "not configured";
  if (
    field === "apiKey" ||
    field === "notify" ||
    field === "webSearchTool" ||
    field.startsWith("statusline.providers.") ||
    field.startsWith("mcpServers.") ||
    (field.startsWith("env.") && !visibleEnv.test(field.slice(4)))
  )
    return "configured (value hidden)";
  if (typeof value === "object") return Array.isArray(value) ? `${value.length} entries` : "configured";
  return String(value);
}

function effectiveSettingsChecks(inspection: SettingsInspection): DiagnosticCheck[] {
  if (!inspection.settings)
    return [
      {
        status: "SKIP",
        name: "Effective values",
        detail: "Configuration could not be resolved; dependent checks are skipped.",
      },
    ];
  const values: Record<string, unknown> = {};
  const flatten = (value: unknown, field = "") => {
    values[field] = value;
    if (value && typeof value === "object")
      for (const [key, child] of Object.entries(value)) flatten(child, field ? `${field}.${key}` : key);
  };
  flatten(inspection.settings);
  return Object.entries(inspection.trace.sources).map(([field, sources]) => ({
    status: "PASS",
    name: field,
    detail: `${displayValue(field, values[field])}; source: ${sources.map(inspection.sourceName).join(", ")}`,
  }));
}

export async function inspectApi(
  inspection: SettingsInspection,
  probe: typeof probeModels = probeModels
): Promise<DiagnosticCheck[]> {
  const { settings, plusSettings } = inspection;
  if (!settings)
    return [{ status: "SKIP", name: "API checks", detail: "Fix configuration errors before API checks can run." }];
  const checks: DiagnosticCheck[] = [];
  const proxyVariables = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"].filter(
    (key) => process.env[key]
  );
  if (proxyVariables.length)
    checks.push({
      status: "WARN",
      name: "API proxy configuration",
      detail: `${proxyVariables.join(", ")} are set. The API client uses direct connections; these variables do not configure its transport. npm uses separate proxy settings.`,
    });
  const regularURL = settings.baseURL;
  const plusURL = plusSettings?.apiKey ? `${resolvePlusLlmHost(plusSettings.apiKey)}/plugin/openai` : undefined;
  const validURL = (baseURL: string) => {
    try {
      const url = new URL(baseURL);
      return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
    } catch {
      return false;
    }
  };
  const safeProbe = async (apiKey: string | undefined, baseURL: string): Promise<ModelsProbe | undefined> => {
    if (!apiKey || !validURL(baseURL)) return undefined;
    try {
      return await probe({ apiKey, baseURL, model: settings.model });
    } catch {
      return {
        outcome: "unavailable",
        detail: "The API check could not complete. Check endpoint and credential configuration.",
      };
    }
  };
  const [regularResult, plusResult] = await Promise.all([
    safeProbe(settings.apiKey, regularURL),
    plusURL ? safeProbe(plusSettings?.apiKey, plusURL) : Promise.resolve(undefined),
  ]);
  // Match runtime's HTTP-only subscription decision even when a 200 body is malformed.
  const subscriptionStatus: PlusSubscriptionStatus =
    plusResult?.httpStatus === 200
      ? "full ability"
      : plusResult?.httpStatus === 401 || plusResult?.httpStatus === 403
        ? "api only"
        : "unknown";
  const connection = plusSettings
    ? resolveOpenAIConnection(settings, plusSettings.apiKey, plusSettings.subscriptionPlan, subscriptionStatus)
    : undefined;
  if (connection) {
    checks.push({
      status: connection.apiKey && !connection.configurationError ? "PASS" : "FAIL",
      name: "Selected API",
      detail: `${connection.usingPlus || plusSettings!.subscriptionPlan === "on" ? "DeepCode Plus" : "Regular API"}: ${connection.baseURL}; subscriptionPlan=${plusSettings!.subscriptionPlan}, Plus access=${subscriptionStatus}.${connection.configurationError ? ` ${connection.configurationError}` : !connection.apiKey ? " No usable credential is selected. Configure the key for this service." : ""}`,
    });
  } else
    checks.push({
      status: "FAIL",
      name: "Selected API",
      detail: "Invalid Plus settings prevent service selection. Fix the Plus configuration.",
    });
  const add = (
    name: string,
    apiKey: string | undefined,
    baseURL: string,
    result: ModelsProbe | undefined,
    selected: boolean,
    isPlus: boolean
  ) => {
    if (!validURL(baseURL)) {
      checks.push({
        status: selected ? "FAIL" : "WARN",
        name,
        detail: "Invalid base URL. Use an http(s) URL without embedded credentials.",
      });
      return;
    }
    if (!apiKey) {
      checks.push({ status: "SKIP", name, detail: "No key configured for this service." });
      return;
    }
    if (!result) return;
    const rejected = result.outcome === "authentication" || result.outcome === "forbidden";
    checks.push({
      status: result.outcome === "available" ? "PASS" : selected && rejected ? "FAIL" : "WARN",
      name,
      detail: `${baseURL}: ${result.detail}${isPlus && rejected ? " This response does not establish whether the key works for other Plus services." : ""}`,
    });
    if (result.modelListed !== undefined)
      checks.push({
        status: result.modelListed ? "PASS" : "WARN",
        name: `${name} model`,
        detail: result.modelListed
          ? `${settings.model} is listed by the service.`
          : `${settings.model} is not listed. Model support could not be confirmed; check the model name or provider documentation.`,
      });
    else
      checks.push({
        status: "SKIP",
        name: `${name} model`,
        detail: "Model support could not be verified because a usable model list was not returned.",
      });
  };
  add(
    "Regular API",
    settings.apiKey,
    regularURL,
    regularResult,
    connection?.usingPlus === false && !connection.configurationError,
    false
  );
  if (plusURL) add("Plus API", plusSettings?.apiKey, plusURL, plusResult, connection?.usingPlus === true, true);
  else checks.push({ status: "SKIP", name: "Plus API", detail: "No valid Plus key configured." });
  return checks;
}

export function formatDoctorReport(sections: DoctorSection[], secrets: Iterable<string>): string {
  const lines = ["Deep Code doctor", ""];
  for (const section of sections) {
    lines.push(section.name);
    for (const check of section.checks)
      lines.push(`  ${check.status} ${check.name}: ${check.detail.replace(/\r?\n/g, " ")}`);
    lines.push("");
  }
  const checks = sections.flatMap((section) => section.checks);
  lines.push(
    `${checks.filter((check) => check.status === "FAIL").length} failed, ${checks.filter((check) => check.status === "WARN").length} warnings.`
  );
  return redactDoctorText(lines.join("\n") + "\n", secrets);
}

export async function runDoctor(options: DoctorOptions = {}): Promise<number> {
  const projectRoot = options.projectRoot ?? process.cwd();
  const home = options.home ?? os.homedir();
  const inspection = inspectSettings({ ...options, projectRoot, home });
  const version = await getCliVersion();
  const safe = async (name: string, operation: () => Promise<DiagnosticCheck[]>): Promise<DoctorSection> => {
    try {
      return { name, checks: await operation() };
    } catch {
      return {
        name,
        checks: [
          {
            status: "WARN",
            name: "Check incomplete",
            detail: "This diagnostic could not complete. Other checks are still reported.",
          },
        ],
      };
    }
  };
  const [runtime, api, updates] = await Promise.all([
    safe("Runtime", () => inspectRuntime({ projectRoot, home, version })),
    safe("API access", () => inspectApi(inspection)),
    safe("Updates", () => inspectUpdates({ home })),
  ]);
  const sections = [
    runtime,
    { name: "Configuration", checks: inspection.checks },
    { name: "Effective settings", checks: effectiveSettingsChecks(inspection) },
    api,
    updates,
  ];
  process.stdout.write(formatDoctorReport(sections, inspection.secrets));
  return sections.some((section) => section.checks.some((check) => check.status === "FAIL")) ? 1 : 0;
}
