import { test } from "node:test";
import assert from "node:assert/strict";
import { getScopeRiskColor } from "../ui/views/PermissionPrompt";
import { LIGHT_THEME } from "../ui/theme";

test("getScopeRiskColor maps permission scopes by risk", () => {
  assert.equal(getScopeRiskColor("read-in-cwd"), LIGHT_THEME.risk.low);
  assert.equal(getScopeRiskColor("query-git-log"), LIGHT_THEME.risk.low);

  assert.equal(getScopeRiskColor("read-out-cwd"), LIGHT_THEME.risk.medium);
  assert.equal(getScopeRiskColor("write-in-cwd"), LIGHT_THEME.risk.medium);
  assert.equal(getScopeRiskColor("network"), LIGHT_THEME.risk.medium);
  assert.equal(getScopeRiskColor("mcp"), LIGHT_THEME.risk.medium);

  assert.equal(getScopeRiskColor("write-out-cwd"), LIGHT_THEME.risk.high);
  assert.equal(getScopeRiskColor("delete-in-cwd"), LIGHT_THEME.risk.high);
  assert.equal(getScopeRiskColor("delete-out-cwd"), LIGHT_THEME.risk.high);
  assert.equal(getScopeRiskColor("mutate-git-log"), LIGHT_THEME.risk.high);
  assert.equal(getScopeRiskColor("unknown"), LIGHT_THEME.risk.critical);
});
