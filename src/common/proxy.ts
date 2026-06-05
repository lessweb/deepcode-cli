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
 * 根据 NO_PROXY 判断目标 URL 是否应绕过代理。
 *
 * Supports / 支持：
 * - `*` wildcard (bypass everything) / 通配符（绕过所有地址）
 * - Exact hostname match (e.g. `localhost`, `example.com`) / 精确主机名匹配
 * - Sub-domain wildcard (e.g. `.example.com` matches `api.example.com`) / 子域名通配
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
      // ".example.com" 同时匹配 "api.example.com" 和 "example.com"
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
 *
 * 从 `source` 中取第一个非空的代理变量，优先级：
 * HTTPS_PROXY → HTTP_PROXY → SOCKS_PROXY → SOCKS5_PROXY（大小写均兼容）。
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
 * 从 source 中读取 NO_PROXY（兼容小写 no_proxy）。
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
 * 按以下优先级解析有效代理地址（由低到高）：
 *   1. 用户级 `settings.json` → `env`
 *   2. 项目级 `settings.json` → `env`
 *   3. 进程环境变量（标准 `HTTP_PROXY` / `HTTPS_PROXY` 及 `DEEPCODE_` 前缀变体）
 *
 * Returns `undefined` when no proxy is configured or when NO_PROXY matches.
 * 未配置代理或命中 NO_PROXY 时返回 `undefined`。
 */
export function resolveProxyUrl(
  targetUrl: string,
  projectRoot: string = process.cwd(),
  processEnv: SettingsProcessEnv = process.env
): ResolvedProxy | undefined {
  // --- Collect proxy vars from each layer ---
  // --- 从各配置层收集代理变量 ---
  const userEnv = readSettings()?.env ?? {};
  const projectEnv = readProjectSettings(projectRoot)?.env ?? {};

  // System env includes both standard proxy vars and DEEPCODE_-prefixed ones
  // (collectDeepcodeEnv strips the prefix, so DEEPCODE_HTTPS_PROXY → HTTPS_PROXY).
  // 系统环境变量同时包含标准代理变量和 DEEPCODE_ 前缀变量
  // （collectDeepcodeEnv 会去除前缀，因此 DEEPCODE_HTTPS_PROXY → HTTPS_PROXY）。
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
  // --- NO_PROXY 检查（系统级拥有绝对优先权）---
  const systemNoProxy = pickNoProxy(systemProxySource);
  if (shouldBypassProxy(targetUrl, systemNoProxy)) {
    return undefined;
  }

  // --- Merge: user < project < system ---
  // --- 合并优先级：用户 < 项目 < 系统 ---
  const merged: Record<string, string | undefined> = {
    ...userEnv,
    ...projectEnv,
    ...systemProxySource,
  };

  // NO_PROXY from merged (user/project may also define it, but system wins)
  // 合并后的 NO_PROXY（用户/项目也可定义，但系统级优先）
  const mergedNoProxy = pickNoProxy(merged);
  if (shouldBypassProxy(targetUrl, mergedNoProxy)) {
    return undefined;
  }

  return pickProxyVar(merged);
}

// ---------------------------------------------------------------------------
// Dispatcher cache – avoids re-creating ProxyAgent on every request.
// Dispatcher 缓存 —— 避免每次请求都重建 ProxyAgent。
// ---------------------------------------------------------------------------
let cachedProxyUrl = "";
let cachedDispatcher: ProxyAgent | null = null;

/**
 * Return a `ProxyAgent` dispatcher when a proxy is configured for the given
 * target URL, or `null` when requests should go direct.
 *
 * 当目标 URL 命中代理配置时返回 `ProxyAgent` dispatcher，否则返回 `null` 直连。
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
 *
 * 自动走代理的 fetch 封装。
 * 任何需要遵循代理配置的 HTTP 请求均应使用此函数替代全局 `fetch`。
 */
export async function proxyFetch(url: string | URL, init?: RequestInit): Promise<Response> {
  const dispatcher = getProxyDispatcher(String(url));
  if (!dispatcher) {
    return fetch(url, init);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (fetch as any)(url, { ...init, dispatcher });
}
