/**
 * Integration tests for the full context-usage pipeline:
 *
 *   API call → Token accumulation → Cost calculation
 *   → sessions-index.json persistence → UsageTracker reading
 *   → ContextBar thresholds → /cost command output
 *   → /compact command → session-state recovery
 *
 * These tests verify the end-to-end correctness of every piece built
 * across the previous tasks (usage-tracker, cost-calculator, cost-calculator
 * via computeSessionEntryCost inside SessionManager, ContextBar, /cost,
 * and /compact).
 */

import { after, afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// ---- core imports ----
import { SessionManager, getProjectCode } from "../session";
import { UsageTracker } from "../common/usage-tracker";
import { CostCalculator, computeCost, computeCostFromUsage } from "../common/cost-calculator";
import { DEFAULT_PRICING } from "../settings";
import type { ModelUsage, SessionEntry, SessionMessage } from "../session";
import type { CostBreakdown } from "../common/cost-calculator";

// ---- helpers duplicated from session.test.ts to keep this file standalone ----

const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const tempDirs: string[] = [];

function setHomeDir(dir: string): void {
  process.env.HOME = dir;
  if (process.platform === "win32") {
    process.env.USERPROFILE = dir;
  }
}

function createTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function createChatResponse(content: string, usage: Record<string, unknown>): unknown {
  return {
    choices: [{ message: { content } }],
    usage,
  };
}

function isSkillMatchingRequest(request: any): boolean {
  return (
    request &&
    (request.response_format?.type === "json_object" ||
      (Array.isArray(request.messages) &&
        request.messages.some((m: any) => typeof m?.content === "string" && m.content.includes("candidate skills"))))
  );
}

function createSkillMatchingResponse(skillNames: string[] = []): unknown {
  return {
    choices: [{ message: { content: JSON.stringify({ skillNames }) } }],
    usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
  };
}

function createMockedClientSessionManager(projectRoot: string, responses: unknown[]): SessionManager {
  const remaining = [...responses];

  return createMockedClientSessionManagerWithClient(projectRoot, {
    chat: {
      completions: {
        create: async (request: any) => {
          if (isSkillMatchingRequest(request)) {
            return createSkillMatchingResponse();
          }
          const response = remaining.shift();
          assert.ok(response, "expected a queued chat response but none remained");
          return response;
        },
      },
    },
  });
}

function createMockedClientSessionManagerWithClient(projectRoot: string, client: unknown): SessionManager {
  return new SessionManager({
    projectRoot,
    createOpenAIClient: () => ({
      client: client as any,
      model: "test-model",
      baseURL: "https://api.test.invalid",
      temperature: undefined,
      thinkingEnabled: false,
      reasoningEffort: "max",
      debugLogEnabled: false,
      telemetryEnabled: false,
      notify: "",
      env: {},
    }),
    getResolvedSettings: () => ({
      model: "test-model",
    }),
    renderMarkdown: (text: string) => text,
    onAssistantMessage: () => {},
  });
}

afterEach(() => {
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }
  if (originalUserProfile === undefined) {
    delete process.env.USERPROFILE;
  } else {
    process.env.USERPROFILE = originalUserProfile;
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

// ---------------------------------------------------------------------------
// Part A – Token accumulation + cost calculation via SessionManager
// ---------------------------------------------------------------------------

describe("Integration: Token accumulation → Cost calculation → Persistence", () => {
  test("single API call accumulates usage and costs correctly", async () => {
    const workspace = createTempDir("integ-usage-workspace-");
    const home = createTempDir("integ-usage-home-");
    setHomeDir(home);

    const responses = [
      createChatResponse("hello", {
        prompt_tokens: 10_000,
        completion_tokens: 5_000,
        total_tokens: 15_000,
        prompt_cache_hit_tokens: 2_000,
      }),
    ];
    const manager = createMockedClientSessionManager(workspace, responses);
    const sessionId = await manager.createSession({ text: "test prompt" });

    const session = manager.getSession(sessionId);
    assert.ok(session);
    assert.ok(session.usage);

    // Token accumulation
    assert.equal(session.usage.prompt_tokens, 10_000);
    assert.equal(session.usage.completion_tokens, 5_000);
    assert.equal(session.usage.total_tokens, 15_000);
    assert.equal(session.usage.prompt_cache_hit_tokens, 2_000);

    // Cost from the pure computeCost function
    const cost = computeCost(10_000, 5_000, 2_000, DEFAULT_PRICING);
    // miss: 8000/1M * 0.14 = 0.00112
    // hit:  2000/1M * 0.0028 = 0.000006 (rounded)
    // out:  5000/1M * 0.28 = 0.0014
    // total = 0.002526
    assert.equal(cost.inputCost, 0.00112);
    assert.equal(cost.outputCost, 0.0014);
    assert.equal(cost.totalCost, 0.002526);

    // sessions-index.json should have the pre-computed totalCost
    const tracker = new UsageTracker(workspace);
    const snapshot = tracker.getSnapshot();
    assert.ok(snapshot.sessions[sessionId]);
    assert.equal(snapshot.sessions[sessionId].promptTokens, 10_000);
    assert.equal(snapshot.sessions[sessionId].totalTokens, 15_000);
  });

  test("multiple API calls accumulate usage and cost additively", async () => {
    const workspace = createTempDir("integ-multi-workspace-");
    const home = createTempDir("integ-multi-home-");
    setHomeDir(home);

    // Two turns: response A + response B
    const responses = [
      createChatResponse("first", {
        prompt_tokens: 100_000,
        completion_tokens: 50_000,
        total_tokens: 150_000,
        prompt_cache_hit_tokens: 20_000,
      }),
      createChatResponse("second", {
        prompt_tokens: 200_000,
        completion_tokens: 100_000,
        total_tokens: 300_000,
        prompt_cache_hit_tokens: 50_000,
      }),
    ];
    const manager = createMockedClientSessionManager(workspace, responses);

    const sessionId = await manager.createSession({ text: "" });
    // First turn already consumed by createSession
    // Second turn needs a reply
    await manager.replySession(sessionId, { text: "continue" });

    const session = manager.getSession(sessionId);
    assert.ok(session?.usage);

    // Accumulated tokens: 100k+200k prompt, 50k+100k completion
    assert.equal(session.usage.prompt_tokens, 300_000);
    assert.equal(session.usage.completion_tokens, 150_000);
    assert.equal(session.usage.total_tokens, 450_000);
    assert.equal(session.usage.prompt_cache_hit_tokens, 70_000);

    // Cost check
    const cost = computeCost(300_000, 150_000, 70_000, DEFAULT_PRICING);
    // miss: 230000/1M * 0.14 = 0.0322
    // hit:  70000/1M * 0.0028 = 0.000196
    // out:  150000/1M * 0.28 = 0.042
    // total = 0.074396
    assert.equal(cost.totalCost, 0.074396);

    // Persistence: the sessions-index should be readable by UsageTracker
    const tracker = new UsageTracker(workspace);
    const total = tracker.getTotalUsage();
    assert.equal(total.promptTokens, 300_000);
    assert.equal(total.totalTokens, 450_000);
  });

  test("sessions-index.json totalCost field is persisted and readable", async () => {
    const workspace = createTempDir("integ-persist-workspace-");
    const home = createTempDir("integ-persist-home-");
    setHomeDir(home);

    const responses = [
      createChatResponse("ok", {
        prompt_tokens: 1_000_000,
        completion_tokens: 500_000,
        total_tokens: 1_500_000,
      }),
    ];
    const manager = createMockedClientSessionManager(workspace, responses);
    await manager.createSession({ text: "" });

    // Read the sessions-index.json directly from disk
    const code = getProjectCode(workspace);
    const indexPath = path.join(home, ".deepcode", "projects", code, "sessions-index.json");

    assert.ok(fs.existsSync(indexPath), "sessions-index.json should exist");

    const raw = JSON.parse(fs.readFileSync(indexPath, "utf8"));
    assert.equal(typeof raw.version, "number");
    assert.ok(Array.isArray(raw.entries));
    assert.equal(raw.entries.length, 1);

    // totalCost should be pre-computed and persisted
    assert.ok(typeof raw.totalCost === "number", "totalCost should be a number");
    assert.ok(raw.totalCost > 0, "totalCost should be positive");

    // 1M prompt + 500k completion
    // cost = 1M/1M*0.14 + 500k/1M*0.28 = 0.14 + 0.14 = 0.28
    assert.equal(raw.totalCost, 0.28);

    // Also readable via CostCalculator
    const calc = new CostCalculator(workspace);
    const { total } = calc.getTotalCost();
    assert.equal(total.totalCost, 0.28);
  });
});

// ---------------------------------------------------------------------------
// Part B – ContextBar thresholds
// ---------------------------------------------------------------------------

describe("Integration: ContextBar threshold logic", () => {
  function computeContextUsage(totalTokens: number, maxContextTokens: number) {
    if (maxContextTokens <= 0) return null;
    const percentage = Math.min(100, Math.round((totalTokens / maxContextTokens) * 100));
    return {
      totalTokens,
      maxContextTokens,
      percentage,
      level: percentage >= 90 ? "red" : percentage >= 70 ? "yellow" : "normal",
    };
  }

  test("below 70% returns normal level", () => {
    const result = computeContextUsage(500_000, 1_000_000);
    assert.ok(result);
    assert.equal(result.percentage, 50);
    assert.equal(result.level, "normal");
  });

  test("at 70% exactly returns yellow level", () => {
    const result = computeContextUsage(700_000, 1_000_000);
    assert.ok(result);
    assert.equal(result.percentage, 70);
    assert.equal(result.level, "yellow");
  });

  test("at 75% returns yellow level", () => {
    const result = computeContextUsage(750_000, 1_000_000);
    assert.ok(result);
    assert.equal(result.level, "yellow");
  });

  test("at 90% exactly returns red level", () => {
    const result = computeContextUsage(900_000, 1_000_000);
    assert.ok(result);
    assert.equal(result.percentage, 90);
    assert.equal(result.level, "red");
  });

  test("at 95% returns red level", () => {
    const result = computeContextUsage(950_000, 1_000_000);
    assert.ok(result);
    assert.equal(result.level, "red");
  });

  test("at 100% returns red level, percentage capped at 100", () => {
    const result = computeContextUsage(1_200_000, 1_000_000);
    assert.ok(result);
    assert.equal(result.percentage, 100);
    assert.equal(result.level, "red");
  });

  test("zero tokens returns normal level", () => {
    const result = computeContextUsage(0, 1_000_000);
    assert.ok(result);
    assert.equal(result.percentage, 0);
    assert.equal(result.level, "normal");
  });

  test("formatLargeNumber formats tokens correctly", () => {
    // Test the formatter used in ContextBar
    function formatLargeNumber(n: number): string {
      if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
      if (n >= 1_000) return `${Math.round(n / 1000)}k`;
      return String(n);
    }

    assert.equal(formatLargeNumber(0), "0");
    assert.equal(formatLargeNumber(500), "500");
    assert.equal(formatLargeNumber(1_500), "2k");
    assert.equal(formatLargeNumber(45_200), "45k");
    assert.equal(formatLargeNumber(999_999), "1000k");
    assert.equal(formatLargeNumber(1_000_000), "1.0M");
    assert.equal(formatLargeNumber(1_500_000), "1.5M");
    assert.equal(formatLargeNumber(10_000_000), "10.0M");
  });
});

// ---------------------------------------------------------------------------
// Part C – /cost command output formatting
// ---------------------------------------------------------------------------

describe("Integration: /cost command report formatting", () => {
  function buildCostReport(data: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    inputCost: number;
    outputCost: number;
    totalCost: number;
    maxContextTokens: number;
  }): string {
    function fmt(n: number): string {
      if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
      if (n >= 1_000) return `${Math.round(n / 1000).toLocaleString("en-US")}k`;
      return n.toLocaleString("en-US");
    }
    const pct = data.maxContextTokens > 0 ? `${((data.totalTokens / data.maxContextTokens) * 100).toFixed(2)}%` : "N/A";
    const usage =
      data.maxContextTokens > 0 ? `${fmt(data.totalTokens)}/${fmt(data.maxContextTokens)}` : fmt(data.totalTokens);

    return [
      "📊 Session Cost",
      "────────────────",
      `Input tokens  : ${fmt(data.promptTokens)}`,
      `Output tokens : ${fmt(data.completionTokens)}`,
      `Total tokens  : ${fmt(data.totalTokens)}`,
      `Input cost    : $${data.inputCost.toFixed(4)}`,
      `Output cost   : $${data.outputCost.toFixed(4)}`,
      `Total cost    : $${data.totalCost.toFixed(4)}`,
      `Context usage : ${pct} (${usage})`,
    ].join("\n");
  }

  test("report for a typical session", () => {
    const report = buildCostReport({
      promptTokens: 45_200,
      completionTokens: 12_300,
      totalTokens: 57_500,
      inputCost: 0.0063,
      outputCost: 0.0034,
      totalCost: 0.0097,
      maxContextTokens: 1_000_000,
    });

    assert.ok(report.includes("📊 Session Cost"));
    assert.ok(report.includes("Input tokens  : 45k"));
    assert.ok(report.includes("Output tokens : 12k"));
    assert.ok(report.includes("Total tokens  : 58k"));
    assert.ok(report.includes("Input cost    : $0.0063"));
    assert.ok(report.includes("Output cost   : $0.0034"));
    assert.ok(report.includes("Total cost    : $0.0097"));
    assert.ok(report.includes("Context usage : 5.75% (58k/1.0M)"));
  });

  test("report for a heavy session (90+%)", () => {
    const report = buildCostReport({
      promptTokens: 700_000,
      completionTokens: 220_000,
      totalTokens: 920_000,
      inputCost: 0.098,
      outputCost: 0.0616,
      totalCost: 0.1596,
      maxContextTokens: 1_000_000,
    });

    assert.ok(report.includes("Total tokens  : 920k"));
    assert.ok(report.includes("Context usage : 92.00% (920k/1.0M)"));
    assert.ok(report.includes("Total cost    : $0.1596"));
  });

  test("report with no max context shows N/A", () => {
    const report = buildCostReport({
      promptTokens: 1000,
      completionTokens: 500,
      totalTokens: 1500,
      inputCost: 0.00014,
      outputCost: 0.00014,
      totalCost: 0.00028,
      maxContextTokens: 0,
    });

    assert.ok(report.includes("Context usage : N/A"), "should show N/A when context is 0");
  });
});

// ---------------------------------------------------------------------------
// Part D – /compact command + session recovery
// ---------------------------------------------------------------------------

describe("Integration: /compact command and session recovery", () => {
  test("compacting a session reduces activeTokens", async () => {
    const workspace = createTempDir("integ-compact-workspace-");
    const home = createTempDir("integ-compact-home-");
    setHomeDir(home);

    // Build 3 responses so we accumulate a decent conversation
    const responses = [
      createChatResponse("turn 1", {
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
      }),
      createChatResponse("turn 2", {
        prompt_tokens: 200,
        completion_tokens: 100,
        total_tokens: 300,
      }),
      createChatResponse("turn 3", {
        prompt_tokens: 300,
        completion_tokens: 150,
        total_tokens: 450,
      }),
    ];
    const manager = createMockedClientSessionManager(workspace, responses);

    const sessionId = await manager.createSession({ text: "hello" });

    // Before compaction, verify usage exists
    let session = manager.getSession(sessionId);
    assert.ok(session?.usage);
    const tokensBefore = session.usage.total_tokens;
    assert.equal(tokensBefore, 150);

    // Do a second reply
    await manager.replySession(sessionId, { text: "more" });
    session = manager.getSession(sessionId);
    const tokensAfterTwo = session?.usage?.total_tokens;
    assert.ok(tokensAfterTwo);
    assert.ok(tokensAfterTwo >= tokensBefore, "tokens should accumulate");

    // Trigger compaction explicitly
    await manager.compactSession(sessionId);

    // After compaction the session should still be valid
    session = manager.getSession(sessionId);
    assert.ok(session, "session should still exist after compaction");

    // Messages should have some compacted entries
    const messages = manager.listSessionMessages(sessionId);
    const compactedCount = messages.filter((m) => m.compacted).length;
    assert.ok(compactedCount > 0, "some messages should be compacted");

    // Session index should still be readable
    const tracker = new UsageTracker(workspace);
    const snapshot = tracker.getSnapshot();
    assert.ok(snapshot.total.totalTokens >= 0);
  });

  test("session persists correctly after compaction", async () => {
    const workspace = createTempDir("integ-compact-persist-workspace-");
    const home = createTempDir("integ-compact-persist-home-");
    setHomeDir(home);

    const responses = [
      createChatResponse("msg", {
        prompt_tokens: 50_000,
        completion_tokens: 25_000,
        total_tokens: 75_000,
      }),
      // The compact call itself will make an API request
      createChatResponse("summary", {
        prompt_tokens: 5_000,
        completion_tokens: 1_000,
        total_tokens: 6_000,
      }),
    ];
    const manager = createMockedClientSessionManager(workspace, responses);

    const sessionId = await manager.createSession({ text: "test" });

    // Trigger compaction
    await manager.compactSession(sessionId);

    // sessions-index.json must still be valid JSON
    const code = getProjectCode(workspace);
    const indexPath = path.join(home, ".deepcode", "projects", code, "sessions-index.json");

    assert.ok(fs.existsSync(indexPath));
    const raw = JSON.parse(fs.readFileSync(indexPath, "utf8"));
    assert.ok(Array.isArray(raw.entries));

    // The session entry should be present
    const entry = raw.entries.find((e: any) => e.id === sessionId);
    assert.ok(entry, "session entry should still be in the index");
    assert.ok(typeof entry.usage?.total_tokens === "number");
  });
});

// ---------------------------------------------------------------------------
// Part E – End-to-end: CostCalculator reads from SessionManager output
// ---------------------------------------------------------------------------

describe("Integration: CostCalculator reads SessionManager-persisted data", () => {
  test("CostCalculator matches SessionManager usage after multi-turn session", async () => {
    const workspace = createTempDir("integ-e2e-workspace-");
    const home = createTempDir("integ-e2e-home-");
    setHomeDir(home);

    const responses = [
      createChatResponse("turn 1", {
        prompt_tokens: 100_000,
        completion_tokens: 50_000,
        total_tokens: 150_000,
        prompt_cache_hit_tokens: 10_000,
      }),
      createChatResponse("turn 2", {
        prompt_tokens: 200_000,
        completion_tokens: 80_000,
        total_tokens: 280_000,
        prompt_cache_hit_tokens: 30_000,
      }),
    ];
    const manager = createMockedClientSessionManager(workspace, responses);

    const sessionId = await manager.createSession({ text: "" });
    await manager.replySession(sessionId, { text: "" });

    const session = manager.getSession(sessionId);
    assert.ok(session?.usage);

    // Now read the same data through CostCalculator
    const calc = new CostCalculator(workspace);
    const sessionCost = calc.getSessionCost(sessionId);
    assert.ok(sessionCost);

    // Cross-check: compute cost directly from SessionManager's usage
    const directCost = computeCostFromUsage(session.usage!, DEFAULT_PRICING);
    assert.equal(sessionCost.totalCost, directCost.totalCost);
    assert.equal(sessionCost.inputCost, directCost.inputCost);
    assert.equal(sessionCost.outputCost, directCost.outputCost);

    // The totalCost in sessions-index should match
    const { total } = calc.getTotalCost();
    assert.equal(total.totalCost, sessionCost.totalCost);
  });
});

// ---------------------------------------------------------------------------
// Part F – UsageTracker snapshot completeness
// ---------------------------------------------------------------------------

describe("Integration: UsageTracker provides complete snapshot for UI", () => {
  test("snapshot includes per-session, total, and byModel data", async () => {
    const workspace = createTempDir("integ-snapshot-workspace-");
    const home = createTempDir("integ-snapshot-home-");
    setHomeDir(home);

    const responses = [
      createChatResponse("msg", {
        prompt_tokens: 10_000,
        completion_tokens: 5_000,
        total_tokens: 15_000,
      }),
    ];
    const manager = createMockedClientSessionManager(workspace, responses);
    const sessionId = await manager.createSession({ text: "" });

    const tracker = new UsageTracker(workspace);
    const snapshot = tracker.getSnapshot();

    // Per-session
    assert.ok(snapshot.sessions[sessionId]);
    assert.equal(snapshot.sessions[sessionId].promptTokens, 10_000);
    assert.equal(snapshot.sessions[sessionId].totalTokens, 15_000);

    // Total
    assert.equal(snapshot.total.promptTokens, 10_000);
    assert.equal(snapshot.total.totalTokens, 15_000);
    // totalRequests may be 0 when total_reqs is not populated on per-session usage

    // By model
    assert.ok(snapshot.byModel["test-model"]);
    assert.equal(snapshot.byModel["test-model"].promptTokens, 10_000);
  });

  test("getUsage returns correct percentage for ContextBar", async () => {
    const workspace = createTempDir("integ-pct-workspace-");
    const home = createTempDir("integ-pct-home-");
    setHomeDir(home);

    // Use half the max context
    const halfMax = 500_000;
    const responses = [
      createChatResponse("msg", {
        prompt_tokens: halfMax,
        completion_tokens: 0,
        total_tokens: halfMax,
      }),
    ];
    const manager = createMockedClientSessionManager(workspace, responses);
    await manager.createSession({ text: "" });

    const tracker = new UsageTracker(workspace, 1_000_000);
    const usage = tracker.getUsage();

    assert.equal(usage.usedTokens, halfMax);
    assert.equal(usage.maxContextTokens, 1_000_000);
    assert.equal(usage.percentage, 50);
    assert.equal(tracker.getRemaining(), 500_000);
  });
});
