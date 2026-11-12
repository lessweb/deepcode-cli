import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { syncBuiltinESMExports } from "node:module";
import { test, type TestContext } from "node:test";
import { Models } from "openai/resources/models";
import {
  getDefaultSettingsTarget,
  resolveCurrentSettings,
  writeModelConfigSelection,
  type DeepcodingSettings,
} from "../settings";
import { readPermissionSettingsEdit, writePermissionSettingsChanges } from "../permission-settings";
import { createOpenAIClientFactory } from "../common/openai-client";

function fixture(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "settings-file-"));
  const home = path.join(root, "user");
  const project = path.join(root, "project");
  const file = path.join(project, "custom settings.json");
  const userFile = path.join(home, ".deepcode/settings.json");
  const projectFile = path.join(project, ".deepcode/settings.json");
  const env = process.env;
  process.env = Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith("DEEPCODE_")));
  t.mock.method(os, "homedir", () => home);
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    process.env = env;
    fs.rmSync(root, { recursive: true, force: true });
  });
  const write = (file: string, settings: DeepcodingSettings) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(settings));
  };
  const read = (file: string) => JSON.parse(fs.readFileSync(file, "utf8"));
  write(userFile, { model: "user-model", notify: "user-notify", env: { API_KEY: "user-key" } });
  write(projectFile, { model: "project-model", webSearchTool: "project-search" });
  write(file, { model: "custom-model", env: { API_KEY: "custom-key" } });
  return { root, home, project, file, userFile, projectFile, read, write };
}

test("explicit settings replace the project source while preserving inheritance and environment precedence", (t) => {
  const f = fixture(t);
  assert.equal(resolveCurrentSettings(f.project).model, "project-model");
  const custom = resolveCurrentSettings(f.project, path.basename(f.file));
  assert.equal(custom.model, "custom-model");
  assert.equal(custom.apiKey, "custom-key");
  assert.equal(custom.notify, "user-notify");
  assert.equal(custom.webSearchTool, undefined);
  process.env.DEEPCODE_MODEL = "environment-model";
  process.env.DEEPCODE_API_KEY = "environment-key";
  const overridden = resolveCurrentSettings(f.project, f.file);
  assert.equal(overridden.model, "environment-model");
  assert.equal(overridden.apiKey, "environment-key");
});

test("explicit settings are re-read and invalid files never fall back or expose contents", (t) => {
  const f = fixture(t);
  const load = () => resolveCurrentSettings(f.project, f.file);
  assert.equal(load().model, "custom-model");
  f.write(f.file, { model: "updated-model" });
  assert.equal(load().model, "updated-model");
  for (const raw of ['{"API_KEY":"secret-value",broken}', "null", "[]", '"secret-value"', "42"]) {
    fs.writeFileSync(f.file, raw);
    assert.throws(load, (error: Error) => {
      assert.ok(error.message.includes(f.file));
      assert.doesNotMatch(error.message, /secret-value|user-key|custom-key/);
      return true;
    });
  }
  fs.rmSync(f.file);
  assert.throws(load, /ENOENT/);
  fs.mkdirSync(f.file);
  assert.throws(load, /Cannot read settings file/);
});

test("explicit user settings remain validated when user and selected paths coincide", (t) => {
  const f = fixture(t);
  assert.equal(resolveCurrentSettings(f.project, f.userFile).model, "user-model");
  fs.writeFileSync(f.userFile, "broken");
  assert.throws(() => resolveCurrentSettings(f.project, f.userFile), /Invalid JSON/);
});

for (const target of ["project", "user"] as const) {
  for (const hasProject of [true, false]) {
    test(`custom input preserves ${target} model and permission saves (project exists: ${hasProject})`, (t) => {
      const f = fixture(t);
      if (!hasProject) fs.rmSync(f.projectFile);
      f.write(f.file, { model: "custom-model", permissions: { deny: ["network"] } });
      const before = fs.readFileSync(f.file, "utf8");
      assert.equal(getDefaultSettingsTarget(f.project), hasProject ? "project" : "user");
      assert.equal(readPermissionSettingsEdit(f.project).target, hasProject ? "project" : "user");
      const selection = { model: "deepseek-v4-pro", thinkingEnabled: true, reasoningEffort: "high" } as const;
      writeModelConfigSelection(selection, resolveCurrentSettings(f.project, f.file), f.project, target);
      writePermissionSettingsChanges(target, { scopes: { network: "allow" } }, f.project);
      const saved = f.read(target === "project" ? f.projectFile : f.userFile);
      assert.equal(saved.model, selection.model);
      assert.deepEqual(saved.permissions.allow, ["network"]);
      assert.equal(fs.readFileSync(f.file, "utf8"), before);
      const effective = resolveCurrentSettings(f.project, f.file);
      assert.equal(effective.model, "custom-model");
      assert.ok(effective.permissions.deny.includes("network"));
      if (target === "user" && hasProject) assert.equal(f.read(f.projectFile).model, undefined);
    });
  }
}

test("client factory uses the custom source for credentials, model and fresh reads", async (t) => {
  const f = fixture(t);
  t.mock.method(Models.prototype, "list", async () => ({ data: [] }));
  f.write(f.file, { model: "custom-model", env: { API_KEY: "custom-key", BASE_URL: "https://custom.invalid" } });
  const factory = createOpenAIClientFactory(f.project, f.file);
  await factory.prepare!();
  const client = factory();
  assert.equal(client.model, "custom-model");
  assert.equal(client.apiKey, "custom-key");
  assert.equal(client.client?.baseURL, "https://custom.invalid");
  f.write(f.file, { model: "updated-model", env: { API_KEY: "updated-key" } });
  await factory.prepare!();
  assert.equal(factory().model, "updated-model");
  assert.equal(factory().apiKey, "updated-key");
});
