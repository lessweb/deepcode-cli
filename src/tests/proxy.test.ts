import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resolveProxyUrl, getProxyDispatcher, proxyFetch } from "../common/proxy";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const originalFetch = globalThis.fetch;
const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function setHomeDir(dir: string): void {
  process.env.HOME = dir;
  if (process.platform === "win32") {
    process.env.USERPROFILE = dir;
  }
}

/**
 * Write a settings.json under <home>/.deepcode/settings.json.
 * 在临时 home 目录下创建用户级 settings.json。
 */
function writeUserSettings(home: string, env: Record<string, string>): void {
  const dir = path.join(home, ".deepcode");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "settings.json"), JSON.stringify({ env }), "utf8");
}

/**
 * Write a settings.json under <projectRoot>/.deepcode/settings.json.
 * 在项目根目录下创建项目级 settings.json。
 */
function writeProjectSettings(projectRoot: string, env: Record<string, string>): void {
  const dir = path.join(projectRoot, ".deepcode");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "settings.json"), JSON.stringify({ env }), "utf8");
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }
  if (originalUserProfile === undefined) {
    delete process.env.USERPROFILE;
  } else {
    process.env.USERPROFILE = originalUserProfile;
  }

  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

// ---------------------------------------------------------------------------
// resolveProxyUrl – no proxy configured
// ---------------------------------------------------------------------------

test("resolveProxyUrl returns undefined when no proxy is configured", () => {
  const home = createTempDir("deepcode-proxy-home-");
  const projectRoot = createTempDir("deepcode-proxy-project-");
  setHomeDir(home);

  const result = resolveProxyUrl("https://api.deepseek.com", projectRoot, {});
  assert.equal(result, undefined);
});

// ---------------------------------------------------------------------------
// resolveProxyUrl – system env vars
// ---------------------------------------------------------------------------

test("resolveProxyUrl picks HTTPS_PROXY from system env", () => {
  const home = createTempDir("deepcode-proxy-https-home-");
  const projectRoot = createTempDir("deepcode-proxy-https-project-");
  setHomeDir(home);

  const result = resolveProxyUrl("https://api.deepseek.com", projectRoot, {
    HTTPS_PROXY: "http://127.0.0.1:7890",
  });
  assert.ok(result);
  assert.equal(result.url, "http://127.0.0.1:7890");
  assert.equal(result.type, "https");
});

test("resolveProxyUrl picks HTTP_PROXY when HTTPS_PROXY is absent", () => {
  const home = createTempDir("deepcode-proxy-http-home-");
  const projectRoot = createTempDir("deepcode-proxy-http-project-");
  setHomeDir(home);

  const result = resolveProxyUrl("https://api.deepseek.com", projectRoot, {
    HTTP_PROXY: "http://127.0.0.1:8080",
  });
  assert.ok(result);
  assert.equal(result.url, "http://127.0.0.1:8080");
  assert.equal(result.type, "http");
});

test("resolveProxyUrl prefers HTTPS_PROXY over HTTP_PROXY", () => {
  const home = createTempDir("deepcode-proxy-pref-home-");
  const projectRoot = createTempDir("deepcode-proxy-pref-project-");
  setHomeDir(home);

  const result = resolveProxyUrl("https://api.deepseek.com", projectRoot, {
    HTTPS_PROXY: "http://proxy-https:7890",
    HTTP_PROXY: "http://proxy-http:8080",
  });
  assert.ok(result);
  assert.equal(result.url, "http://proxy-https:7890");
  assert.equal(result.type, "https");
});

test("resolveProxyUrl picks SOCKS_PROXY when no HTTP/HTTPS proxy is set", () => {
  const home = createTempDir("deepcode-proxy-socks-home-");
  const projectRoot = createTempDir("deepcode-proxy-socks-project-");
  setHomeDir(home);

  const result = resolveProxyUrl("https://api.deepseek.com", projectRoot, {
    SOCKS_PROXY: "socks5://127.0.0.1:1080",
  });
  assert.ok(result);
  assert.equal(result.url, "socks5://127.0.0.1:1080");
  assert.equal(result.type, "socks5");
});

test("resolveProxyUrl picks SOCKS5_PROXY as alias for SOCKS_PROXY", () => {
  const home = createTempDir("deepcode-proxy-socks5-home-");
  const projectRoot = createTempDir("deepcode-proxy-socks5-project-");
  setHomeDir(home);

  const result = resolveProxyUrl("https://api.deepseek.com", projectRoot, {
    SOCKS5_PROXY: "socks5://127.0.0.1:1081",
  });
  assert.ok(result);
  assert.equal(result.url, "socks5://127.0.0.1:1081");
  assert.equal(result.type, "socks5");
});

test("resolveProxyUrl supports lowercase proxy env vars", () => {
  const home = createTempDir("deepcode-proxy-lower-home-");
  const projectRoot = createTempDir("deepcode-proxy-lower-project-");
  setHomeDir(home);

  const result = resolveProxyUrl("https://api.deepseek.com", projectRoot, {
    https_proxy: "http://lower-proxy:7890",
  });
  assert.ok(result);
  assert.equal(result.url, "http://lower-proxy:7890");
  assert.equal(result.type, "https");
});

test("resolveProxyUrl supports DEEPCODE_ prefixed env vars", () => {
  const home = createTempDir("deepcode-proxy-prefix-home-");
  const projectRoot = createTempDir("deepcode-proxy-prefix-project-");
  setHomeDir(home);

  const result = resolveProxyUrl("https://api.deepseek.com", projectRoot, {
    DEEPCODE_HTTPS_PROXY: "http://deepproxy:7890",
  });
  assert.ok(result);
  assert.equal(result.url, "http://deepproxy:7890");
  assert.equal(result.type, "https");
});

// ---------------------------------------------------------------------------
// resolveProxyUrl – settings.json
// ---------------------------------------------------------------------------

test("resolveProxyUrl reads proxy from user-level settings.json env", () => {
  const home = createTempDir("deepcode-proxy-user-settings-home-");
  const projectRoot = createTempDir("deepcode-proxy-user-settings-project-");
  setHomeDir(home);
  writeUserSettings(home, { HTTPS_PROXY: "http://user-proxy:7890" });

  const result = resolveProxyUrl("https://api.deepseek.com", projectRoot, {});
  assert.ok(result);
  assert.equal(result.url, "http://user-proxy:7890");
  assert.equal(result.type, "https");
});

test("resolveProxyUrl reads proxy from project-level settings.json env", () => {
  const home = createTempDir("deepcode-proxy-project-settings-home-");
  const projectRoot = createTempDir("deepcode-proxy-project-settings-project-");
  setHomeDir(home);
  writeProjectSettings(projectRoot, { HTTPS_PROXY: "http://project-proxy:7890" });

  const result = resolveProxyUrl("https://api.deepseek.com", projectRoot, {});
  assert.ok(result);
  assert.equal(result.url, "http://project-proxy:7890");
  assert.equal(result.type, "https");
});

test("resolveProxyUrl: system env overrides user settings.json", () => {
  const home = createTempDir("deepcode-proxy-override-home-");
  const projectRoot = createTempDir("deepcode-proxy-override-project-");
  setHomeDir(home);
  writeUserSettings(home, { HTTPS_PROXY: "http://user-proxy:7890" });

  const result = resolveProxyUrl("https://api.deepseek.com", projectRoot, {
    HTTPS_PROXY: "http://system-proxy:9999",
  });
  assert.ok(result);
  assert.equal(result.url, "http://system-proxy:9999");
});

test("resolveProxyUrl: project settings override user settings", () => {
  const home = createTempDir("deepcode-proxy-proj-override-home-");
  const projectRoot = createTempDir("deepcode-proxy-proj-override-project-");
  setHomeDir(home);
  writeUserSettings(home, { HTTPS_PROXY: "http://user-proxy:7890" });
  writeProjectSettings(projectRoot, { HTTPS_PROXY: "http://project-proxy:8888" });

  const result = resolveProxyUrl("https://api.deepseek.com", projectRoot, {});
  assert.ok(result);
  assert.equal(result.url, "http://project-proxy:8888");
});

// ---------------------------------------------------------------------------
// resolveProxyUrl – NO_PROXY
// ---------------------------------------------------------------------------

test("resolveProxyUrl returns undefined when NO_PROXY matches exact hostname", () => {
  const home = createTempDir("deepcode-proxy-noproxy-home-");
  const projectRoot = createTempDir("deepcode-proxy-noproxy-project-");
  setHomeDir(home);

  const result = resolveProxyUrl("https://api.deepseek.com", projectRoot, {
    HTTPS_PROXY: "http://proxy:7890",
    NO_PROXY: "api.deepseek.com",
  });
  assert.equal(result, undefined);
});

test("resolveProxyUrl bypasses proxy when NO_PROXY contains *", () => {
  const home = createTempDir("deepcode-proxy-noproxy-star-home-");
  const projectRoot = createTempDir("deepcode-proxy-noproxy-star-project-");
  setHomeDir(home);

  const result = resolveProxyUrl("https://api.deepseek.com", projectRoot, {
    HTTPS_PROXY: "http://proxy:7890",
    NO_PROXY: "*",
  });
  assert.equal(result, undefined);
});

test("resolveProxyUrl supports subdomain wildcard in NO_PROXY (.example.com)", () => {
  const home = createTempDir("deepcode-proxy-noproxy-sub-home-");
  const projectRoot = createTempDir("deepcode-proxy-noproxy-sub-project-");
  setHomeDir(home);

  const result = resolveProxyUrl("https://api.deepseek.com", projectRoot, {
    HTTPS_PROXY: "http://proxy:7890",
    NO_PROXY: ".deepseek.com",
  });
  assert.equal(result, undefined);
});

test("resolveProxyUrl: NO_PROXY entry also matches the base domain", () => {
  const home = createTempDir("deepcode-proxy-noproxy-base-home-");
  const projectRoot = createTempDir("deepcode-proxy-noproxy-base-project-");
  setHomeDir(home);

  // ".deepseek.com" should also match "deepseek.com" itself
  const result = resolveProxyUrl("https://deepseek.com", projectRoot, {
    HTTPS_PROXY: "http://proxy:7890",
    NO_PROXY: ".deepseek.com",
  });
  assert.equal(result, undefined);
});

test("resolveProxyUrl does not bypass when NO_PROXY doesn't match", () => {
  const home = createTempDir("deepcode-proxy-noproxy-nomatch-home-");
  const projectRoot = createTempDir("deepcode-proxy-noproxy-nomatch-project-");
  setHomeDir(home);

  const result = resolveProxyUrl("https://api.deepseek.com", projectRoot, {
    HTTPS_PROXY: "http://proxy:7890",
    NO_PROXY: "localhost,127.0.0.1",
  });
  assert.ok(result);
  assert.equal(result.url, "http://proxy:7890");
});

test("resolveProxyUrl ignores empty NO_PROXY", () => {
  const home = createTempDir("deepcode-proxy-noproxy-empty-home-");
  const projectRoot = createTempDir("deepcode-proxy-noproxy-empty-project-");
  setHomeDir(home);

  const result = resolveProxyUrl("https://api.deepseek.com", projectRoot, {
    HTTPS_PROXY: "http://proxy:7890",
    NO_PROXY: "  ",
  });
  assert.ok(result);
  assert.equal(result.url, "http://proxy:7890");
});

test("resolveProxyUrl supports lowercase no_proxy", () => {
  const home = createTempDir("deepcode-proxy-noproxy-lower-home-");
  const projectRoot = createTempDir("deepcode-proxy-noproxy-lower-project-");
  setHomeDir(home);

  const result = resolveProxyUrl("https://api.deepseek.com", projectRoot, {
    HTTPS_PROXY: "http://proxy:7890",
    no_proxy: "api.deepseek.com",
  });
  assert.equal(result, undefined);
});

test("resolveProxyUrl: NO_PROXY from settings.json also works", () => {
  const home = createTempDir("deepcode-proxy-noproxy-settings-home-");
  const projectRoot = createTempDir("deepcode-proxy-noproxy-settings-project-");
  setHomeDir(home);
  writeUserSettings(home, {
    HTTPS_PROXY: "http://proxy:7890",
    NO_PROXY: "api.deepseek.com",
  });

  const result = resolveProxyUrl("https://api.deepseek.com", projectRoot, {});
  assert.equal(result, undefined);
});

// ---------------------------------------------------------------------------
// resolveProxyUrl – empty / whitespace values
// ---------------------------------------------------------------------------

test("resolveProxyUrl trims whitespace from proxy URL", () => {
  const home = createTempDir("deepcode-proxy-trim-home-");
  const projectRoot = createTempDir("deepcode-proxy-trim-project-");
  setHomeDir(home);

  const result = resolveProxyUrl("https://api.deepseek.com", projectRoot, {
    HTTPS_PROXY: "  http://proxy:7890  ",
  });
  assert.ok(result);
  assert.equal(result.url, "http://proxy:7890");
});

test("resolveProxyUrl ignores empty-string proxy env vars", () => {
  const home = createTempDir("deepcode-proxy-emptystr-home-");
  const projectRoot = createTempDir("deepcode-proxy-emptystr-project-");
  setHomeDir(home);

  const result = resolveProxyUrl("https://api.deepseek.com", projectRoot, {
    HTTPS_PROXY: "",
    HTTP_PROXY: "   ",
  });
  assert.equal(result, undefined);
});

// ---------------------------------------------------------------------------
// getProxyDispatcher – caching
// ---------------------------------------------------------------------------

test("getProxyDispatcher returns null when no proxy is configured", () => {
  const home = createTempDir("deepcode-proxy-dispatcher-null-home-");
  const projectRoot = createTempDir("deepcode-proxy-dispatcher-null-project-");
  setHomeDir(home);

  const dispatcher = getProxyDispatcher("https://api.deepseek.com");
  assert.equal(dispatcher, null);
});

test("getProxyDispatcher returns a ProxyAgent when proxy is configured", () => {
  const home = createTempDir("deepcode-proxy-dispatcher-home-");
  const projectRoot = createTempDir("deepcode-proxy-dispatcher-project-");
  setHomeDir(home);
  writeUserSettings(home, { HTTPS_PROXY: "http://proxy:7890" });

  // Use a URL not in NO_PROXY to ensure we get a dispatcher.
  // Note: getProxyDispatcher uses the default targetUrl for resolveProxyUrl,
  // but since we configured proxy in user settings, it will be picked up.
  const dispatcher = getProxyDispatcher("https://api.deepseek.com");
  assert.ok(dispatcher, "Expected a ProxyAgent, got null");
});

test("getProxyDispatcher caches the same dispatcher for the same proxy URL", () => {
  const home = createTempDir("deepcode-proxy-dispatcher-cache-home-");
  const projectRoot = createTempDir("deepcode-proxy-dispatcher-cache-project-");
  setHomeDir(home);
  writeUserSettings(home, { HTTPS_PROXY: "http://proxy:7890" });

  const d1 = getProxyDispatcher("https://api.deepseek.com");
  const d2 = getProxyDispatcher("https://api.deepseek.com");
  assert.ok(d1);
  assert.equal(d1, d2, "Expected cached dispatcher to be returned");
});

// ---------------------------------------------------------------------------
// proxyFetch – falls back to global fetch when no proxy
// ---------------------------------------------------------------------------

test("proxyFetch uses global fetch when no proxy is configured", async () => {
  const home = createTempDir("deepcode-proxy-fetch-home-");
  const projectRoot = createTempDir("deepcode-proxy-fetch-project-");
  setHomeDir(home);

  const calls: Array<{ url: string }> = [];
  globalThis.fetch = ((url: string | URL | Request) => {
    calls.push({ url: String(url) });
    return Promise.resolve(new Response("ok"));
  }) as typeof globalThis.fetch;

  const response = await proxyFetch("https://api.deepseek.com/test");
  assert.equal(response.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.deepseek.com/test");
});

test("proxyFetch passes init options through to fetch", async () => {
  const home = createTempDir("deepcode-proxy-fetch-init-home-");
  const projectRoot = createTempDir("deepcode-proxy-fetch-init-project-");
  setHomeDir(home);

  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return Promise.resolve(new Response("ok"));
  }) as typeof globalThis.fetch;

  await proxyFetch("https://api.deepseek.com/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: '{"key": "value"}',
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].init?.method, "POST");
  assert.equal(calls[0].init?.body, '{"key": "value"}');
});

// ---------------------------------------------------------------------------
// proxyFetch – uses dispatcher when proxy is configured
// ---------------------------------------------------------------------------

test("proxyFetch injects dispatcher when proxy is configured", async () => {
  const home = createTempDir("deepcode-proxy-fetch-proxy-home-");
  const projectRoot = createTempDir("deepcode-proxy-fetch-proxy-project-");
  setHomeDir(home);
  writeUserSettings(home, { HTTPS_PROXY: "http://proxy:7890" });

  const calls: Array<{ url: string; init?: Record<string, unknown> }> = [];
  globalThis.fetch = ((url: string | URL | Request, init?: Record<string, unknown>) => {
    calls.push({ url: String(url), init });
    return Promise.resolve(new Response("ok"));
  }) as typeof globalThis.fetch;

  await proxyFetch("https://api.deepseek.com/test", { method: "GET" });

  assert.equal(calls.length, 1);
  // When proxy is configured, the init object should contain a dispatcher.
  assert.ok(calls[0].init?.dispatcher, "Expected a dispatcher in the fetch init");
});
