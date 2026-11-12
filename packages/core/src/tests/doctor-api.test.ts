import assert from "node:assert/strict";
import { createServer, type RequestListener } from "node:http";
import { test, type TestContext } from "node:test";
import { probeModels, describeNetworkError } from "../common/doctor-api";

async function server(t: TestContext, handler: RequestListener) {
  const instance = createServer(handler);
  await new Promise<void>((resolve) => instance.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    instance.closeAllConnections();
    instance.close();
  });
  const address = instance.address();
  assert.ok(address && typeof address === "object");
  return `http://127.0.0.1:${address.port}/v1`;
}

test("SDK doctor probe sends one authenticated GET /models and checks exact model IDs", async (t) => {
  let requests = 0;
  const baseURL = await server(t, (req, res) => {
    requests++;
    assert.equal(req.method, "GET");
    assert.equal(req.url, "/v1/models");
    assert.equal(req.headers.authorization, "Bearer test-secret");
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ data: [{ id: "model-a" }] }));
  });
  assert.equal((await probeModels({ baseURL, apiKey: "test-secret", model: "model-a" })).modelListed, true);
  assert.equal((await probeModels({ baseURL, apiKey: "test-secret", model: "Model-a" })).modelListed, false);
  assert.equal(requests, 2);
});

for (const status of [401, 403, 404, 405, 429, 500, 503]) {
  test(`SDK probe classifies HTTP ${status} without retrying or echoing response secrets`, async (t) => {
    let requests = 0;
    const baseURL = await server(t, (_req, res) => {
      requests++;
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "secret-response-key" } }));
    });
    const result = await probeModels({ baseURL, apiKey: "test", model: "a" });
    assert.equal(result.httpStatus, status);
    assert.equal(result.outcome, status === 401 ? "authentication" : status === 403 ? "forbidden" : "unavailable");
    assert.equal(requests, 1);
    assert.doesNotMatch(result.detail, /secret-response-key/);
  });
}

test("SDK probe rejects malformed model lists, redirects and bounded timeouts", async (t) => {
  for (const body of [{}, { data: [null] }, { data: [{ name: "wrong" }] }]) {
    const baseURL = await server(t, (_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(body));
    });
    const result = await probeModels({ baseURL, apiKey: "test", model: "a" });
    assert.equal(result.outcome, "unavailable");
    assert.equal(result.httpStatus, 200);
  }
  const redirect = await server(t, (_req, res) => {
    res.writeHead(302, { location: "http://never-contact.invalid" });
    res.end();
  });
  assert.equal((await probeModels({ baseURL: redirect, apiKey: "test", model: "a" })).httpStatus, 302);
  const stalled = await server(t, () => {});
  const result = await probeModels({ baseURL: stalled, apiKey: "test", model: "a", timeoutMs: 50 });
  assert.equal(result.outcome, "unavailable");
  assert.match(result.detail, /timed out/);
});

test("network diagnostics distinguish DNS, TLS, refused connections, and timeout", () => {
  assert.match(describeNetworkError({ cause: { code: "ENOTFOUND" } }), /DNS/);
  assert.match(describeNetworkError({ cause: { code: "DEPTH_ZERO_SELF_SIGNED_CERT" } }), /TLS/);
  assert.match(describeNetworkError({ cause: { code: "ECONNREFUSED" } }), /refused/);
  assert.match(describeNetworkError({ name: "APIConnectionTimeoutError" }), /timed out/);
});
