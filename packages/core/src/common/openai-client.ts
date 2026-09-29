import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import OpenAI from "openai";
import { Agent, fetch as undiciFetch } from "undici";
import { readDeepcodePlusSettings, resolveCurrentSettings, type ReasoningEffort } from "../settings";
import { resolveOpenAIConnection, withPlusSubscription, type OpenAIConnectionContext } from "./plus-subscription";
import type { CreateOpenAIClient } from "./tool-types";
export { resolveOpenAIConnection, DEEPCODE_PLUS_BASE_URL } from "./plus-subscription";

// Custom undici Agent with a 180-second keepAlive timeout.  The default
// global fetch (undici) only keeps connections alive for 4 seconds, which
// is too short for a CLI where the user may spend 10–30 seconds reading
// output between prompts.  By passing a dedicated Agent to undiciFetch we
// keep connections reusable for three minutes after the last request.
const keepAliveAgent = new Agent({ keepAliveTimeout: 180_000 });

// A stalled provider connection used to hang a request forever: the OpenAI
// SDK's own timeout only covers the wait for response headers, so a stream
// that goes silent after the headers arrived (gateway hiccup, black-holed
// connection) never aborts and the CLI spins until the user interrupts.
// These defaults bound both waits; they mirror what other coding agents use.
const STREAM_HEADER_TIMEOUT_MS = 300_000;
const STREAM_CHUNK_TIMEOUT_MS = 300_000;

type TimeoutFetchOptions = {
  headerTimeoutMs?: number;
  chunkTimeoutMs?: number;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FetchLike = (input: any, init?: any) => Promise<Response>;

// Applies a response-header timeout and a per-chunk idle timeout at the fetch
// layer. The header timer is cleared once headers arrive; after that every
// received chunk resets the idle timer, so a healthy stream of any length is
// never cut off — only a silent connection is. The caller's own signal (the
// SDK's or an abort request) is combined, and our timers abort with a
// descriptive reason that surfaces as the request's error message.
export function timeoutFetch(fetchImpl: FetchLike, options: TimeoutFetchOptions = {}): FetchLike {
  const headerTimeoutMs = options.headerTimeoutMs ?? STREAM_HEADER_TIMEOUT_MS;
  const chunkTimeoutMs = options.chunkTimeoutMs ?? STREAM_CHUNK_TIMEOUT_MS;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return async (input: any, init?: any) => {
    const opts = { ...(init ?? {}) };
    const headerController = new AbortController();
    const chunkController = new AbortController();
    const signals = [...(opts.signal ? [opts.signal] : []), headerController.signal, chunkController.signal];
    if (signals.length > 1) {
      opts.signal = AbortSignal.any(signals);
    } else if (signals.length === 1) {
      opts.signal = signals[0];
    }

    const headerTimer = setTimeout(
      () =>
        headerController.abort(
          new Error(`No response headers after ${Math.round(headerTimeoutMs / 1000)}s from the provider.`)
        ),
      headerTimeoutMs
    );

    let response: Response;
    try {
      response = await fetchImpl(input, opts);
    } finally {
      clearTimeout(headerTimer);
    }
    if (!response.body) {
      return response;
    }
    return wrapBodyWithIdleTimeout(response, response.body, chunkController, chunkTimeoutMs);
  };
}

function wrapBodyWithIdleTimeout(
  response: Response,
  upstream: ReadableStream<Uint8Array>,
  controller: AbortController,
  chunkTimeoutMs: number
): Response {
  let chunkTimer: ReturnType<typeof setTimeout> | undefined;
  const clearChunkTimer = () => {
    if (chunkTimer) {
      clearTimeout(chunkTimer);
      chunkTimer = undefined;
    }
  };
  const scheduleChunkAbort = () => {
    chunkTimer = setTimeout(
      () =>
        controller.abort(
          new Error(`No data received for ${Math.round(chunkTimeoutMs / 1000)}s while streaming from the provider.`)
        ),
      chunkTimeoutMs
    );
  };
  const upstreamReader = upstream.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(downstream) {
      try {
        const { done, value } = await upstreamReader.read();
        if (done) {
          clearChunkTimer();
          downstream.close();
          return;
        }
        clearChunkTimer();
        scheduleChunkAbort();
        downstream.enqueue(value);
      } catch (error) {
        clearChunkTimer();
        downstream.error(error);
      }
    },
    cancel(reason) {
      clearChunkTimer();
      return upstreamReader.cancel(reason);
    },
  });
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

// Module-level cache for the OpenAI client instance.  The client itself is
// a stateless fetch wrapper, so it is safe to share across calls as long as
// the apiKey + baseURL stay the same.  Model, thinking-mode and other
// settings are always read fresh from the project / user config files.
let cachedOpenAI: OpenAI | null = null;
let cachedOpenAIKey = "";

export function createOpenAIClientFactory(projectRoot: string = process.cwd()): CreateOpenAIClient {
  return withPlusSubscription(
    () => resolveCurrentSettings(projectRoot),
    (context) => createOpenAIClient(projectRoot, context)
  );
}

export function createOpenAIClient(
  projectRoot: string = process.cwd(),
  context?: OpenAIConnectionContext
): {
  client: OpenAI | null;
  apiKey?: string;
  model: string;
  baseURL: string;
  temperature?: number;
  thinkingEnabled: boolean;
  reasoningEffort: ReasoningEffort;
  debugLogEnabled: boolean;
  telemetryEnabled: boolean;
  notify?: string;
  webSearchTool?: string;
  env: Record<string, string>;
  machineId?: string;
  plusApiKey?: string;
  usingPlus: boolean;
  configurationError?: string;
} {
  const settings = resolveCurrentSettings(projectRoot);
  const plusSettings = context ? undefined : readDeepcodePlusSettings();
  const plusApiKey = context ? context.plusApiKey : plusSettings?.apiKey;
  const connection =
    context?.connection ?? resolveOpenAIConnection(settings, plusApiKey, plusSettings?.subscriptionPlan);
  if (!connection.apiKey) {
    return {
      client: null,
      apiKey: undefined,
      model: settings.model,
      baseURL: connection.baseURL,
      temperature: settings.temperature,
      thinkingEnabled: settings.thinkingEnabled,
      reasoningEffort: settings.reasoningEffort,
      debugLogEnabled: settings.debugLogEnabled,
      telemetryEnabled: settings.telemetryEnabled,
      notify: settings.notify,
      webSearchTool: settings.webSearchTool,
      env: settings.env,
      machineId: getMachineId(),
      plusApiKey,
      usingPlus: connection.usingPlus,
      configurationError: connection.configurationError,
    };
  }

  const cacheKey = `${connection.apiKey}::${connection.baseURL}`;
  if (cachedOpenAI && cachedOpenAIKey === cacheKey) {
    return {
      client: cachedOpenAI,
      apiKey: connection.apiKey,
      model: settings.model,
      baseURL: connection.baseURL,
      temperature: settings.temperature,
      thinkingEnabled: settings.thinkingEnabled,
      reasoningEffort: settings.reasoningEffort,
      debugLogEnabled: settings.debugLogEnabled,
      telemetryEnabled: settings.telemetryEnabled,
      notify: settings.notify,
      webSearchTool: settings.webSearchTool,
      env: settings.env,
      machineId: getMachineId(),
      plusApiKey,
      usingPlus: connection.usingPlus,
      configurationError: connection.configurationError,
    };
  }

  cachedOpenAI = new OpenAI({
    apiKey: connection.apiKey,
    baseURL: connection.baseURL || undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fetch: timeoutFetch((url: any, init: any) => undiciFetch(url, { ...init, dispatcher: keepAliveAgent })),
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
    apiKey: connection.apiKey,
    model: settings.model,
    baseURL: connection.baseURL,
    temperature: settings.temperature,
    thinkingEnabled: settings.thinkingEnabled,
    reasoningEffort: settings.reasoningEffort,
    debugLogEnabled: settings.debugLogEnabled,
    telemetryEnabled: settings.telemetryEnabled,
    notify: settings.notify,
    webSearchTool: settings.webSearchTool,
    env: settings.env,
    machineId: getMachineId(),
    plusApiKey,
    usingPlus: connection.usingPlus,
    configurationError: connection.configurationError,
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
