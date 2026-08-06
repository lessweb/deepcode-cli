import { test } from "node:test";
import assert from "node:assert/strict";
import { buildClientHeaders } from "../common/openai-client";

test("buildClientHeaders injects a default User-Agent when none is set", () => {
  const headers = buildClientHeaders(undefined);
  assert.match(headers.get("User-Agent") ?? "", /^deepcode-cli \(Node\.js v\d+\.\d+\.\d+\)$/);
});

test("buildClientHeaders preserves existing headers and a custom User-Agent", () => {
  const headers = buildClientHeaders({ Authorization: "Bearer sk-test", "User-Agent": "custom-agent" });
  assert.equal(headers.get("Authorization"), "Bearer sk-test");
  assert.equal(headers.get("User-Agent"), "custom-agent");
});

test("buildClientHeaders accepts tuple-array headers and keeps its entries", () => {
  const headers = buildClientHeaders([["Content-Type", "application/json"]]);
  assert.equal(headers.get("Content-Type"), "application/json");
  assert.match(headers.get("User-Agent") ?? "", /^deepcode-cli /);
});
