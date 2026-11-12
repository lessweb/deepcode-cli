import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  normalizePlusApiKey,
  resolvePlusHost,
  resolvePlusLlmHost,
  checkPlusSubscription,
  resolveOpenAIConnection,
  withPlusSubscription,
} from "../common/plus-subscription";
import { readDeepcodePlusSettings } from "../settings";
import { reportNewPrompt } from "../common/telemetry";

const routes = [
  [undefined, "https://deepcode.vegamo.cn", "https://deepcode.vegamo.cn"],
  [`sk-${"a".repeat(24)}`, "https://deepcode.vegamo.cn", "https://deepcode.vegamo.cn"],
  [`sk-${"b".repeat(26)}`, "https://www.deepcodeplus.com", "https://chat.deepcodeplus.com"],
] as const;

for (const [key, host, llmHost] of routes) {
  test(`PLUS routing for ${key?.length ?? "absent"} characters`, async (t) => {
    assert.equal(resolvePlusHost(key), host);
    assert.equal(resolvePlusLlmHost(key), llmHost);
    if (key) {
      for (const input of [key, `  ${key}\n`]) {
        assert.equal(normalizePlusApiKey(input), key);
        assert.equal(resolvePlusHost(input), host);
        assert.equal(resolvePlusLlmHost(input), llmHost);
        assert.equal(
          resolveOpenAIConnection({ baseURL: "https://regular.test" }, input, "on").baseURL,
          `${llmHost}/plugin/openai`
        );
        assert.equal(
          await checkPlusSubscription(input, undefined, async (url, options) => {
            assert.equal(url, `${llmHost}/plugin/openai/models`);
            assert.equal(options.headers.Authorization, `Bearer ${key}`);
            return { status: 200 };
          }),
          "full ability"
        );
      }
    }
    const fetch = t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
      assert.equal(url, `${host}/api/plugin/new`);
      assert.deepEqual(init.headers, { "Content-Type": "application/json", Token: "test-machine" });
      return new Response("{}");
    });
    reportNewPrompt({ enabled: true, machineId: "test-machine", plusApiKey: key });
    assert.equal(fetch.mock.callCount(), 1);
    await new Promise((resolve) => setImmediate(resolve));
  });
}

test("PLUS suffix is not limited to alphanumeric characters", () => {
  for (const suffix of ["_".repeat(24), "😀".repeat(26)]) {
    assert.equal(normalizePlusApiKey(`sk-${suffix}`), `sk-${suffix}`);
  }
});

test("configured invalid values fail for every subscription plan without revealing the key", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "deepcode-plus-invalid-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "settings.json");
  t.mock.method(globalThis, "fetch", async () => assert.fail("must not fetch"));
  assert.throws(() => resolvePlusLlmHost("invalid"), /Invalid PLUS_API_KEY/);
  for (const plan of ["default", "on", "off"] as const) {
    for (const value of [
      "",
      "   ",
      null,
      123,
      {},
      [],
      "secret-invalid-key",
      `SK-${"a".repeat(24)}`,
      ...[23, 25, 27].map((length) => `sk-${"a".repeat(length)}`),
    ]) {
      fs.writeFileSync(file, JSON.stringify({ subscriptionPlan: plan, env: { PLUS_API_KEY: value } }));
      assert.throws(
        () => readDeepcodePlusSettings(file),
        (error: Error) => {
          assert.equal(error.message, `Invalid PLUS_API_KEY in ${file}.`);
          if (typeof value === "string" && value.trim()) assert.ok(!error.message.includes(value));
          return true;
        }
      );
    }
    const factory = withPlusSubscription(
      () => ({ apiKey: "regular", baseURL: "https://regular.test" }),
      () => assert.fail("must not build a client"),
      {
        readSettings: () => ({ apiKey: "invalid", subscriptionPlan: plan }),
        checkSubscription: async () => assert.fail("must not probe"),
      }
    );
    await assert.rejects(factory.prepare!(), /Invalid PLUS_API_KEY/);
    assert.throws(() => factory(), /Invalid PLUS_API_KEY/);
  }
  await assert.rejects(
    checkPlusSubscription("invalid", undefined, async () => assert.fail("must not probe")),
    /Invalid PLUS_API_KEY/
  );
  assert.throws(
    () => reportNewPrompt({ enabled: true, machineId: "test-machine", plusApiKey: "invalid" }),
    /Invalid PLUS_API_KEY/
  );
});
