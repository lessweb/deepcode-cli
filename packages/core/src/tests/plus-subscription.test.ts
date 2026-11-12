import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkPlusSubscription,
  DEEPCODE_PLUS_BASE_URL,
  resolveOpenAIConnection,
  withPlusSubscription,
  type PlusSubscriptionStatus,
} from "../common/plus-subscription";
import type { DeepcodePlusSettings } from "../settings";

test("connection selection covers all plans, subscription states and missing credentials", () => {
  for (const subscriptionPlan of ["default", "on", "off"] as const) {
    for (const status of ["api only", "full ability", "unknown"] as const) {
      for (const apiKey of [undefined, "regular"]) {
        for (const plusKey of [undefined, "sk-aaaaaaaaaaaaaaaaaaaaaaaa"]) {
          const connection = resolveOpenAIConnection(
            { apiKey, baseURL: "https://regular.test" },
            plusKey,
            subscriptionPlan,
            status
          );
          const label = JSON.stringify({ subscriptionPlan, status, apiKey, plusKey });
          if (subscriptionPlan === "on" && !plusKey) {
            assert.equal(connection.apiKey, undefined, label);
            assert.match(connection.configurationError!, /PLUS_API_KEY.*~\/.deepcode-plus\/settings.json/, label);
            assert.equal(connection.usingPlus, false, label);
            continue;
          }
          const expectedPlus =
            Boolean(plusKey) &&
            (subscriptionPlan === "on" ||
              (subscriptionPlan === "default" && (status === "full ability" || (status === "unknown" && !apiKey))));
          assert.equal(connection.usingPlus, expectedPlus, label);
          assert.equal(connection.apiKey, expectedPlus ? plusKey : apiKey, label);
          assert.equal(connection.baseURL, expectedPlus ? DEEPCODE_PLUS_BASE_URL : "https://regular.test", label);
        }
      }
    }
  }
});

test("subscription check uses authenticated GET and only the exact HTTP status", async () => {
  for (const status of [200, 201, 204, 301, 401, 403, 404, 429, 500, 503]) {
    let released = false;
    const result = await checkPlusSubscription("sk-aaaaaaaaaaaaaaaaaaaaaaaa", undefined, async (url, options) => {
      assert.equal(url, `${DEEPCODE_PLUS_BASE_URL}/models`);
      assert.equal(options.method, "GET");
      assert.deepEqual(options.headers, { Authorization: "Bearer sk-aaaaaaaaaaaaaaaaaaaaaaaa" });
      assert.equal(options.redirect, "manual");
      return {
        status,
        body: {
          cancel: async () => {
            released = true;
          },
        },
      };
    });
    assert.equal(result, status === 200 ? "full ability" : status === 401 || status === 403 ? "api only" : "unknown");
    assert.equal(released, true);
  }
});

test("network failure and timeout are unknown without retrying", async () => {
  let calls = 0;
  assert.equal(
    await checkPlusSubscription("sk-aaaaaaaaaaaaaaaaaaaaaaaa", undefined, async () => {
      calls++;
      throw new Error("offline");
    }),
    "unknown"
  );
  assert.equal(calls, 1);
  assert.equal(
    await checkPlusSubscription(
      "sk-aaaaaaaaaaaaaaaaaaaaaaaa",
      undefined,
      async (_url, { signal }) => {
        calls++;
        return new Promise((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason), { once: true })
        );
      },
      5
    ),
    "unknown"
  );
  assert.equal(calls, 2);
});

test("user cancellation propagates instead of selecting a fallback", async () => {
  const controller = new AbortController();
  const reason = new Error("cancelled by user");
  await assert.rejects(
    checkPlusSubscription("sk-aaaaaaaaaaaaaaaaaaaaaaaa", controller.signal, async (_url, { signal }) => {
      controller.abort(reason);
      throw signal.reason;
    }),
    (error) => error === reason
  );
  await assert.rejects(
    checkPlusSubscription("sk-aaaaaaaaaaaaaaaaaaaaaaaa", controller.signal, async () => {
      assert.fail("must not fetch when already aborted");
    }),
    (error) => error === reason
  );
});

test("factory prepares once per turn, holds credentials stable, and isolates instances", async () => {
  let plus: DeepcodePlusSettings = { apiKey: "sk-aaaaaaaaaaaaaaaaaaaaaaaa", subscriptionPlan: "default" };
  let regular = { apiKey: "regular", baseURL: "https://regular.test" };
  let status: PlusSubscriptionStatus = "full ability";
  let checks = 0;
  const makeFactory = () =>
    withPlusSubscription(
      () => regular,
      ({ connection, plusApiKey }) => ({
        ...connection,
        plusApiKey,
        client: null,
        model: "test",
        thinkingEnabled: false,
      }),
      {
        readSettings: () => plus,
        checkSubscription: async (key) => {
          assert.equal(key, plus.apiKey);
          checks++;
          return status;
        },
      }
    );
  const factory = makeFactory();
  const otherFactory = makeFactory();
  await factory.prepare!();
  plus = { apiKey: "sk-bbbbbbbbbbbbbbbbbbbbbbbbbb", subscriptionPlan: "default" };
  regular = { apiKey: "changed-regular", baseURL: "https://changed.test" };
  status = "api only";
  for (let i = 0; i < 3; i++) {
    assert.equal(factory().apiKey, "sk-aaaaaaaaaaaaaaaaaaaaaaaa");
    assert.equal(factory().usingPlus, true);
  }
  assert.equal(checks, 1);
  await otherFactory.prepare!();
  assert.equal(otherFactory().apiKey, "changed-regular");
  assert.equal(factory().apiKey, "sk-aaaaaaaaaaaaaaaaaaaaaaaa");
  await factory.prepare!();
  assert.equal(factory().apiKey, "changed-regular");
  assert.equal(factory().usingPlus, false);
  assert.equal(checks, 3);
});

test("on, off and absent PLUS key skip subscription checks", async () => {
  for (const plan of ["on", "off", "default"] as const) {
    for (const key of [undefined, "sk-aaaaaaaaaaaaaaaaaaaaaaaa"]) {
      if (plan === "default" && key) continue;
      const factory = withPlusSubscription(
        () => ({ apiKey: "regular", baseURL: "https://regular.test" }),
        ({ connection }) => ({ ...connection, client: null, model: "test", thinkingEnabled: false }),
        {
          readSettings: () => ({ subscriptionPlan: plan, apiKey: key }),
          checkSubscription: async () => {
            assert.fail("must not check subscription");
          },
        }
      );
      await factory.prepare!();
      assert.equal(factory().apiKey, plan === "on" ? key : "regular");
    }
  }
});
