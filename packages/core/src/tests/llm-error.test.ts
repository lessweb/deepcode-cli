import { test } from "node:test";
import assert from "node:assert/strict";
import { describeLlmError, getLlmErrorDetails } from "../common/llm-error";

test("describeLlmError shows provider business errors with trace metadata", () => {
  const error = Object.assign(new Error("402 Insufficient Balance"), {
    status: 402,
    error: {
      message: "Insufficient Balance",
    },
    code: "invalid_request_error",
    type: "unknown_error",
    headers: new Headers({
      "x-request-id": "request-123",
      "x-ds-trace-id": "trace-456",
    }),
  });

  assert.equal(
    describeLlmError(error),
    "HTTP 402: Insufficient Balance [code: invalid_request_error, type: unknown_error, request ID: request-123, trace ID: trace-456]"
  );
});

test("describeLlmError unwraps underlying network causes", () => {
  const cause = new Error("getaddrinfo ENOTFOUND api.deepseek.com");
  const error = Object.assign(new Error("Connection error."), { cause });

  assert.equal(describeLlmError(error), "Connection error: getaddrinfo ENOTFOUND api.deepseek.com");
});

test("LLM error details stop at circular causes and redact credentials", () => {
  const first = Object.assign(new Error("Connection error."), { cause: undefined as unknown });
  const second = new Error("fetch failed: https://example.test?api_key=sk-secret-value");
  (first as Error & { cause: unknown }).cause = second;
  (second as Error & { cause: unknown }).cause = first;

  const details = getLlmErrorDetails(first);
  assert.equal(details.causes?.[0]?.message, "fetch failed: https://example.test?api_key=***MASKED***");
  assert.equal(details.causes?.[0]?.causes?.[0]?.message, "Connection error.");
  assert.equal(details.causes?.[0]?.causes?.[0]?.causes, undefined);
});
