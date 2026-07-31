import { test } from "node:test";
import assert from "node:assert/strict";
import type { SessionEntry } from "@vegamo/deepcode-core";
import { buildStatusLine, formatContextUsage, formatTokenCount } from "../ui/utils/index";

test("formatTokenCount uses binary K/M units with at most one decimal", () => {
  assert.equal(formatTokenCount(0), "0");
  assert.equal(formatTokenCount(1023), "1023");
  assert.equal(formatTokenCount(1126), "1.1K");
  assert.equal(formatTokenCount(1024 * 1024), "1M");
  assert.equal(formatTokenCount(1.25 * 1024 * 1024), "1.3M");
});

test("formatContextUsage rounds a ten-cell bar to whole blocks", () => {
  assert.equal(formatContextUsage(0, 1000), "0/1000 [░░░░░░░░░░] 0%");
  assert.equal(formatContextUsage(20, 1000), "20/1000 [░░░░░░░░░░] 2%");
  assert.equal(formatContextUsage(200, 1000), "200/1000 [▓▓░░░░░░░░] 20%");
  assert.equal(formatContextUsage(550, 1000), "550/1000 [▓▓▓▓▓▓░░░░] 55%");
});

test("formatContextUsage caps the bar and percentage at 100 percent", () => {
  assert.equal(formatContextUsage(1200, 1000), "1.2K/1000 [▓▓▓▓▓▓▓▓▓▓] 100%");
});

test("buildStatusLine replaces the tokens label while preserving status and failure", () => {
  const entry: SessionEntry = {
    id: "session-1",
    summary: null,
    assistantReply: null,
    assistantThinking: null,
    assistantRefusal: null,
    toolCalls: null,
    status: "failed",
    failReason: "boom",
    usage: null,
    usagePerModel: null,
    activeTokens: 20,
    createTime: "2026-01-01T00:00:00.000Z",
    updateTime: "2026-01-01T00:00:01.000Z",
    processes: null,
  };

  assert.equal(buildStatusLine(entry, 1000), "status: failed · 20/1000 [░░░░░░░░░░] 2% · fail: boom");
});

test("buildStatusLine omits context usage when no active tokens exist", () => {
  const entry = {
    status: "pending",
    activeTokens: 0,
    failReason: null,
  } as SessionEntry;

  assert.equal(buildStatusLine(entry, 1024 * 1024), "status: pending");
});
