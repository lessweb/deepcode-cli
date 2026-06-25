import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import OpenAI from "openai";
import { Agent, fetch as undiciFetch } from "undici";
import { resolveCurrentSettings } from "../settings";
import { APP_VERSION } from "./package-info";

// Custom undici Agent with a 180-second keepAlive timeout.  The default
// global fetch (undici) only keeps connections alive for 4 seconds, which
// is too short for a CLI where the user may spend 10–30 seconds reading
// output between prompts.  By passing a dedicated Agent to undiciFetch we
// keep connections reusable for three minutes after the last request.
const keepAliveAgent = new Agent({ keepAliveTimeout: 180_000 });
const USER_AGENT = `deepcode-cli/${APP_VERSION}`;

// Module-level cache for the OpenAI client instance.  The client itself is
// a stateless fetch wrapper, so it is safe to share across calls as long as
// the apiKey + baseURL stay the same.  Model, thinking-mode and other
// settings are always read fresh from the project / user config files.
let cachedOpenAI: OpenAI | null = null;
let cachedOpenAIKey = "";

export function createOpenAIClient(projectRoot: string = process.cwd()): {
  client: OpenAI | null;
  model: string;
  baseURL: string;
  temperature?: number;
  thinkingEnabled: boolean;
  reasoningEffort: "high" | "max";
  debugLogEnabled: boolean;
  telemetryEnabled: boolean;
  notify?: string;
  webSearchTool?: string;
  env: Record<string, string>;
  machineId?: string;
} {
  const settings = resolveCurrentSettings(projectRoot);
  if (!settings.apiKey) {
    return {
      client: null,
      model: settings.model,
      baseURL: settings.baseURL,
      temperature: settings.temperature,
      thinkingEnabled: settings.thinkingEnabled,
      reasoningEffort: settings.reasoningEffort,
      debugLogEnabled: settings.debugLogEnabled,
      telemetryEnabled: settings.telemetryEnabled,
      notify: settings.notify,
      webSearchTool: settings.webSearchTool,
      env: settings.env,
      machineId: getMachineId(),
    };
  }

  const cacheKey = `${settings.apiKey}::${settings.baseURL}`;
  if (cachedOpenAI && cachedOpenAIKey === cacheKey) {
    return {
      client: cachedOpenAI,
      model: settings.model,
      baseURL: settings.baseURL,
      temperature: settings.temperature,
      thinkingEnabled: settings.thinkingEnabled,
      reasoningEffort: settings.reasoningEffort,
      debugLogEnabled: settings.debugLogEnabled,
      telemetryEnabled: settings.telemetryEnabled,
      notify: settings.notify,
      webSearchTool: settings.webSearchTool,
      env: settings.env,
      machineId: getMachineId(),
    };
  }

  cachedOpenAI = new OpenAI({
    apiKey: settings.apiKey,
    baseURL: settings.baseURL || undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fetch: (url: any, init: any) => {
      const headers = new Headers(init?.headers);
      headers.set("User-Agent", USER_AGENT);
      return undiciFetch(url, { ...init, headers, dispatcher: keepAliveAgent });
    },
  });
  cachedOpenAIKey = cacheKey;

  // Fire-and-forget warmup: pre-establish TCP+TLS connection to the API
  // server while the user is composing their first prompt.  Bounded by a
  // short timeout so a slow / unreachable API never blocks process exit.
  void (async () => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 3000);
    try {
      await cachedOpenAI.models.list({ signal: ac.signal }).catch(() => {});
    } finally {
      clearTimeout(timer);
    }
  })();

  return {
    client: cachedOpenAI,
    model: settings.model,
    baseURL: settings.baseURL,
    temperature: settings.temperature,
    thinkingEnabled: settings.thinkingEnabled,
    reasoningEffort: settings.reasoningEffort,
    debugLogEnabled: settings.debugLogEnabled,
    telemetryEnabled: settings.telemetryEnabled,
    notify: settings.notify,
    webSearchTool: settings.webSearchTool,
    env: settings.env,
    machineId: getMachineId(),
  };
}

function getMachineId(): string | undefined {
  try {
    const idPath = path.join(os.homedir(), ".deepcode", "machine-id");
    if (fs.existsSync(idPath)) {
      const raw = fs.readFileSync(idPath, "utf8").trim();
      if (raw) {
        return raw;
      }
    }
    const generated = `${os.hostname()}-${Math.random().toString(36).slice(2)}-${Date.now()}`;
    fs.mkdirSync(path.dirname(idPath), { recursive: true });
    fs.writeFileSync(idPath, generated, "utf8");
    return generated;
  } catch {
    return undefined;
  }
}
