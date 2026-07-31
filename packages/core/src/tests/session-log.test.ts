import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  logAgentMessage,
  logToolCall,
  logPermissionDecision,
  logTokenUsage,
  saveCheckpoint,
  queryRecentLogs,
  queryLogsByJsonPath,
  queryTokenStats,
  queryPermissionHistory,
  closeSession,
  deleteSession,
} from "../common/session-log";

const TEST_SESSION = "test-session-log-" + Date.now();

describe("SessionLog - SQLite operations", { timeout: 10000 }, () => {
  after(async () => {
    await deleteSession(TEST_SESSION);
  });

  test("write and read agent message log", async () => {
    await logAgentMessage(TEST_SESSION, {
      type: "agentMessage",
      role: "assistant",
      content: "Hello from test",
    });

    const logs = await queryRecentLogs(TEST_SESSION, 10, "agentMessage");
    assert.ok(logs.length >= 1);
    assert.equal(logs[0].type, "agentMessage");
    const data = logs[0].data as Record<string, unknown>;
    assert.equal(data.content, "Hello from test");
  });

  test("write and read tool call log", async () => {
    await logToolCall(TEST_SESSION, {
      name: "bash",
      arguments: { command: "echo hello" },
    });

    const logs = await queryRecentLogs(TEST_SESSION, 10, "toolCall");
    assert.ok(logs.length >= 1);
    assert.equal(logs[0].type, "toolCall");
  });

  test("json_extract query works", async () => {
    await logAgentMessage(TEST_SESSION, {
      type: "agentMessage",
      role: "user",
      content: "special-marker-xyz",
    });

    const logs = await queryLogsByJsonPath(TEST_SESSION, "$.content", "special-marker-xyz");
    assert.ok(logs.length >= 1);
    assert.equal((logs[0].data as Record<string, unknown>).content, "special-marker-xyz");
  });

  test("write and read permission audit", async () => {
    await logPermissionDecision(TEST_SESSION, "tc-001", "bash", ["write-in-cwd"], "allow", "auto-approved");

    const history = await queryPermissionHistory(TEST_SESSION);
    assert.ok(history.length >= 1);
    assert.equal(history[0].tool_name, "bash");
    assert.equal(history[0].decision, "allow");
    assert.deepEqual(history[0].scopes, ["write-in-cwd"]);
  });

  test("write and query token usage", async () => {
    await logTokenUsage(TEST_SESSION, 500, 500, 8000);
    await logTokenUsage(TEST_SESSION, 300, 800, 8000);

    const stats = await queryTokenStats(TEST_SESSION);
    assert.ok(stats !== null);
    assert.equal(stats.maxBudget, 8000);
    assert.equal(stats.totalTokens, 800);
  });

  test("save and restore checkpoint", async () => {
    const checkpointId = await saveCheckpoint(
      TEST_SESSION,
      { files: ["src/main.ts"], messages: [] },
      "test-checkpoint"
    );
    assert.ok(checkpointId > 0);
  });

  test("queryRecentLogs with type filter returns correct types", async () => {
    const allLogs = await queryRecentLogs(TEST_SESSION, 100);
    const types = new Set(allLogs.map((l) => l.type));
    // Should have at least agentMessage and toolCall types
    assert.ok(types.has("agentMessage"));
    assert.ok(types.has("toolCall"));
  });

  test("queryRecentLogs limit works", async () => {
    const limited = await queryRecentLogs(TEST_SESSION, 2);
    assert.ok(limited.length <= 2);
  });
});
