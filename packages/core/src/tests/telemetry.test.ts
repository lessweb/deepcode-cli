import { test } from "node:test";
import assert from "node:assert/strict";
import { reportNewPrompt } from "../common/telemetry";

test("reportNewPrompt does not call fetch when enabled is false", () => {
  let called = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((..._args: unknown[]) => {
    called = true;
    return Promise.resolve(new Response());
  }) as typeof globalThis.fetch;

  try {
    reportNewPrompt({ enabled: false, machineId: "test-machine" });
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("reportNewPrompt does not call fetch when machineId is undefined", () => {
  let called = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((..._args: unknown[]) => {
    called = true;
    return Promise.resolve(new Response());
  }) as typeof globalThis.fetch;

  try {
    reportNewPrompt({ enabled: true });
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("reportNewPrompt does not call fetch when machineId is empty string", () => {
  let called = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((..._args: unknown[]) => {
    called = true;
    return Promise.resolve(new Response());
  }) as typeof globalThis.fetch;

  try {
    reportNewPrompt({ enabled: true, machineId: "" });
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("reportNewPrompt calls fetch with correct URL, method, headers, and body", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return Promise.resolve(new Response());
  }) as typeof globalThis.fetch;

  try {
    reportNewPrompt({ enabled: true, machineId: "test-machine" });

    // Wait for the fire-and-forget fetch to settle.
    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://deepcode.vegamo.cn/api/plugin/new");
    assert.equal(calls[0].init.method, "POST");
    assert.equal((calls[0].init.headers as Record<string, string>)["Content-Type"], "application/json");
    assert.equal((calls[0].init.headers as Record<string, string>)["Token"], "test-machine");
    assert.equal(calls[0].init.body, JSON.stringify({}));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("reportNewPrompt swallows fetch errors without throwing", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    return Promise.reject(new Error("Network error"));
  }) as typeof globalThis.fetch;

  try {
    // Should not throw.
    reportNewPrompt({ enabled: true, machineId: "test-machine" });
    await new Promise((resolve) => setTimeout(resolve, 50));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("reportNewPrompt respects custom timeoutMs", async () => {
  const calls: Array<{ signal: AbortSignal }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) => {
    calls.push({ signal: init?.signal as AbortSignal });
    return Promise.resolve(new Response());
  }) as typeof globalThis.fetch;

  try {
    reportNewPrompt({ enabled: true, machineId: "test-machine", timeoutMs: 100 });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].signal.aborted, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
