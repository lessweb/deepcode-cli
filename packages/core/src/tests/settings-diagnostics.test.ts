import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { inspectSettings, inspectJsonFile } from "../settings-diagnostics";
import { resolveSettingsSources, DEFAULT_MODEL, DEFAULT_BASE_URL, type SettingsTrace } from "../settings";

function fixture(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "doctor-settings-"));
  const home = path.join(root, "home");
  const projectRoot = path.join(root, "project");
  const write = (file: string, value: unknown) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value));
  };
  const user = path.join(home, ".deepcode/settings.json");
  const project = path.join(projectRoot, ".deepcode/settings.json");
  const plus = path.join(home, ".deepcode-plus/settings.json");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, home, projectRoot, write, user, project, plus, env: {} };
}

test("DeepSeek search settings default off and trace user/project overrides", (t) => {
  const f = fixture(t);
  let report = inspectSettings(f);
  assert.equal(report.settings?.deepseekSearchApiEnabled, false);
  assert.deepEqual(report.trace.sources.deepseekSearchApiEnabled, ["default"]);
  f.write(f.user, { deepseekSearchApiEnabled: true });
  report = inspectSettings(f);
  assert.equal(report.settings?.deepseekSearchApiEnabled, true);
  assert.deepEqual(report.trace.sources.deepseekSearchApiEnabled, ["user.deepseekSearchApiEnabled"]);
  assert.ok(!report.checks.some((check) => check.name === "Unknown configuration field"));
  f.write(f.project, { deepseekSearchApiEnabled: false });
  report = inspectSettings(f);
  assert.equal(report.settings?.deepseekSearchApiEnabled, false);
  assert.deepEqual(report.trace.sources.deepseekSearchApiEnabled, ["project.deepseekSearchApiEnabled"]);
  f.write(f.project, { deepseekSearchApiEnabled: "invalid" });
  report = inspectSettings(f);
  assert.equal(report.settings?.deepseekSearchApiEnabled, true);
  assert.ok(report.trace.ignored.some((item) => item.source === "project.deepseekSearchApiEnabled"));
});

test("doctor traces effective precedence, fallback and merged settings without changing resolution", () => {
  const user = {
    model: "same",
    temperature: 0.4,
    permissions: { allow: ["network" as const] },
    env: { API_KEY: "user-key", MCP_SHARED: "u" },
    mcpServers: { test: { command: "node", env: { X: "user-x" } } },
    statusline: { providers: [{ type: "command" as const, id: "a", command: "old" }] },
  };
  const project = {
    model: "same",
    temperature: 9,
    permissions: { allow: ["network" as const, "mcp" as const] },
    env: { MODEL: "shadow", API_KEY: "project-key", MCP_SHARED: "p" },
    enabledSkills: { foo: false },
    statusline: { providers: [{ type: "command" as const, id: "a", command: "new" }] },
  };
  const env = { DEEPCODE_MODEL: "", DEEPCODE_MCP_X: "env-x" };
  const trace: SettingsTrace = { sources: {}, ignored: [] };
  const defaults = { model: DEFAULT_MODEL, baseURL: DEFAULT_BASE_URL };
  const resolved = resolveSettingsSources(user, project, defaults, env, trace);
  assert.deepEqual(resolved, resolveSettingsSources(user, project, defaults, env));
  assert.deepEqual(trace.sources.model, ["project.model"]); // Equal values still have distinct origins.
  assert.deepEqual(trace.sources.temperature, ["user.temperature"]);
  assert.deepEqual(trace.sources.apiKey, ["project.env.API_KEY"]);
  assert.deepEqual(trace.sources["permissions.allow.0"], ["user.permissions.allow", "project.permissions.allow"]);
  assert.deepEqual(trace.sources["statusline.providers.0"], ["project.statusline.providers.0"]);
  assert.deepEqual(trace.sources["mcpServers.test.env.X"], ["environment.MCP_X"]);
  assert.deepEqual(trace.sources["mcpServers.test.env.SHARED"], ["project.env.MCP_SHARED"]);
  assert.deepEqual(trace.sources["enabledSkills.foo"], ["project.enabledSkills.foo"]);
  assert.ok(trace.ignored.some((item) => item.source === "project.temperature"));
  assert.ok(trace.ignored.some((item) => item.source === "environment.MODEL"));
});

test("doctor reports file loading failures, explicit replacement, and source paths", (t) => {
  const f = fixture(t);
  f.write(f.user, { model: "user", env: { API_KEY: "secret-value" } });
  f.write(f.project, { model: "project" });
  const explicit = path.join(f.root, "custom.json");
  f.write(explicit, { model: "custom" });
  const report = inspectSettings({ ...f, settingsFile: explicit });
  assert.equal(report.settings?.model, "custom");
  assert.equal(report.sourceName(report.trace.sources.model[0]), `${explicit} → model`);
  assert.ok(report.checks.some((check) => check.detail.includes("replaced by --settings")));
  assert.ok(report.secrets.has("secret-value"));
  const missing = inspectSettings({ ...f, settingsFile: "missing.json" });
  assert.equal(missing.settings, undefined);
  assert.ok(missing.checks.some((check) => check.status === "FAIL"));
  fs.writeFileSync(explicit, '{"API_KEY":"never-print-this", broken');
  const invalid = inspectSettings({ ...f, settingsFile: explicit });
  assert.equal(invalid.settings, undefined);
  assert.doesNotMatch(JSON.stringify(invalid.checks), /never-print-this/);
  assert.equal(inspectJsonFile(f.root).status, "unreadable");
});

test("doctor loads same user/project path once and exposes ignored optional JSON errors", (t) => {
  const f = fixture(t);
  f.write(f.user, { model: "once" });
  const same = inspectSettings({ ...f, settingsFile: f.user });
  assert.equal(same.settings?.model, "once");
  assert.ok(same.checks.some((check) => check.detail.includes("loaded once")));
  f.write(f.project, {});
  fs.writeFileSync(f.project, "{");
  const invalid = inspectSettings(f);
  assert.equal(invalid.settings?.model, "once");
  assert.ok(invalid.checks.some((check) => check.status === "FAIL" && check.detail.includes(f.project)));
});

test("doctor follows Plus overrides, plan fallback, and catches malformed keys with source", (t) => {
  const f = fixture(t);
  const key = "sk-" + "a".repeat(26);
  f.write(f.plus, { env: { PLUS_API_KEY: key }, subscriptionPlan: "off" });
  assert.deepEqual(inspectSettings(f).plusSettings, { apiKey: key, subscriptionPlan: "off" });
  f.write(f.user, { env: { PLUS_API_KEY: key } });
  assert.equal(inspectSettings(f).plusSettings?.subscriptionPlan, "default");
  f.write(f.plus, { subscriptionPlan: "invalid" });
  assert.ok(inspectSettings(f).checks.some((check) => check.name === "Plus subscriptionPlan"));
  const invalid = inspectSettings({ ...f, env: { DEEPCODE_PLUS_API_KEY: "bad-key" } });
  assert.equal(invalid.settings, undefined);
  assert.ok(invalid.checks.some((check) => check.status === "FAIL" && check.detail.includes("DEEPCODE_PLUS_API_KEY")));
});

test("environment names without DEEPCODE prefix are not treated as configuration", (t) => {
  const f = fixture(t);
  const report = inspectSettings({ ...f, env: { API_KEY: "unused-secret", MODEL: "unused-model" } });
  assert.equal(report.settings?.apiKey, undefined);
  assert.equal(report.settings?.model, DEFAULT_MODEL);
  assert.ok(report.checks.some((check) => check.name === "Unused environment variable"));
});

test("doctor identifies invalid retention by file and ignored nested configuration by field", (t) => {
  const f = fixture(t);
  f.write(f.user, { retainRatio: 2 });
  assert.ok(
    inspectSettings(f).checks.some((check) => check.name === "Compaction settings" && check.detail.includes(f.user))
  );
  f.write(f.user, { permissions: { defaultMode: "askAll" } });
  f.write(f.project, {
    permissions: { allow: ["bogus"] },
    enabledSkills: { invalid: "yes" },
    statusline: { refreshMs: 1, providers: [{ type: "command" }] },
    env: { BASE_URL: " " },
  });
  const report = inspectSettings(f);
  assert.equal(report.settings?.permissions.defaultMode, "allowAll");
  assert.deepEqual(report.trace.sources["permissions.defaultMode"], ["default"]);
  for (const source of [
    "project.permissions.allow",
    "project.enabledSkills.invalid",
    "project.statusline.refreshMs",
    "project.statusline.providers.0",
    "project.env.BASE_URL",
  ])
    assert.ok(
      report.trace.ignored.some((item) => item.source === source),
      source
    );
});

test("doctor recognizes history settings, traces overrides, and reports invalid values", (t) => {
  const f = fixture(t);
  f.write(f.user, { history: { persistence: "none", maxBytes: 2000 } });
  f.write(f.project, { history: { maxBytes: 0 } });
  const report = inspectSettings(f);
  assert.deepEqual(report.settings?.history, { persistence: "none", maxBytes: 0 });
  assert.deepEqual(report.trace.sources["history.persistence"], ["user.history.persistence"]);
  assert.deepEqual(report.trace.sources["history.maxBytes"], ["project.history.maxBytes"]);
  assert.ok(
    !report.checks.some((check) => check.name === "Unknown configuration field" && check.detail.includes("history"))
  );
  f.write(f.project, { history: { maxBytes: -1 } });
  assert.ok(inspectSettings(f).checks.some((check) => check.name === "History settings" && check.status === "FAIL"));
});
