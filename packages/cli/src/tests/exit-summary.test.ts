import { test } from "node:test";
import assert from "node:assert/strict";
import { buildExitSummaryText } from "../ui";
import type { ModelUsage, SessionEntry } from "@vegamo/deepcode-core";

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

test("buildExitSummaryText shows resume hint when sessionId is provided", () => {
  const sessionId = "0a5cb7a5-c39d-4c39-a11b-05f8b22b8df6";
  const summary = stripAnsi(
    buildExitSummaryText({
      session: buildSession(null),
      sessionId,
    })
  );

  assert.match(summary, /Goodbye!/);
  assert.match(summary, /deepcode --resume 0a5cb7a5-c39d-4c39-a11b-05f8b22b8df6/);
  assert.match(summary, /To continue this session/);
});

test("buildExitSummaryText does not show resume hint when sessionId is omitted", () => {
  const summary = stripAnsi(
    buildExitSummaryText({
      session: buildSession(null),
    })
  );

  assert.match(summary, /Goodbye!/);
  assert.doesNotMatch(summary, /deepcode --resume/);
  assert.doesNotMatch(summary, /To continue this session/);
});

test("buildExitSummaryText shows resume hint with null session", () => {
  const summary = stripAnsi(
    buildExitSummaryText({
      session: null,
      sessionId: "test-session-id",
    })
  );

  assert.match(summary, /Goodbye!/);
  assert.match(summary, /deepcode --resume test-session-id/);
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
