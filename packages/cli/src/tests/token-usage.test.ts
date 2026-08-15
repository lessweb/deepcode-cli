import { test } from "node:test";
import assert from "node:assert/strict";
import type { ResolvedDeepcodingSettings, SessionEntry, SessionMessage } from "@vegamo/deepcode-core";
import { buildUsageReport, estimateContextTokens, getPricingForModel } from "../ui/core/token-usage";

function message(overrides: Partial<SessionMessage> = {}): SessionMessage {
  return {
    id: "m1",
    sessionId: "s1",
    role: "assistant",
    content: "",
    contentParams: null,
    messageParams: null,
    compacted: false,
    visible: true,
    createTime: "2026-01-01T00:00:00.000Z",
    updateTime: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function sessionEntry(overrides: Partial<SessionEntry> = {}): SessionEntry {
  return {
    id: "s1",
    summary: null,
    assistantReply: null,
    assistantThinking: null,
    assistantRefusal: null,
    toolCalls: null,
    status: "completed",
    failReason: null,
    usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 },
    usagePerModel: null,
    activeTokens: 1200,
    processes: null,
    createTime: "2026-01-01T00:00:00.000Z",
    updateTime: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function settings(overrides: Partial<ResolvedDeepcodingSettings> = {}): ResolvedDeepcodingSettings {
  return {
    env: {},
    apiKey: "sk-test",
    baseURL: "https://api.deepseek.com",
    model: "deepseek-v4-flash",
    contextWindow: 1024 * 1024,
    autoCompactWindow: 512 * 1024,
    thinkingEnabled: true,
    reasoningEffort: "max",
    debugLogEnabled: false,
    telemetryEnabled: false,
    permissions: { allow: [], deny: [], ask: [], defaultMode: "allowAll" },
    enabledSkills: {},
    statusline: { enabled: false, refreshMs: 2000, separator: " · ", providers: [] },
    ...overrides,
  };
}

test("getPricingForModel returns known pricing and a default fallback", () => {
  assert.deepEqual(getPricingForModel("deepseek-v4-flash"), { input: 0.28, output: 0.42 });
  assert.deepEqual(getPricingForModel("some-other-model"), { input: 1, output: 2 });
});

test("estimateContextTokens skips compacted messages and counts chars / 4", () => {
  const messages = [
    message({ content: "a".repeat(400) }),
    message({ content: "b".repeat(400), compacted: true }),
    message({ content: "cc" }),
  ];
  assert.equal(estimateContextTokens(messages), Math.ceil(402 / 4));
});

test("buildUsageReport formats the /tokens report", () => {
  const report = buildUsageReport(sessionEntry(), settings(), [message({ content: "x".repeat(100) })], "tokens");
  assert.match(report, /prompt tokens:\s+1,000/);
  assert.match(report, /completion tokens:\s+500/);
  assert.match(report, /total tokens:\s+1,500/);
});

test("buildUsageReport formats the /context report with window usage", () => {
  const report = buildUsageReport(sessionEntry(), settings(), [message({ content: "x".repeat(100) })], "context");
  assert.match(report, /context window:\s+1,048,576 tokens/);
  assert.match(report, /estimated usage:/);
  assert.match(report, /%\)/);
});

test("buildUsageReport formats the /cost report with pricing", () => {
  const report = buildUsageReport(sessionEntry(), settings(), [], "cost");
  assert.match(report, /input rate:\s+\$0\.28\/1M tokens/);
  assert.match(report, /estimated cost:\s+\$/);
});
