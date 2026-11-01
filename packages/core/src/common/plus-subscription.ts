import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { fetch as undiciFetch } from "undici";
import type { CreateOpenAIClient, OpenAIClientResult } from "./tool-types";

export const DEEPCODE_PLUS_LEGACY_HOST = "https://deepcode.vegamo.cn";
export const DEEPCODE_PLUS_HOST = "https://www.deepcodeplus.com";
export const DEEPCODE_PLUS_LLM_HOST = "https://chat.deepcodeplus.com";

/** Undefined means unconfigured; all explicitly configured values must be valid. */
export function normalizePlusApiKey(
  value: unknown,
  settingsPath = "~/.deepcode-plus/settings.json"
): string | undefined {
  if (value === undefined) return undefined;
  const key = typeof value === "string" ? value.trim() : "";
  const length = Array.from(key.slice(3)).length;
  if (!key.startsWith("sk-") || (length !== 24 && length !== 26)) {
    throw new Error(`Invalid PLUS_API_KEY in ${settingsPath}.`);
  }
  return key;
}

export function resolvePlusHost(apiKey?: string): string {
  const key = normalizePlusApiKey(apiKey);
  return key && Array.from(key.slice(3)).length === 26 ? DEEPCODE_PLUS_HOST : DEEPCODE_PLUS_LEGACY_HOST;
}

export function resolvePlusLlmHost(apiKey?: string): string {
  return resolvePlusHost(apiKey) === DEEPCODE_PLUS_HOST ? DEEPCODE_PLUS_LLM_HOST : DEEPCODE_PLUS_LEGACY_HOST;
}

export function getDeepcodePlusSettingsPath(): string {
  return path.join(os.homedir(), ".deepcode-plus", "settings.json");
}

export type SubscriptionPlan = "default" | "on" | "off";

export type DeepcodePlusSettings = {
  apiKey?: string;
  subscriptionPlan: SubscriptionPlan;
};

export function readDeepcodePlusSettings(settingsPath: string = getDeepcodePlusSettingsPath()): DeepcodePlusSettings {
  let settings: { env?: { PLUS_API_KEY?: unknown }; subscriptionPlan?: unknown } | null;
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  } catch {
    return { subscriptionPlan: "default" };
  }
  return {
    apiKey: normalizePlusApiKey(settings?.env?.PLUS_API_KEY, settingsPath),
    subscriptionPlan:
      settings?.subscriptionPlan === "on" || settings?.subscriptionPlan === "off"
        ? settings.subscriptionPlan
        : "default",
  };
}

export function readDeepcodePlusApiKey(settingsPath: string = getDeepcodePlusSettingsPath()): string | undefined {
  return readDeepcodePlusSettings(settingsPath).apiKey;
}

export function resolveEffectivePlusSettings(
  settings: { env?: Record<string, string> },
  readSettings: () => DeepcodePlusSettings = readDeepcodePlusSettings
): DeepcodePlusSettings {
  if (settings.env?.PLUS_API_KEY !== undefined) {
    return {
      apiKey: normalizePlusApiKey(settings.env.PLUS_API_KEY, "settings env.PLUS_API_KEY"),
      subscriptionPlan: "default",
    };
  }
  return readSettings();
}

export function writeDeepcodePlusApiKey(apiKey: string, settingsPath: string = getDeepcodePlusSettingsPath()): void {
  const key = normalizePlusApiKey(apiKey, settingsPath);
  let settings: Record<string, unknown> = {};
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new Error(`Unable to read ${settingsPath}.`);
    }
  }
  const isObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);
  if (!isObject(settings) || (settings.env !== undefined && !isObject(settings.env))) {
    throw new Error(`Invalid settings in ${settingsPath}.`);
  }
  settings.env = { ...(settings.env as Record<string, unknown> | undefined), PLUS_API_KEY: key };
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

export const DEEPCODE_PLUS_BASE_URL = `${DEEPCODE_PLUS_LEGACY_HOST}/plugin/openai`;
export type PlusSubscriptionStatus = "api only" | "full ability" | "unknown";
export type OpenAIConnection = {
  apiKey?: string;
  baseURL: string;
  usingPlus: boolean;
  configurationError?: string;
};
export type OpenAIConnectionContext = {
  connection: OpenAIConnection;
  plusApiKey?: string;
};

export function resolveOpenAIConnection(
  settings: { apiKey?: string; baseURL: string },
  plusApiKey?: string,
  subscriptionPlan: DeepcodePlusSettings["subscriptionPlan"] = "default",
  status: PlusSubscriptionStatus = "unknown"
): OpenAIConnection {
  plusApiKey = normalizePlusApiKey(plusApiKey);
  const baseURL = `${resolvePlusLlmHost(plusApiKey)}/plugin/openai`;
  const regular = { apiKey: settings.apiKey, baseURL: settings.baseURL, usingPlus: false };
  if (subscriptionPlan === "off") return regular;
  if (subscriptionPlan === "on" && !plusApiKey) {
    return {
      apiKey: undefined,
      baseURL,
      usingPlus: false,
      configurationError:
        "PLUS_API_KEY not found. Please configure env.PLUS_API_KEY in ~/.deepcode-plus/settings.json.",
    };
  }
  if (
    subscriptionPlan === "default" &&
    (!plusApiKey || status === "api only" || (status === "unknown" && settings.apiKey))
  )
    return regular;
  return { apiKey: plusApiKey, baseURL, usingPlus: true };
}

type ProbeFetch = (
  url: string,
  options: {
    method: "GET";
    headers: Record<string, string>;
    signal: AbortSignal;
    redirect: "manual";
  }
) => Promise<{ status: number; body?: { cancel(): Promise<void> } | null }>;

export async function checkPlusSubscription(
  apiKey: string,
  signal?: AbortSignal,
  fetcher: ProbeFetch = undiciFetch,
  timeoutMs = 3000
): Promise<PlusSubscriptionStatus> {
  signal?.throwIfAborted();
  apiKey = normalizePlusApiKey(apiKey)!;
  const baseURL = `${resolvePlusLlmHost(apiKey)}/plugin/openai`;
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(`${baseURL}/models`, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
      redirect: "manual",
    });
    signal?.throwIfAborted();
    // Only HTTP status matters; release the body without requiring valid JSON.
    await response.body?.cancel().catch(() => {});
    if (response.status === 200) return "full ability";
    if (response.status === 401 || response.status === 403) return "api only";
    return "unknown";
  } catch {
    signal?.throwIfAborted();
    return "unknown";
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

/** Keep the selected credentials stable for every LLM call within a turn. */
export function withPlusSubscription(
  getSettings: () => { apiKey?: string; baseURL: string; env?: Record<string, string> },
  buildClient: (context: OpenAIConnectionContext) => OpenAIClientResult,
  dependencies: {
    readSettings?: () => DeepcodePlusSettings;
    checkSubscription?: (apiKey: string, signal?: AbortSignal) => Promise<PlusSubscriptionStatus>;
  } = {}
): CreateOpenAIClient {
  const readSettings = dependencies.readSettings ?? readDeepcodePlusSettings;
  const checkSubscription = dependencies.checkSubscription ?? checkPlusSubscription;
  const readEffectiveSettings = () => resolveEffectivePlusSettings(getSettings(), readSettings);
  let prepared: OpenAIConnectionContext | undefined;
  const resolve = (plus: DeepcodePlusSettings, status: PlusSubscriptionStatus): OpenAIConnectionContext => ({
    connection: resolveOpenAIConnection(getSettings(), plus.apiKey, plus.subscriptionPlan, status),
    plusApiKey: plus.apiKey,
  });
  return Object.assign(() => buildClient(prepared ?? resolve(readEffectiveSettings(), "unknown")), {
    prepare: async (signal?: AbortSignal) => {
      signal?.throwIfAborted();
      const settings = readEffectiveSettings();
      const plus = { ...settings, apiKey: normalizePlusApiKey(settings.apiKey) };
      const status =
        plus.subscriptionPlan === "default" && plus.apiKey ? await checkSubscription(plus.apiKey, signal) : "unknown";
      signal?.throwIfAborted();
      prepared = resolve(plus, status);
    },
  });
}
