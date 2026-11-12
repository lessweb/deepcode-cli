import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { syncBuiltinESMExports } from "node:module";
import {
  applyPermissionSettingsChanges,
  getPermissionScopeSelection,
  previewPermissionSettings,
  readPermissionSettingsEdit,
  writePermissionSettingsChanges,
} from "../permission-settings";
import { resolveCurrentSettings, type DeepcodingSettings } from "../settings";
import { evaluatePermissionScopes } from "../common/permissions";

function fixture(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "permission-settings-"));
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

test("automatically chooses user settings, preserves fields, and takes effect on the next resolution", (t) => {
  const f = fixture(t);
  f.write(f.home, { model: "custom", permissions: { addWorkingDirs: ["/extra"], allow: ["mcp"] } });
  const edit = readPermissionSettingsEdit(f.project);
  assert.equal(edit.target, "user");
  assert.deepEqual(writePermissionSettingsChanges(edit.target, { defaultMode: "askAll" }, f.project), {
    changed: true,
  });
  assert.deepEqual(f.read(f.home), {
    model: "custom",
    permissions: { defaultMode: "askAll", addWorkingDirs: ["/extra"], allow: ["mcp"] },
  });
  assert.equal(evaluatePermissionScopes(["network"], resolveCurrentSettings(f.project).permissions), "ask");
  assert.equal(fs.existsSync(f.file(f.project)), false);
});

test("project editing preserves inherited default mode without copying inherited scope lists", (t) => {
  const f = fixture(t);
  f.write(f.home, { permissions: { defaultMode: "askAll", deny: ["network"] } });
  f.write(f.project, { model: "custom" });
  const edit = readPermissionSettingsEdit(f.project);
  assert.equal(edit.target, "project");
  const changes = { scopes: { network: "allow" as const } };
  const preview = previewPermissionSettings(edit, changes);
  assert.equal(evaluatePermissionScopes(["network"], preview.effective), "deny");
  writePermissionSettingsChanges(edit.target, changes, f.project);
  assert.deepEqual(f.read(f.project), { model: "custom", permissions: { allow: ["network"], defaultMode: "askAll" } });
  assert.deepEqual(resolveCurrentSettings(f.project).permissions, preview.effective);
});

test("moving scopes removes conflicting entries and default removes only this layer's rule", (t) => {
  const f = fixture(t);
  f.write(f.home, { permissions: { ask: ["network"] } });
  f.write(f.project, {
    permissions: { allow: ["network", "mcp"], deny: ["network", "mcp"], ask: ["mcp"], addWorkingDirs: ["relative"] },
  });
  writePermissionSettingsChanges("project", { scopes: { network: "default", mcp: "allow" } }, f.project);
  assert.deepEqual(f.read(f.project).permissions, { allow: ["mcp"], deny: [], ask: [], addWorkingDirs: ["relative"] });
  assert.equal(evaluatePermissionScopes(["network"], resolveCurrentSettings(f.project).permissions), "ask");
  assert.equal(evaluatePermissionScopes(["mcp"], resolveCurrentSettings(f.project).permissions), "allow");
});

test("saving re-reads the file and keeps the original destination even if a project file appears", (t) => {
  const f = fixture(t);
  const edit = readPermissionSettingsEdit(f.project);
  f.write(f.project, { permissions: { defaultMode: "allowAll" } });
  f.write(f.home, { notify: "new", permissions: { deny: ["mcp"] } });
  writePermissionSettingsChanges(edit.target, { scopes: { network: "ask" } }, f.project);
  assert.deepEqual(f.read(f.home), { notify: "new", permissions: { deny: ["mcp"], ask: ["network"] } });
  assert.deepEqual(f.read(f.project), { permissions: { defaultMode: "allowAll" } });
});

test("unchanged selections neither create nor rewrite settings", (t) => {
  const f = fixture(t);
  assert.deepEqual(writePermissionSettingsChanges("user", {}, f.project), { changed: false });
  assert.deepEqual(writePermissionSettingsChanges("user", { scopes: { mcp: "default" } }, f.project), {
    changed: false,
  });
  assert.equal(fs.existsSync(f.file(f.home)), false);
  f.write(f.project, { permissions: { defaultMode: "askAll" } });
  const before = fs.readFileSync(f.file(f.project), "utf8");
  assert.deepEqual(writePermissionSettingsChanges("project", { defaultMode: "askAll" }, f.project), { changed: false });
  assert.equal(fs.readFileSync(f.file(f.project), "utf8"), before);
  f.write(f.project, { permissions: { allow: ["network", "mcp"] } });
  assert.deepEqual(writePermissionSettingsChanges("project", { scopes: { network: "allow" } }, f.project), {
    changed: false,
  });
});

test("explicitly saving an inherited default mode creates project settings", (t) => {
  const f = fixture(t);
  f.write(f.home, { permissions: { defaultMode: "askAll", deny: ["network"] } });
  assert.deepEqual(writePermissionSettingsChanges("project", { defaultMode: "askAll" }, f.project), { changed: true });
  assert.deepEqual(f.read(f.project), { permissions: { defaultMode: "askAll" } });
  assert.deepEqual(f.read(f.home), { permissions: { defaultMode: "askAll", deny: ["network"] } });
});

test("global permission saving clears only edited project scopes and matches its preview", (t) => {
  const f = fixture(t);
  f.write(f.home, { permissions: { allow: ["network"], deny: ["mcp"] }, notify: "user" });
  f.write(f.project, {
    model: "keep",
    permissions: {
      defaultMode: "askAll",
      allow: ["mcp"],
      deny: ["network", "read-in-cwd"],
      ask: ["network"],
      addWorkingDirs: ["/extra"],
    },
  });
  const projectEdit = readPermissionSettingsEdit(f.project);
  const edit = {
    target: "user" as const,
    permissions: projectEdit.otherPermissions,
    otherPermissions: projectEdit.permissions,
  };
  const changes = { scopes: { network: "allow" as const } };
  const preview = previewPermissionSettings(edit, changes);
  assert.equal(evaluatePermissionScopes(["network"], preview.effective), "allow");
  assert.equal(writePermissionSettingsChanges("user", changes, f.project).changed, true);
  assert.deepEqual(f.read(f.project), {
    model: "keep",
    permissions: { defaultMode: "askAll", allow: ["mcp"], deny: ["read-in-cwd"], ask: [], addWorkingDirs: ["/extra"] },
  });
  assert.deepEqual(f.read(f.home), { permissions: { allow: ["network"], deny: ["mcp"] }, notify: "user" });
  assert.deepEqual(resolveCurrentSettings(f.project).permissions, preview.effective);
});

test("global default mode saving aligns project mode without clearing unrelated rules", (t) => {
  const f = fixture(t);
  f.write(f.home, { permissions: { defaultMode: "askAll" } });
  f.write(f.project, { permissions: { deny: ["network"] }, notify: "keep" });
  const changes = { defaultMode: "askAll" as const };
  const preview = previewPermissionSettings(
    { target: "user", permissions: f.read(f.home).permissions, otherPermissions: f.read(f.project).permissions },
    changes
  );
  assert.equal(writePermissionSettingsChanges("user", changes, f.project).changed, true);
  assert.deepEqual(f.read(f.project), { permissions: { defaultMode: "askAll", deny: ["network"] }, notify: "keep" });
  assert.deepEqual(resolveCurrentSettings(f.project).permissions, preview.effective);
  assert.equal(evaluatePermissionScopes(["network"], preview.effective), "deny");
  assert.equal(writePermissionSettingsChanges("user", changes, f.project).changed, false);
});

test("global default selections remove both layers' scope rules without copying a project default to the user", (t) => {
  const f = fixture(t);
  f.write(f.project, { permissions: { defaultMode: "askAll", deny: ["network"] } });
  writePermissionSettingsChanges("user", { scopes: { network: "default" } }, f.project);
  assert.equal(fs.existsSync(f.file(f.home)), false);
  assert.deepEqual(f.read(f.project), { permissions: { defaultMode: "askAll", deny: [] } });
  writePermissionSettingsChanges("user", { scopes: { mcp: "allow" } }, f.project);
  assert.deepEqual(f.read(f.home), { permissions: { defaultMode: "allowAll", allow: ["mcp"] } });
  assert.equal(resolveCurrentSettings(f.project).permissions.defaultMode, "askAll");
});

test("global saves validate project permissions before updating the user file", (t) => {
  const f = fixture(t);
  f.write(f.home, { permissions: { defaultMode: "allowAll" } });
  f.write(f.project, { permissions: { deny: "network" } });
  const before = fs.readFileSync(f.file(f.home), "utf8");
  assert.throws(() => writePermissionSettingsChanges("user", { defaultMode: "askAll" }, f.project));
  assert.equal(fs.readFileSync(f.file(f.home), "utf8"), before);
});

test("invalid settings are never overwritten and a repaired file can be retried", (t) => {
  const f = fixture(t);
  f.write(f.project, {});
  const edit = readPermissionSettingsEdit(f.project);
  for (const raw of ["{broken", "null", "[]", '{"permissions":null}', '{"permissions":{"allow":"network"}}']) {
    fs.writeFileSync(f.file(f.project), raw);
    assert.throws(() => readPermissionSettingsEdit(f.project));
    assert.throws(() => writePermissionSettingsChanges(edit.target, { defaultMode: "askAll" }, f.project));
    assert.equal(fs.readFileSync(f.file(f.project), "utf8"), raw);
  }
  f.write(f.project, {});
  assert.deepEqual(writePermissionSettingsChanges(edit.target, { defaultMode: "askAll" }, f.project), {
    changed: true,
  });
});

test("editing at the home directory reads a single permissions layer", (t) => {
  const f = fixture(t);
  f.write(f.home, { permissions: { deny: ["mcp"] } });
  const edit = readPermissionSettingsEdit(f.home);
  assert.equal(edit.otherPermissions, undefined);
  const changes = { scopes: { mcp: "allow" as const } };
  assert.equal(evaluatePermissionScopes(["mcp"], previewPermissionSettings(edit, changes).effective), "allow");
  writePermissionSettingsChanges(edit.target, changes, f.home);
  assert.equal(evaluatePermissionScopes(["mcp"], resolveCurrentSettings(f.home).permissions), "allow");
});

test("existing empty permissions retain their own default, and default mode edits preserve all scopes", () => {
  const settings: DeepcodingSettings = { permissions: { deny: ["network"], ask: ["network"] } };
  assert.equal(getPermissionScopeSelection(settings.permissions, "network"), "deny");
  const next = applyPermissionSettingsChanges(settings, { defaultMode: "askAll" }, "askAll");
  assert.deepEqual(next.permissions, { deny: ["network"], ask: ["network"], defaultMode: "askAll" });
  assert.equal(settings.permissions?.defaultMode, undefined);
});
