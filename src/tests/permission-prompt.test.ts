import { test } from "node:test";
import assert from "node:assert/strict";
import { getScopeRiskColor } from "../ui/views/PermissionPrompt";

test("getScopeRiskColor maps permission scopes by risk", () => {
  assert.equal(getScopeRiskColor("read-in-cwd"), "#22c55e");
  assert.equal(getScopeRiskColor("query-git-log"), "#22c55e");

  assert.equal(getScopeRiskColor("read-out-cwd"), "#f59e0b");
  assert.equal(getScopeRiskColor("write-in-cwd"), "#f59e0b");
  assert.equal(getScopeRiskColor("network"), "#f59e0b");
  assert.equal(getScopeRiskColor("mcp"), "#f59e0b");

  assert.equal(getScopeRiskColor("write-out-cwd"), "#ef4444");
  assert.equal(getScopeRiskColor("delete-in-cwd"), "#ef4444");
  assert.equal(getScopeRiskColor("delete-out-cwd"), "#ef4444");
  assert.equal(getScopeRiskColor("mutate-git-log"), "#ef4444");
  assert.equal(getScopeRiskColor("unknown"), "#ef4444");
});
