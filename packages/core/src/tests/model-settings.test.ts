import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { syncBuiltinESMExports } from "node:module";
import {
  getDefaultSettingsTarget,
  resolveCurrentSettings,
  writeModelConfigSelection,
  type DeepcodingSettings,
  type ModelConfigSelection,
} from "../settings";

const selection: ModelConfigSelection = { model: "deepseek-v4-pro", thinkingEnabled: true, reasoningEffort: "high" };

function fixture(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "model-settings-"));
  const home = path.join(root, "user");
  const project = path.join(root, "project");
  t.mock.method(os, "homedir", () => home);
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const file = (dir: string) => path.join(dir, ".deepcode", "settings.json");
  const write = (dir: string, settings: unknown) => {
    fs.mkdirSync(path.dirname(file(dir)), { recursive: true });
    fs.writeFileSync(file(dir), JSON.stringify(settings));
  };
  const read = (dir: string) => JSON.parse(fs.readFileSync(file(dir), "utf8")) as DeepcodingSettings;
  return { home, project, file, write, read };
}

test("an explicit project destination persists an inherited selection and creates its settings file", (t) => {
  const f = fixture(t);
  f.write(f.home, selection);
  assert.equal(getDefaultSettingsTarget(f.project), "user");
  assert.equal(writeModelConfigSelection(selection, selection, f.project, "project").changed, true);
  assert.deepEqual(f.read(f.project), selection);
  assert.deepEqual(f.read(f.home), selection);
  assert.equal(getDefaultSettingsTarget(f.project), "project");
  const before = fs.readFileSync(f.file(f.project), "utf8");
  assert.equal(writeModelConfigSelection(selection, selection, f.project, "project").changed, false);
  assert.equal(fs.readFileSync(f.file(f.project), "utf8"), before);
});

test("global model saving removes model and thinking overrides including project env, preserving other fields", (t) => {
  const f = fixture(t);
  f.write(f.home, { env: { API_KEY: "test" }, model: "old", notify: "user" });
  f.write(f.project, {
    ...selection,
    env: { MODEL: "old", THINKING_ENABLED: "false", REASONING_EFFORT: "max", BASE_URL: "https://example.com" },
    permissions: { deny: ["network"] },
    notify: "project",
  });
  assert.equal(writeModelConfigSelection(selection, selection, f.project, "user").changed, true);
  assert.deepEqual(f.read(f.home), { ...selection, env: { API_KEY: "test" }, notify: "user" });
  assert.deepEqual(f.read(f.project), {
    env: { BASE_URL: "https://example.com" },
    permissions: { deny: ["network"] },
    notify: "project",
  });
  const effective = resolveCurrentSettings(f.project);
  assert.equal(effective.model, selection.model);
  assert.equal(effective.thinkingEnabled, selection.thinkingEnabled);
  assert.equal(effective.reasoningEffort, selection.reasoningEffort);
});

test("global saving reports changes when only project overrides need removal", (t) => {
  const f = fixture(t);
  f.write(f.home, selection);
  f.write(f.project, { ...selection, notify: "keep" });
  assert.equal(writeModelConfigSelection(selection, selection, f.project, "user").changed, true);
  assert.deepEqual(f.read(f.project), { notify: "keep" });
  assert.equal(writeModelConfigSelection(selection, selection, f.project, "user").changed, false);
});

test("no-thinking selections persist without creating a project file for global saves", (t) => {
  const f = fixture(t);
  const selected = { ...selection, thinkingEnabled: false };
  writeModelConfigSelection(selected, selection, f.project, "user");
  assert.deepEqual(f.read(f.home), selected);
  assert.equal(fs.existsSync(f.file(f.project)), false);
  assert.equal(resolveCurrentSettings(f.project).thinkingEnabled, false);
});

test("global saving at the home directory never clears the saved selection", (t) => {
  const f = fixture(t);
  f.write(f.home, { model: "old", notify: "keep" });
  writeModelConfigSelection(selection, selection, f.home, "user");
  assert.deepEqual(f.read(f.home), { ...selection, notify: "keep" });
});

test("both files are validated before a global save and write failures are reported", (t) => {
  const f = fixture(t);
  f.write(f.home, { model: "old" });
  f.write(f.project, {});
  const before = fs.readFileSync(f.file(f.home), "utf8");
  for (const raw of ["{broken", "null", "[]", '{"env":null}', '{"env":[]}']) {
    fs.writeFileSync(f.file(f.project), raw);
    assert.throws(() => writeModelConfigSelection(selection, selection, f.project, "user"));
    assert.equal(fs.readFileSync(f.file(f.home), "utf8"), before);
    assert.equal(fs.readFileSync(f.file(f.project), "utf8"), raw);
  }
  f.write(f.project, {});
  fs.rmSync(f.file(f.project));
  fs.mkdirSync(f.file(f.project));
  assert.throws(() => writeModelConfigSelection(selection, selection, f.project, "project"));
  fs.rmSync(f.file(f.project), { recursive: true });
  const writeFailure = t.mock.method(fs, "writeFileSync", () => {
    throw new Error("write failed");
  });
  syncBuiltinESMExports();
  assert.throws(() => writeModelConfigSelection(selection, selection, f.project, "project"), /write failed/);
  writeFailure.mock.restore();
  syncBuiltinESMExports();
});
