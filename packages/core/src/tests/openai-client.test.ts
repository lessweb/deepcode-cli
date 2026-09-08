import { test } from "node:test";
import assert from "node:assert/strict";
import { DEEPCODE_PLUS_BASE_URL, resolveOpenAIConnection } from "../common/openai-client";

test("resolveOpenAIConnection falls back to DeepCode Plus credentials", () => {
  const resolved = resolveOpenAIConnection({ baseURL: "https://configured.example.com" }, "sk-plus-test");

  assert.deepEqual(resolved, {
    apiKey: "sk-plus-test",
    baseURL: DEEPCODE_PLUS_BASE_URL,
  });
});

test("resolveOpenAIConnection prefers regular credentials", () => {
  const resolved = resolveOpenAIConnection(
    { apiKey: "sk-regular-test", baseURL: "https://configured.example.com" },
    "sk-plus-test"
  );

  assert.deepEqual(resolved, {
    apiKey: "sk-regular-test",
    baseURL: "https://configured.example.com",
  });
});

test("resolveOpenAIConnection preserves the configured base URL without credentials", () => {
  const resolved = resolveOpenAIConnection({ baseURL: "https://configured.example.com" });

  assert.deepEqual(resolved, {
    apiKey: undefined,
    baseURL: "https://configured.example.com",
  });
});
