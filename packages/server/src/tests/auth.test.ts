import { test } from "node:test";
import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import { isAuthorized } from "../services/auth";

function request(url: string, headers: IncomingMessage["headers"] = {}): IncomingMessage {
  return { url, headers } as IncomingMessage;
}

test("isAuthorized accepts query token", () => {
  assert.equal(isAuthorized(request("/health?token=secret"), "secret"), true);
});

test("isAuthorized accepts x-deepcode-token header values", () => {
  assert.equal(isAuthorized(request("/health", { "x-deepcode-token": "secret" }), "secret"), true);
  assert.equal(isAuthorized(request("/health", { "x-deepcode-token": ["secret", "other"] }), "secret"), true);
});

test("isAuthorized accepts bearer authorization case-insensitively", () => {
  assert.equal(isAuthorized(request("/health", { authorization: "Bearer secret" }), "secret"), true);
  assert.equal(isAuthorized(request("/health", { authorization: "bearer secret" }), "secret"), true);
});

test("isAuthorized rejects missing or mismatched tokens", () => {
  assert.equal(isAuthorized(request("/health"), "secret"), false);
  assert.equal(isAuthorized(request("/health?token=wrong"), "secret"), false);
  assert.equal(isAuthorized(request("/health", { authorization: "Bearer wrong" }), "secret"), false);
});
