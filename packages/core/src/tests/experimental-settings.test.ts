import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { syncBuiltinESMExports } from "node:module";
import { resolveSettingsSources, writeReasoningSummarySelection, type DeepcodingSettings } from "../settings";

const defaults = { model: "main-model", baseURL: "https://example.com" };

test("experimental defaults and independent project overrides", () => {
  assert.deepEqual(resolveSettingsSources(null, null, defaults, {}).experimental, {
    reasoningSummary: "off",
    reasoningSummaryModel: "deepseek-flash",
  });
  assert.deepEqual(
    resolveSettingsSources(
      { experimental: { reasoningSummary: "on", reasoningSummaryModel: "custom-summary" } },
      { experimental: { reasoningSummary: "off" } },
      defaults,
      {}
    ).experimental,
    { reasoningSummary: "off", reasoningSummaryModel: "custom-summary" }
  );
  assert.deepEqual(
    resolveSettingsSources(
      { experimental: { reasoningSummary: "on" } },
      { experimental: { reasoningSummary: true, reasoningSummaryModel: " " } } as unknown as DeepcodingSettings,
      defaults,
      {}
    ).experimental,
    { reasoningSummary: "on", reasoningSummaryModel: "deepseek-flash" }
  );
});

test("experimental saves preserve other fields and global saves remove only the project switch", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "experimental-settings-"));
  const userHome = path.join(root, "user");
  const project = path.join(root, "project");
  t.mock.method(os, "homedir", () => userHome);
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const file = (dir: string) => path.join(dir, ".deepcode", "settings.json");
  const read = (dir: string) => JSON.parse(fs.readFileSync(file(dir), "utf8"));
  writeReasoningSummarySelection("on", project, "user");
  assert.equal(fs.existsSync(file(project)), false);
  writeReasoningSummarySelection("on", project, "project");
  assert.deepEqual(read(project), { experimental: { reasoningSummary: "on" } });
  assert.equal(writeReasoningSummarySelection("on", project, "project").changed, false);
  fs.writeFileSync(
    file(project),
    JSON.stringify({
      notify: "keep",
      experimental: { reasoningSummary: "off", reasoningSummaryModel: "custom", future: 1 },
    })
  );
  assert.equal(writeReasoningSummarySelection("on", project, "user").changed, true);
  assert.deepEqual(read(project), {
    notify: "keep",
    experimental: { reasoningSummaryModel: "custom", future: 1 },
  });
  assert.deepEqual(read(userHome), { experimental: { reasoningSummary: "on" } });
  assert.equal(writeReasoningSummarySelection("on", project, "user").changed, false);
  const before = fs.readFileSync(file(userHome), "utf8");
  fs.writeFileSync(file(project), '{"experimental": []}');
  assert.throws(() => writeReasoningSummarySelection("off", project, "user"), /Invalid experimental/);
  assert.equal(fs.readFileSync(file(userHome), "utf8"), before);
  writeReasoningSummarySelection("off", userHome, "user");
  assert.equal(read(userHome).experimental.reasoningSummary, "off");
});
