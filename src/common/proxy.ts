import { ProxyAgent } from "undici";
import { readSettings, readProjectSettings } from "../settings";
import type { SettingsProcessEnv } from "../settings";

export type ProxyType = "http" | "https" | "socks5";

export type ResolvedProxy = {
  url: string;
  type: ProxyType;
};

/**
 * Determine whether a target URL should bypass the proxy based on NO_PROXY.
 *
 * Supports:
 * - `*` wildcard (bypass everything)
 * - Exact hostname match (e.g. `localhost`, `example.com`)
 * - Sub-domain wildcard (e.g. `.example.com` matches `api.example.com`)
 */
function shouldBypassProxy(targetUrl: string, noProxy: string): boolean {
  if (!noProxy.trim()) {
    return false;
  }

  const entries = noProxy
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  if (entries.includes("*")) {
    return true;
  }

  let hostname: string;
  try {
    hostname = new URL(targetUrl).hostname.toLowerCase();
  } catch {
    return false;
  }

  for (const entry of entries) {
    if (entry.startsWith(".")) {
      // ".example.com" matches "api.example.com" and "example.com"
      if (hostname.endsWith(entry) || hostname === entry.slice(1)) {
        return true;
      }
    } else if (hostname === entry || hostname.endsWith(`.${entry}`)) {
      return true;
    }
  }

  return false;
}

/**
 * Pick the first non-empty proxy variable from `source`, preferring
 * HTTPS_PROXY → HTTP_PROXY → SOCKS_PROXY → SOCKS5_PROXY (case-insensitive
 * lowercase fallback for each).
 */
function pickProxyVar(source: Record<string, string | undefined>): { url: string; type: ProxyType } | undefined {
  const candidates: Array<{ keys: string[]; type: ProxyType }> = [
    { keys: ["HTTPS_PROXY", "https_proxy"], type: "https" },
    { keys: ["HTTP_PROXY", "http_proxy"], type: "http" },
    { keys: ["SOCKS_PROXY", "socks_proxy", "SOCKS5_PROXY", "socks5_proxy"], type: "socks5" },
  ];

  for (const { keys, type } of candidates) {
    for (const key of keys) {
      const value = source[key];
      if (typeof value === "string" && value.trim()) {
        return { url: value.trim(), type };
      }
    }
  }

  return undefined;
}

/**
 * Pick NO_PROXY from a source (case-insensitive fallback).
 */
function pickNoProxy(source: Record<string, string | undefined>): string {
  return (
    (typeof source.NO_PROXY === "string" && source.NO_PROXY) ||
    (typeof source.no_proxy === "string" && source.no_proxy) ||
    ""
  );
}

/**
 * Resolve the effective proxy URL by consulting (in ascending priority):
 *   1. User-level `settings.json` → `env`
 *   2. Project-level `settings.json` → `env`
 *   3. Process environment variables (both standard `HTTP_PROXY` / `HTTPS_PROXY`
 *      and `DEEPCODE_`-prefixed variants)
 *
 * Returns `undefined` when no proxy is configured or when NO_PROXY matches.
 */
export function resolveProxyUrl(
  targetUrl: string,
  projectRoot: string = process.cwd(),
  processEnv: SettingsProcessEnv = process.env
): ResolvedProxy | undefined {
  // --- Collect proxy vars from each layer ---
  const userEnv = readSettings()?.env ?? {};
  const projectEnv = readProjectSettings(projectRoot)?.env ?? {};

  // System env includes both standard proxy vars and DEEPCODE_-prefixed ones
  // (collectDeepcodeEnv strips the prefix, so DEEPCODE_HTTPS_PROXY → HTTPS_PROXY).
  const systemProxySource: Record<string, string | undefined> = { ...processEnv };
  for (const [key, value] of Object.entries(processEnv)) {
    if (key.startsWith("DEEPCODE_") && typeof value === "string") {
      const stripped = key.slice("DEEPCODE_".length);
      if (stripped) {
        systemProxySource[stripped] = value;
      }
    }
  }

  // --- NO_PROXY check (system level takes absolute precedence) ---
  const systemNoProxy = pickNoProxy(systemProxySource);
  if (shouldBypassProxy(targetUrl, systemNoProxy)) {
    return undefined;
  }

  // --- Merge: user < project < system ---
  const merged: Record<string, string | undefined> = {
    ...userEnv,
    ...projectEnv,
    ...systemProxySource,
  };

  // NO_PROXY from merged (user/project may also define it, but system wins)
  const mergedNoProxy = pickNoProxy(merged);
  if (shouldBypassProxy(targetUrl, mergedNoProxy)) {
    return undefined;
  }

  return pickProxyVar(merged);
}

// ---------------------------------------------------------------------------
// Dispatcher cache – avoids re-creating ProxyAgent on every request.
// ---------------------------------------------------------------------------
let cachedProxyUrl = "";
let cachedDispatcher: ProxyAgent | null = null;

/**
 * Return a `ProxyAgent` dispatcher when a proxy is configured for the given
 * target URL, or `null` when requests should go direct.
 */
export function getProxyDispatcher(targetUrl?: string): ProxyAgent | null {
  const resolved = resolveProxyUrl(targetUrl ?? "https://api.deepseek.com");
  const proxyUrl = resolved?.url ?? "";

  if (!proxyUrl) {
    cachedProxyUrl = "";
    cachedDispatcher = null;
    return null;
  }

  if (cachedDispatcher && cachedProxyUrl === proxyUrl) {
    return cachedDispatcher;
  }

  cachedProxyUrl = proxyUrl;
  cachedDispatcher = new ProxyAgent({
    uri: proxyUrl,
    keepAliveTimeout: 180_000,
  });
  return cachedDispatcher;
}

/**
 * Fetch wrapper that automatically routes through the configured proxy.
 * Use this in place of the global `fetch` for any HTTP request that should
 * respect the proxy configuration.
 */
export async function proxyFetch(url: string | URL, init?: RequestInit): Promise<Response> {
  const dispatcher = getProxyDispatcher(String(url));
  if (!dispatcher) {
    return fetch(url, init);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (fetch as any)(url, { ...init, dispatcher });
}
