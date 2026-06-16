import { test } from "node:test";
import assert from "node:assert/strict";
import { VALID_PERMISSION_SCOPES, parseUserToolPermissions, parsePermissionScopes, getNonce } from "../utils.js";

// --- VALID_PERMISSION_SCOPES ---

test("VALID_PERMISSION_SCOPES contains all expected scopes", () => {
  const expected = [
    "read-in-cwd",
    "read-out-cwd",
    "write-in-cwd",
    "write-out-cwd",
    "delete-in-cwd",
    "delete-out-cwd",
    "query-git-log",
    "mutate-git-log",
    "network",
    "mcp",
  ];
  assert.equal(VALID_PERMISSION_SCOPES.size, expected.length);
  for (const scope of expected) {
    assert.ok(VALID_PERMISSION_SCOPES.has(scope as any), `missing scope: ${scope}`);
  }
});

// --- parseUserToolPermissions ---

test("parseUserToolPermissions returns empty array for non-array input", () => {
  assert.deepEqual(parseUserToolPermissions(undefined), []);
  assert.deepEqual(parseUserToolPermissions(null), []);
  assert.deepEqual(parseUserToolPermissions("string"), []);
  assert.deepEqual(parseUserToolPermissions(123), []);
  assert.deepEqual(parseUserToolPermissions({}), []);
});

test("parseUserToolPermissions returns empty array for empty array", () => {
  assert.deepEqual(parseUserToolPermissions([]), []);
});

test("parseUserToolPermissions parses valid permissions", () => {
  const input = [
    { toolCallId: "call-1", permission: "allow" },
    { toolCallId: "call-2", permission: "deny" },
  ];
  const result = parseUserToolPermissions(input);
  assert.equal(result.length, 2);
  assert.deepEqual(result[0], { toolCallId: "call-1", permission: "allow" });
  assert.deepEqual(result[1], { toolCallId: "call-2", permission: "deny" });
});

test("parseUserToolPermissions filters out invalid items", () => {
  const input = [
    null,
    123,
    "string",
    {},
    { toolCallId: "", permission: "allow" }, // empty toolCallId
    { toolCallId: "  ", permission: "allow" }, // whitespace-only toolCallId
    { toolCallId: "call-1" }, // missing permission
    { toolCallId: "call-2", permission: "invalid" }, // invalid permission value
    { permission: "allow" }, // missing toolCallId
    { toolCallId: "call-3", permission: "allow" }, // valid
  ];
  const result = parseUserToolPermissions(input);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0], { toolCallId: "call-3", permission: "allow" });
});

test("parseUserToolPermissions preserves toolCallId with leading/trailing spaces", () => {
  const input = [{ toolCallId: "  call-1  ", permission: "allow" }];
  const result = parseUserToolPermissions(input);
  // trimmed toolCallId "  " fails the .trim() check, so this item is filtered
  // Wait, "  call-1  ".trim() = "call-1" which is truthy, so it passes
  assert.equal(result.length, 1);
  assert.equal(result[0].toolCallId, "  call-1  ");
});

// --- parsePermissionScopes ---

test("parsePermissionScopes returns empty array for non-array input", () => {
  assert.deepEqual(parsePermissionScopes(undefined), []);
  assert.deepEqual(parsePermissionScopes(null), []);
  assert.deepEqual(parsePermissionScopes("string"), []);
  assert.deepEqual(parsePermissionScopes(123), []);
  assert.deepEqual(parsePermissionScopes({}), []);
});

test("parsePermissionScopes returns empty array for empty array", () => {
  assert.deepEqual(parsePermissionScopes([]), []);
});

test("parsePermissionScopes parses valid scopes", () => {
  const input = ["read-in-cwd", "write-in-cwd", "network"];
  const result = parsePermissionScopes(input);
  assert.equal(result.length, 3);
  assert.deepEqual(result, ["read-in-cwd", "write-in-cwd", "network"]);
});

test("parsePermissionScopes filters out invalid values", () => {
  const input = ["read-in-cwd", "invalid-scope", 123, null, undefined, {}, "mcp"];
  const result = parsePermissionScopes(input);
  assert.equal(result.length, 2);
  assert.deepEqual(result, ["read-in-cwd", "mcp"]);
});

test("parsePermissionScopes deduplicates scopes", () => {
  const input = ["read-in-cwd", "write-in-cwd", "read-in-cwd", "network", "network"];
  const result = parsePermissionScopes(input);
  assert.equal(result.length, 3);
  assert.deepEqual(result, ["read-in-cwd", "write-in-cwd", "network"]);
});

// --- getNonce ---

test("getNonce returns a 32-character string", () => {
  const nonce = getNonce();
  assert.equal(nonce.length, 32);
});

test("getNonce only contains alphanumeric characters", () => {
  const nonce = getNonce();
  assert.ok(/^[A-Za-z0-9]+$/.test(nonce), `nonce contains non-alphanumeric chars: ${nonce}`);
});

test("getNonce returns different values on successive calls", () => {
  const nonces = new Set<string>();
  for (let i = 0; i < 100; i++) {
    nonces.add(getNonce());
  }
  // With 62^32 possible values, 100 calls should almost certainly be unique
  assert.ok(nonces.size > 90, `Expected mostly unique nonces, got ${nonces.size} unique out of 100`);
});
