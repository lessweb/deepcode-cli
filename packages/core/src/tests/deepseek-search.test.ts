import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import type OpenAI from "openai";
import type { ToolExecutionContext } from "../tools/executor";
import { handleWebSearchTool } from "../tools/web-search-handler";

const source = {
  title: "DeepSeek release",
  url: "https://example.com/release",
  snippet: "Short summary",
  summary: "Detailed summary",
  date: "2026-10-30T00:00:00Z",
};

function setup(t: TestContext) {
  const controller = new AbortController();
  const starts: Array<string | number> = [];
  const exits: Array<string | number> = [];
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const chat = t.mock.fn(async () => ({ choices: [{ message: { content: '{"dominant_language":"en"}' } }] }));
  const client = {
    client: { chat: { completions: { create: chat } } } as unknown as OpenAI,
    model: "test",
    thinkingEnabled: true,
    debugLogEnabled: false,
    apiKey: "sk-test",
    baseURL: "https://api.deepseek.com",
    deepseekSearchApiEnabled: true as boolean | undefined,
    machineId: "test-machine",
    webSearchTool: undefined as string | undefined,
  };
  const context: ToolExecutionContext = {
    projectRoot: process.cwd(),
    sessionId: "search-test",
    toolCall: { id: "search", type: "function", function: { name: "WebSearch", arguments: "{}" } },
    signal: controller.signal,
    createOpenAIClient: () => client,
    onProcessStart: (id) => starts.push(id),
    onProcessExit: (id) => exits.push(id),
    onPluginRateLimitExceeded: () => assert.fail("Official search must not trigger Plus rate limit hints"),
  };
  t.mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
    requests.push({ url, init });
    return Response.json({ results: [source] });
  });
  return { controller, starts, exits, requests, chat, client, context };
}

test("official search sends the original query, overrides scripts and formats sources", async (t) => {
  const f = setup(t);
  f.client.webSearchTool = "/does-not-exist";
  const query = " DeepSeek 新版 site:deepseek.com ";
  const result = await handleWebSearchTool({ query }, f.context);
  assert.equal(result.ok, true);
  assert.equal(result.output, `1. ${source.title}\n${source.url}\nDate: ${source.date}\n${source.summary}`);
  assert.equal(result.metadata?.translated, false);
  assert.equal(result.metadata?.resolvedQuery, query);
  assert.equal(f.chat.mock.callCount(), 0);
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].url, "https://api.deepseek.com/v1/tools/search");
  const init = f.requests[0].init!;
  assert.equal(init.method, "POST");
  assert.equal(init.redirect, "error");
  assert.equal(init.signal, f.controller.signal);
  assert.deepEqual(init.headers, { Authorization: "Bearer sk-test", "Content-Type": "application/json" });
  assert.deepEqual(JSON.parse(String(init.body)), { query, count: 10, need_content: false });
  assert.equal(f.starts.length, 1);
  assert.deepEqual(f.exits, f.starts);
});

for (const [baseURL, enabled] of [
  ["https://api.deepseek.com", false],
  ["https://api.deepseek.com", undefined],
  ["https://api.deepseek.com/", true],
  ["https://api.deepseek.com/v1", true],
  ["https://example.com", true],
  ["https://chat.deepcodeplus.com/plugin/openai", true],
] as const) {
  test(`existing search remains active for ${baseURL}, enabled=${enabled}`, async (t) => {
    const f = setup(t);
    f.client.baseURL = baseURL;
    f.client.deepseekSearchApiEnabled = enabled;
    const fetchMock = t.mock.method(globalThis, "fetch", async (url: string) => {
      assert.match(url, /\/api\/plugin\/web-search$/);
      return Response.json({ success: true, result: "existing result" });
    });
    const result = await handleWebSearchTool({ query: "query" }, f.context);
    assert.equal(result.output, "existing result");
    assert.equal(f.chat.mock.callCount(), 1);
    assert.equal(fetchMock.mock.callCount(), 1);
  });
}

for (const [baseURL, enabled] of [
  ["https://api.deepseek.com", false],
  ["https://example.com", true],
] as const) {
  test(`configured scripts remain active for ${baseURL}, enabled=${enabled}`, async (t) => {
    const f = setup(t);
    f.client.baseURL = baseURL;
    f.client.deepseekSearchApiEnabled = enabled;
    f.client.webSearchTool = process.execPath;
    const result = await handleWebSearchTool({ query: "--version" }, f.context);
    assert.equal(result.ok, true);
    assert.equal(result.output?.trim(), process.version);
    assert.equal(f.chat.mock.callCount(), 0);
    assert.equal(f.requests.length, 0);
  });
}

for (const [summary, date] of [
  ["", null],
  [undefined, ""],
] as const) {
  test(`official search falls back to snippet when summary=${summary}`, async (t) => {
    const f = setup(t);
    t.mock.method(globalThis, "fetch", async () => Response.json({ results: [{ ...source, summary, date }, source] }));
    const result = await handleWebSearchTool({ query: "query" }, f.context);
    assert.equal(result.ok, true);
    assert.ok(result.output?.startsWith(`1. ${source.title}\n${source.url}\n${source.snippet}\n\n2.`));
  });
}

test("official search accepts an empty results array", async (t) => {
  const f = setup(t);
  t.mock.method(globalThis, "fetch", async () => Response.json({ results: [] }));
  const result = await handleWebSearchTool({ query: "query" }, f.context);
  assert.equal(result.ok, true);
  assert.equal(result.output, "No search results found.");
});

test("official search bounds output and records truncation", async (t) => {
  const f = setup(t);
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ results: [{ ...source, summary: "x".repeat(40000) }] })
  );
  const result = await handleWebSearchTool({ query: "query" }, f.context);
  assert.equal(result.output?.length, 30000);
  assert.equal(result.metadata?.truncated, true);
});

test("official search counts Unicode code points and rejects long or blank queries before dispatch", async (t) => {
  const f = setup(t);
  assert.equal((await handleWebSearchTool({ query: "😀".repeat(128) }, f.context)).ok, true);
  const long = await handleWebSearchTool({ query: "😀".repeat(129) }, f.context);
  assert.equal(long.ok, false);
  assert.match(long.error ?? "", /128 Unicode characters/);
  assert.equal((await handleWebSearchTool({ query: "   " }, f.context)).ok, false);
  assert.equal(f.requests.length, 1);
});

test("official search requires a key and does not fall back to a configured script", async (t) => {
  const f = setup(t);
  f.client.apiKey = "";
  f.client.webSearchTool = "/does-not-exist";
  const result = await handleWebSearchTool({ query: "query" }, f.context);
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /requires an API key/);
  assert.equal(f.requests.length, 0);
  assert.equal(f.starts.length, 0);
});

for (const status of [401, 429, 500]) {
  test(`official search reports HTTP ${status} without retry or fallback`, async (t) => {
    const f = setup(t);
    const fetchMock = t.mock.method(globalThis, "fetch", async () =>
      Response.json({ error: { message: "Upstream failure" } }, { status })
    );
    const result = await handleWebSearchTool({ query: "query" }, f.context);
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", new RegExp(`HTTP ${status}.*Upstream failure`));
    assert.equal(fetchMock.mock.callCount(), 1);
    assert.equal(f.chat.mock.callCount(), 0);
    assert.equal(f.starts.length, 1);
    assert.deepEqual(f.exits, f.starts);
  });
}

for (const body of ["not JSON", "null", "{}", '{"results":{}}', '{"results":[{}]}']) {
  test(`official search rejects malformed response ${body}`, async (t) => {
    const f = setup(t);
    t.mock.method(globalThis, "fetch", async () => new Response(body));
    const result = await handleWebSearchTool({ query: "query" }, f.context);
    assert.equal(result.ok, false);
    assert.equal(f.chat.mock.callCount(), 0);
    assert.deepEqual(f.exits, f.starts);
  });
}

test("official search retains HTTP status for non-JSON errors", async (t) => {
  const f = setup(t);
  t.mock.method(globalThis, "fetch", async () => new Response("Bad gateway", { status: 502 }));
  const result = await handleWebSearchTool({ query: "query" }, f.context);
  assert.match(result.error ?? "", /HTTP 502/);
});

for (const stage of ["before", "request", "body", "error-body"] as const) {
  test(`official search propagates cancellation at ${stage}`, async (t) => {
    const f = setup(t);
    const pending = async () => {
      f.controller.abort();
      throw f.controller.signal.reason;
    };
    const fetchMock = t.mock.method(
      globalThis,
      "fetch",
      stage === "request"
        ? pending
        : async () => ({
            ok: stage !== "error-body",
            status: stage === "error-body" ? 500 : 200,
            json: pending,
          })
    );
    if (stage === "before") f.controller.abort();
    await assert.rejects(handleWebSearchTool({ query: "query" }, f.context), { name: "AbortError" });
    assert.equal(fetchMock.mock.callCount(), stage === "before" ? 0 : 1);
    assert.equal(f.starts.length, stage === "before" ? 0 : 1);
    assert.deepEqual(f.exits, f.starts);
  });
}

test("official search cleans up activity after network failure", async (t) => {
  const f = setup(t);
  t.mock.method(globalThis, "fetch", async () => {
    throw new TypeError("fetch failed");
  });
  const result = await handleWebSearchTool({ query: "query" }, f.context);
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /fetch failed/);
  assert.deepEqual(f.exits, f.starts);
});

for (const [enabled, status] of [
  [true, 200],
  [true, 429],
  [true, null],
  [false, 200],
] as const) {
  test(`official search HTTP logging: enabled=${enabled}, status=${status}`, async (t) => {
    const f = setup(t);
    f.client.debugLogEnabled = enabled;
    const logs: string[] = [];
    const mkdir = t.mock.method(fs, "mkdirSync", () => undefined);
    const append = t.mock.method(fs, "appendFileSync", (_file: unknown, data: unknown) => {
      logs.push(String(data));
    });
    syncBuiltinESMExports();
    t.after(() => {
      mkdir.mock.restore();
      append.mock.restore();
      syncBuiltinESMExports();
    });
    t.mock.method(globalThis, "fetch", async () => {
      if (status === null) throw new TypeError("fetch failed");
      return Response.json({ results: [source] }, { status });
    });
    const result = await handleWebSearchTool({ query: "重庆天气" }, f.context);
    assert.equal(result.ok, status === 200);
    assert.equal(logs.length, enabled ? 1 : 0);
    if (enabled) {
      const entry = JSON.parse(logs[0]);
      assert.equal(entry.location, "WebSearch.deepseekSearchApi");
      assert.equal(entry.sessionId, f.context.sessionId);
      assert.equal(entry.requestId, f.starts[0]);
      assert.ok(Number.isFinite(Date.parse(entry.timestamp)));
      assert.ok(entry.durationMs >= 0);
      assert.deepEqual(entry.request, {
        url: "https://api.deepseek.com/v1/tools/search",
        method: "POST",
        query: "重庆天气",
      });
      assert.deepEqual(entry.response, { status });
      assert.ok(!logs[0].includes(f.client.apiKey));
    }
  });
}
