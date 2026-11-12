import { test } from "node:test";
import assert from "node:assert/strict";
import OpenAI from "openai";
import { buildThinkingRequestOptions } from "../common/openai-thinking";

test("buildThinkingRequestOptions explicitly disables thinking", () => {
  assert.deepEqual(buildThinkingRequestOptions(false, "https://api.deepseek.com"), {
    thinking: { type: "disabled" },
  });
});

test("buildThinkingRequestOptions uses the same disabled payload for volces endpoints", () => {
  assert.deepEqual(buildThinkingRequestOptions(false, "https://ark.cn-beijing.volces.com/api/v3"), {
    thinking: { type: "disabled" },
  });
});

test("buildThinkingRequestOptions enables thinking with default reasoning effort", () => {
  assert.deepEqual(buildThinkingRequestOptions(true, "https://api.deepseek.com"), {
    thinking: { type: "enabled" },
    reasoning_effort: "max",
  });
});

test("buildThinkingRequestOptions uses the same enabled payload for volces endpoints", () => {
  assert.deepEqual(buildThinkingRequestOptions(true, "https://ark.cn-beijing.volces.com/api/v3"), {
    thinking: { type: "enabled" },
    reasoning_effort: "max",
  });
});

test("buildThinkingRequestOptions accepts high reasoning effort", () => {
  assert.deepEqual(buildThinkingRequestOptions(true, "https://api.deepseek.com", "high"), {
    thinking: { type: "enabled" },
    reasoning_effort: "high",
  });
});

test("buildThinkingRequestOptions accepts low reasoning effort", () => {
  assert.deepEqual(buildThinkingRequestOptions(true, "https://api.deepseek.com", "low"), {
    thinking: { type: "enabled" },
    reasoning_effort: "low",
  });
});

test("OpenAI SDK sends thinking options at the top level", async () => {
  let body: Record<string, unknown> = {};
  const client = new OpenAI({
    apiKey: "test-key",
    maxRetries: 0,
    fetch: async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return new Response('{"choices":[]}', { headers: { "content-type": "application/json" } });
    },
  });

  for (const [enabled, effort] of [
    [true, "low"],
    [true, "high"],
    [true, "max"],
    [true, undefined],
    [false, "max"],
  ] as const) {
    await client.chat.completions.create({
      model: "deepseek-flash",
      messages: [{ role: "user", content: "hello" }],
      ...buildThinkingRequestOptions(enabled, undefined, effort),
    } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming);

    assert.deepEqual(body, {
      model: "deepseek-flash",
      messages: [{ role: "user", content: "hello" }],
      thinking: { type: enabled ? "enabled" : "disabled" },
      ...(enabled ? { reasoning_effort: effort ?? "max" } : {}),
    });
  }
});
