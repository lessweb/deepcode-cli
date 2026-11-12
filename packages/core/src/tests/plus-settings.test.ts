import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Models } from "openai/resources/models";
import {
  resolveEffectivePlusSettings,
  readDeepcodePlusSettings,
  writeDeepcodePlusApiKey,
  withPlusSubscription,
} from "../common/plus-subscription";
import { resolveSettingsSources, type DeepcodingSettings } from "../settings";
import { createOpenAIClient } from "../common/openai-client";

const userKey = `sk-${"a".repeat(24)}`;
const projectKey = `sk-${"b".repeat(26)}`;
const systemKey = `sk-${"c".repeat(24)}`;
const defaults = { model: "deepseek-v4-pro", baseURL: "https://regular.test" };

test("PLUS key follows environment, project, user, then independent settings precedence", () => {
  const user = { env: { PLUS_API_KEY: userKey } };
  const project = { env: { PLUS_API_KEY: ` ${projectKey}\n` } };
  const system = { DEEPCODE_PLUS_API_KEY: systemKey };
  for (const plan of ["on", "off", "default"] as const) {
    const fallback = () => ({ apiKey: userKey, subscriptionPlan: plan });
    for (const [u, p, e, expected] of [
      [user, project, system, systemKey],
      [user, project, {}, projectKey],
      [user, null, {}, userKey],
    ] as const) {
      assert.deepEqual(resolveEffectivePlusSettings(resolveSettingsSources(u, p, defaults, e), fallback), {
        apiKey: expected,
        subscriptionPlan: "default",
      });
    }
    assert.deepEqual(
      resolveEffectivePlusSettings(resolveSettingsSources(null, null, defaults, {}), fallback),
      fallback()
    );
  }
});

test("invalid selected keys fail without falling back; overridden invalid keys are ignored", () => {
  const valid = { env: { PLUS_API_KEY: userKey } };
  for (const value of ["", " ", "invalid", null, 123, {}, []]) {
    const invalid = { env: { PLUS_API_KEY: value } } as unknown as DeepcodingSettings;
    assert.throws(() => resolveSettingsSources(valid, invalid, defaults, {}), /Invalid PLUS_API_KEY/);
    assert.throws(() => resolveSettingsSources(invalid, null, defaults, {}), /Invalid PLUS_API_KEY/);
    assert.equal(resolveSettingsSources(invalid, valid, defaults, {}).env.PLUS_API_KEY, userKey);
    assert.equal(
      resolveSettingsSources(invalid, invalid, defaults, { DEEPCODE_PLUS_API_KEY: systemKey }).env.PLUS_API_KEY,
      systemKey
    );
  }
  assert.throws(
    () => resolveSettingsSources(valid, valid, defaults, { DEEPCODE_PLUS_API_KEY: "" }),
    /Invalid PLUS_API_KEY/
  );
  assert.equal(
    resolveEffectivePlusSettings({ env: { PLUS_API_KEY: userKey } }, () => {
      assert.fail("overridden independent settings must not be read");
    }).apiKey,
    userKey
  );
});

test("factory probes the overriding key and retains it for the turn", async () => {
  const settings = { ...defaults, apiKey: "regular", env: { PLUS_API_KEY: projectKey } };
  const factory = withPlusSubscription(
    () => settings,
    ({ connection, plusApiKey }) => ({
      ...connection,
      plusApiKey,
      client: null,
      model: "test",
      thinkingEnabled: false,
    }),
    {
      readSettings: () => assert.fail("overridden settings must not be read"),
      checkSubscription: async (key) => {
        assert.equal(key, projectKey);
        return "full ability";
      },
    }
  );
  assert.equal(factory().plusApiKey, projectKey);
  await factory.prepare!();
  settings.env.PLUS_API_KEY = userKey;
  assert.equal(factory().apiKey, projectKey);
  assert.equal(factory().plusApiKey, projectKey);
  assert.equal(factory().baseURL, "https://chat.deepcodeplus.com/plugin/openai");
});

test("direct client creation respects the supplied project directory", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plus-project-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, ".deepcode"));
  fs.writeFileSync(path.join(dir, ".deepcode", "settings.json"), JSON.stringify({ env: { PLUS_API_KEY: projectKey } }));
  const testHome = path.join(dir, "home");
  fs.mkdirSync(path.join(testHome, ".deepcode-plus"), { recursive: true });
  fs.writeFileSync(
    path.join(testHome, ".deepcode-plus", "settings.json"),
    JSON.stringify({ subscriptionPlan: "off", env: { PLUS_API_KEY: "invalid-overridden-key" } })
  );
  // Stub SDK warmup so client creation cannot reach a real service.
  t.mock.method(Models.prototype, "list", async () => ({}));
  const originalEnv = process.env;
  process.env = {
    ...originalEnv,
    [process.platform === "win32" ? "USERPROFILE" : "HOME"]: testHome,
    DEEPCODE_API_KEY: "regular",
  };
  delete process.env.DEEPCODE_PLUS_API_KEY;
  t.after(() => {
    process.env = originalEnv;
  });
  const result = createOpenAIClient(dir);
  assert.equal(result.plusApiKey, projectKey);
  assert.equal(result.usingPlus, false);
  assert.equal(result.apiKey, "regular");
});

test("saving creates directories and preserves all other settings", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plus-save-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, ".deepcode-plus", "settings.json");
  writeDeepcodePlusApiKey(` ${userKey}\n`, file);
  assert.deepEqual(readDeepcodePlusSettings(file), { apiKey: userKey, subscriptionPlan: "default" });
  for (const subscriptionPlan of ["on", "off", "default"]) {
    const before = { subscriptionPlan, custom: { enabled: true }, env: { OTHER: "keep", PLUS_API_KEY: userKey } };
    fs.writeFileSync(file, JSON.stringify(before));
    writeDeepcodePlusApiKey(projectKey, file);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), {
      ...before,
      env: { ...before.env, PLUS_API_KEY: projectKey },
    });
  }
});

test("saving rejects invalid keys and malformed existing files without overwriting", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plus-save-invalid-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "settings.json");
  assert.throws(() => writeDeepcodePlusApiKey("invalid", file), /Invalid PLUS_API_KEY/);
  assert.equal(fs.existsSync(file), false);
  for (const raw of ["broken json", "null", "[]", '"string"', '{"env":null}', '{"env":[]}']) {
    fs.writeFileSync(file, raw);
    assert.throws(() => writeDeepcodePlusApiKey(userKey, file));
    assert.equal(fs.readFileSync(file, "utf8"), raw);
  }
  assert.throws(() => writeDeepcodePlusApiKey(userKey, dir), /Unable to read/);
  assert.throws(() => writeDeepcodePlusApiKey(userKey, path.join(file, "settings.json")));
});
