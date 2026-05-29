import { test } from "node:test";
import assert from "node:assert/strict";
import { buildExitSummaryText } from "../ui";
import type { ModelUsage, SessionEntry } from "../session";

const stripAnsi = (text: string): string => text.replace(/\u001b\[[0-9;]*m/g, "");

test("buildExitSummaryText only shows Goodbye and model usage with cached tokens", () => {
  const summary = stripAnsi(
    buildExitSummaryText({
      session: buildSession(null, {
        "mimo-v2.5-pro": {
          prompt_tokens: 11_966,
          completion_tokens: 236,
          total_tokens: 12_202,
          prompt_tokens_details: { cached_tokens: 11_776 },
          completion_tokens_details: { reasoning_tokens: 144 },
          total_reqs: 2,
        },
      }),
    })
  );

  assert.match(summary, /Goodbye!/);
  assert.match(summary, /╭─+╮/);
  assert.match(summary, /╰─+╯/);
  assert.match(summary, /Model Usage/);
  assert.match(summary, /Cached Tokens/);
  assert.match(summary, /mimo-v2\.5-pro\s+2\s+11,966\s+236\s+11,776/);
  assert.doesNotMatch(summary, /Agent powering down/);
  assert.doesNotMatch(summary, /Interaction Summary/);
  assert.doesNotMatch(summary, /Context Window/);
  assert.doesNotMatch(summary, /Savings Highlight/);
  assert.doesNotMatch(summary, /Reasoning Tokens/);
});

test("buildExitSummaryText shows all usagePerModel rows sorted by request count", () => {
  const summary = stripAnsi(
    buildExitSummaryText({
      session: buildSession(
        {
          prompt_tokens: 999,
          completion_tokens: 999,
          total_tokens: 1_998,
        },
        {
          "deepseek-v4-pro": {
            prompt_tokens: 100,
            completion_tokens: 10,
            total_tokens: 110,
            total_reqs: 1,
          },
          "deepseek-v4-flash": {
            prompt_tokens: 300,
            completion_tokens: 30,
            total_tokens: 330,
            prompt_cache_hit_tokens: 111,
            total_reqs: 3,
          },
        }
      ),
    })
  );

  const flashIndex = summary.indexOf("deepseek-v4-flash");
  const proIndex = summary.indexOf("deepseek-v4-pro");

  assert.notEqual(flashIndex, -1);
  assert.notEqual(proIndex, -1);
  assert.ok(flashIndex < proIndex);
  assert.match(summary, /deepseek-v4-flash\s+3\s+300\s+30\s+111/);
  assert.match(summary, /deepseek-v4-pro\s+1\s+100\s+10\s+0/);
  assert.doesNotMatch(summary, /999/);
});

test("buildExitSummaryText does not derive usage rows from legacy aggregate usage", () => {
  const summary = stripAnsi(
    buildExitSummaryText({
      session: buildSession({
        prompt_tokens: 11_966,
        completion_tokens: 236,
        total_tokens: 12_202,
        total_reqs: 2,
      }),
    })
  );

  assert.match(summary, /Goodbye!/);
  assert.doesNotMatch(summary, /Model Usage/);
  assert.doesNotMatch(summary, /11,966/);
});

function buildSession(usage: ModelUsage | null, usagePerModel: Record<string, ModelUsage> | null = null): SessionEntry {
  return {
    id: "session-1",
    summary: null,
    assistantReply: null,
    assistantThinking: null,
    assistantRefusal: null,
    toolCalls: null,
    status: "completed",
    failReason: null,
    usage,
    usagePerModel,
    activeTokens: 0,
    createTime: "2026-01-01T00:00:00.000Z",
    updateTime: "2026-01-01T00:00:01.000Z",
    processes: null,
  };
}
