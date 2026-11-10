import { test } from "node:test";
import assert from "node:assert/strict";
import {
  collectPromptImageUrls,
  PLUS_PACKAGES_URL,
  VALID_PERMISSION_SCOPES,
  formatContextStatus,
  formatTokenCount,
  getNonce,
  isAllowedExternalUrl,
  parsePermissionScopes,
  parseUserToolPermissions,
} from "../utils.js";

test("isAllowedExternalUrl accepts only the Plus packages URL", () => {
  assert.equal(isAllowedExternalUrl(PLUS_PACKAGES_URL), true);
  assert.equal(isAllowedExternalUrl("https://deepcode.vegamo.cn/plus/packages/other"), false);
  assert.equal(isAllowedExternalUrl("https://example.com"), false);
  assert.equal(isAllowedExternalUrl(undefined), false);
});

// --- VALID_PERMISSION_SCOPES ---

test("VALID_PERMISSION_SCOPES contains all expected scopes", () => {
  const expected = [
    "read-in-cwd",
    "read-in-tmp",
    "read-out-cwd",
    "write-in-cwd",
    "write-in-tmp",
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

test("attachment discovery includes queue, drafts and legacy images but ignores text URLs", () => {
  assert.deepEqual(
    collectPromptImageUrls({
      messages: [
        {
          content: "file:///not-an-attachment",
          contentParams: [{ type: "image_url", image_url: { url: "file:///legacy.png" } }],
        },
      ],
      queued: [{ content: { imageUrls: ["file:///pending.png", "file:///legacy.png"] } }],
      draft: { imageUrls: ["data:image/png;base64,abc"] },
    }),
    ["file:///legacy.png", "file:///pending.png", "data:image/png;base64,abc"]
  );
});

// --- token formatting ---

test("formatTokenCount compacts thousands and millions", () => {
  assert.equal(formatTokenCount(0), "0");
  assert.equal(formatTokenCount(-1), "0");
  assert.equal(formatTokenCount(Number.NaN), "0");
  assert.equal(formatTokenCount(999), "999");
  assert.equal(formatTokenCount(1_000), "1.0k");
  assert.equal(formatTokenCount(20_770), "20.8k");
  assert.equal(formatTokenCount(1_048_576), "1.0M");
});

test("formatContextStatus renders used tokens, window, and percentage", () => {
  assert.equal(formatContextStatus(20_770, 1_048_576), "20.8k / 1.0M (2%)");
  assert.equal(formatContextStatus(500_000, 1_000_000), "500.0k / 1.0M (50%)");
  assert.equal(formatContextStatus(0, 0), "0 / 0 (0%)");
  assert.equal(formatContextStatus(Number.NaN, 1_000_000), "0 / 1.0M (0%)");
});
