import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { UsageTracker, DEFAULT_MAX_CONTEXT_TOKENS } from "../common/usage-tracker";
import type { SessionsIndexWithAggregates } from "../common/usage-tracker";
import { getProjectCode } from "../session";
import type { SessionEntry, ModelUsage } from "../session";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const tempDirs: string[] = [];

function setHomeDir(dir: string): void {
  process.env.HOME = dir;
  if (process.platform === "win32") {
    process.env.USERPROFILE = dir;
  }
}

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "usage-tracker-test-"));
  tempDirs.push(dir);
  return dir;
}

function makeUsage(promptTokens: number, completionTokens: number, totalReqs = 1): ModelUsage {
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
    total_reqs: totalReqs,
  };
}

function makeSessionEntry(
  id: string,
  usage: ModelUsage | null,
  usagePerModel: Record<string, ModelUsage> | null = null
): SessionEntry {
  return {
    id,
    summary: `Session ${id.slice(0, 8)}`,
    assistantReply: null,
    assistantThinking: null,
    assistantRefusal: null,
    toolCalls: null,
    status: "completed",
    failReason: null,
    usage,
    usagePerModel,
    activeTokens: 0,
    createTime: new Date().toISOString(),
    updateTime: new Date().toISOString(),
    processes: null,
  };
}

function writeSessionsIndex(
  homeDir: string,
  projectRoot: string,
  entries: SessionEntry[],
  aggregates?: {
    totalPromptTokens?: number;
    totalCompletionTokens?: number;
    totalTokens?: number;
  }
): void {
  const projectCode = getProjectCode(projectRoot);
  const projectDir = path.join(homeDir, ".deepcode", "projects", projectCode);
  fs.mkdirSync(projectDir, { recursive: true });
  const indexPath = path.join(projectDir, "sessions-index.json");
  const index: SessionsIndexWithAggregates = {
    version: 1,
    entries,
    originalPath: projectRoot,
    ...aggregates,
  };
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), "utf8");
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
// Tests
// ---------------------------------------------------------------------------

describe("UsageTracker", () => {
  test("getUsage returns zero for empty sessions index", () => {
    const homeDir = makeTempDir();
    const projectRoot = path.join(homeDir, "project");
    fs.mkdirSync(projectRoot, { recursive: true });
    setHomeDir(homeDir);

    writeSessionsIndex(homeDir, projectRoot, []);
    const tracker = new UsageTracker(projectRoot);
    const usage = tracker.getUsage();

    assert.equal(usage.usedTokens, 0);
    assert.equal(usage.maxContextTokens, DEFAULT_MAX_CONTEXT_TOKENS);
    assert.equal(usage.percentage, 0);
  });

  test("getRemaining returns full context when no tokens used", () => {
    const homeDir = makeTempDir();
    const projectRoot = path.join(homeDir, "project");
    fs.mkdirSync(projectRoot, { recursive: true });
    setHomeDir(homeDir);

    writeSessionsIndex(homeDir, projectRoot, []);
    const tracker = new UsageTracker(projectRoot);

    assert.equal(tracker.getRemaining(), DEFAULT_MAX_CONTEXT_TOKENS);
  });

  test("getTotalUsage aggregates usage across sessions", () => {
    const homeDir = makeTempDir();
    const projectRoot = path.join(homeDir, "project");
    fs.mkdirSync(projectRoot, { recursive: true });
    setHomeDir(homeDir);

    const entries = [
      makeSessionEntry("s1", makeUsage(100, 50, 1)),
      makeSessionEntry("s2", makeUsage(200, 100, 2)),
      makeSessionEntry("s3", makeUsage(300, 150, 1)),
    ];
    writeSessionsIndex(homeDir, projectRoot, entries);

    const tracker = new UsageTracker(projectRoot);
    const total = tracker.getTotalUsage();

    assert.equal(total.promptTokens, 600);
    assert.equal(total.completionTokens, 300);
    assert.equal(total.totalTokens, 900);
    assert.equal(total.totalRequests, 4);
  });

  test("getSessionUsage returns usage for a specific session", () => {
    const homeDir = makeTempDir();
    const projectRoot = path.join(homeDir, "project");
    fs.mkdirSync(projectRoot, { recursive: true });
    setHomeDir(homeDir);

    const entries = [
      makeSessionEntry("session-a", makeUsage(100, 50)),
      makeSessionEntry("session-b", makeUsage(200, 100)),
    ];
    writeSessionsIndex(homeDir, projectRoot, entries);

    const tracker = new UsageTracker(projectRoot);

    const usageA = tracker.getSessionUsage("session-a");
    assert.ok(usageA);
    assert.equal(usageA.promptTokens, 100);
    assert.equal(usageA.completionTokens, 50);

    const usageB = tracker.getSessionUsage("session-b");
    assert.ok(usageB);
    assert.equal(usageB.promptTokens, 200);
    assert.equal(usageB.completionTokens, 100);

    const usageMissing = tracker.getSessionUsage("nonexistent");
    assert.equal(usageMissing, null);
  });

  test("getUsageByModel returns per-model breakdown", () => {
    const homeDir = makeTempDir();
    const projectRoot = path.join(homeDir, "project");
    fs.mkdirSync(projectRoot, { recursive: true });
    setHomeDir(homeDir);

    const entries = [
      makeSessionEntry("s1", makeUsage(100, 50), {
        "deepseek-v4-pro": makeUsage(100, 50, 1),
      }),
      makeSessionEntry("s2", makeUsage(200, 100), {
        "deepseek-v4-pro": makeUsage(150, 75, 1),
        "deepseek-v4-flash": makeUsage(50, 25, 1),
      }),
    ];
    writeSessionsIndex(homeDir, projectRoot, entries);

    const tracker = new UsageTracker(projectRoot);
    const byModel = tracker.getUsageByModel();

    assert.ok(byModel["deepseek-v4-pro"]);
    assert.equal(byModel["deepseek-v4-pro"].promptTokens, 250);
    assert.equal(byModel["deepseek-v4-pro"].completionTokens, 125);
    assert.equal(byModel["deepseek-v4-pro"].totalRequests, 2);

    assert.ok(byModel["deepseek-v4-flash"]);
    assert.equal(byModel["deepseek-v4-flash"].promptTokens, 50);
    assert.equal(byModel["deepseek-v4-flash"].completionTokens, 25);
    assert.equal(byModel["deepseek-v4-flash"].totalRequests, 1);
  });

  test("getUsage computes correct percentage", () => {
    const homeDir = makeTempDir();
    const projectRoot = path.join(homeDir, "project");
    fs.mkdirSync(projectRoot, { recursive: true });
    setHomeDir(homeDir);

    // Use half the default max context
    const halfMax = Math.floor(DEFAULT_MAX_CONTEXT_TOKENS / 2);
    const entries = [
      makeSessionEntry("s1", {
        prompt_tokens: halfMax,
        completion_tokens: 0,
        total_tokens: halfMax,
        total_reqs: 1,
      }),
    ];
    writeSessionsIndex(homeDir, projectRoot, entries);

    const tracker = new UsageTracker(projectRoot);
    const usage = tracker.getUsage();

    assert.equal(usage.percentage, 50);
    assert.equal(usage.usedTokens, halfMax);
    assert.equal(usage.maxContextTokens, DEFAULT_MAX_CONTEXT_TOKENS);
  });

  test("getRemaining returns correct remaining tokens", () => {
    const homeDir = makeTempDir();
    const projectRoot = path.join(homeDir, "project");
    fs.mkdirSync(projectRoot, { recursive: true });
    setHomeDir(homeDir);

    const entries = [
      makeSessionEntry("s1", {
        prompt_tokens: 300_000,
        completion_tokens: 200_000,
        total_tokens: 500_000,
        total_reqs: 1,
      }),
    ];
    writeSessionsIndex(homeDir, projectRoot, entries);

    const tracker = new UsageTracker(projectRoot);
    const remaining = tracker.getRemaining();

    assert.equal(remaining, DEFAULT_MAX_CONTEXT_TOKENS - 500_000);
  });

  test("getRemaining floors at zero when over capacity", () => {
    const homeDir = makeTempDir();
    const projectRoot = path.join(homeDir, "project");
    fs.mkdirSync(projectRoot, { recursive: true });
    setHomeDir(homeDir);

    const entries = [
      makeSessionEntry("s1", {
        prompt_tokens: 800_000,
        completion_tokens: 400_000,
        total_tokens: 1_200_000,
        total_reqs: 1,
      }),
    ];
    writeSessionsIndex(homeDir, projectRoot, entries);

    const tracker = new UsageTracker(projectRoot);
    const remaining = tracker.getRemaining();

    assert.equal(remaining, 0);
  });

  test("getUsage percentage caps at 100 when over capacity", () => {
    const homeDir = makeTempDir();
    const projectRoot = path.join(homeDir, "project");
    fs.mkdirSync(projectRoot, { recursive: true });
    setHomeDir(homeDir);

    const entries = [
      makeSessionEntry("s1", {
        prompt_tokens: 800_000,
        completion_tokens: 400_000,
        total_tokens: 1_200_000,
        total_reqs: 1,
      }),
    ];
    writeSessionsIndex(homeDir, projectRoot, entries);

    const tracker = new UsageTracker(projectRoot);
    const usage = tracker.getUsage();

    assert.equal(usage.percentage, 100);
    assert.equal(usage.usedTokens, 1_200_000);
  });

  test("constructor accepts custom maxContextTokens", () => {
    const homeDir = makeTempDir();
    const projectRoot = path.join(homeDir, "project");
    fs.mkdirSync(projectRoot, { recursive: true });
    setHomeDir(homeDir);

    const customMax = 500_000;
    const entries = [
      makeSessionEntry("s1", {
        prompt_tokens: 250_000,
        completion_tokens: 0,
        total_tokens: 250_000,
        total_reqs: 1,
      }),
    ];
    writeSessionsIndex(homeDir, projectRoot, entries);

    const tracker = new UsageTracker(projectRoot, customMax);
    const usage = tracker.getUsage();

    assert.equal(usage.maxContextTokens, customMax);
    assert.equal(usage.percentage, 50);
    assert.equal(tracker.getRemaining(), 250_000);
  });

  test("getSnapshot returns complete snapshot with sessions, total, and byModel", () => {
    const homeDir = makeTempDir();
    const projectRoot = path.join(homeDir, "project");
    fs.mkdirSync(projectRoot, { recursive: true });
    setHomeDir(homeDir);

    const entries = [
      makeSessionEntry("s1", makeUsage(100, 50), {
        "model-a": makeUsage(100, 50, 1),
      }),
      makeSessionEntry("s2", makeUsage(200, 100), {
        "model-b": makeUsage(200, 100, 1),
      }),
    ];
    writeSessionsIndex(homeDir, projectRoot, entries);

    const tracker = new UsageTracker(projectRoot);
    const snapshot = tracker.getSnapshot();

    // Per-session
    assert.ok(snapshot.sessions["s1"]);
    assert.equal(snapshot.sessions["s1"].promptTokens, 100);
    assert.ok(snapshot.sessions["s2"]);
    assert.equal(snapshot.sessions["s2"].promptTokens, 200);

    // Total
    assert.equal(snapshot.total.promptTokens, 300);
    assert.equal(snapshot.total.completionTokens, 150);
    assert.equal(snapshot.total.totalTokens, 450);

    // By model
    assert.ok(snapshot.byModel["model-a"]);
    assert.equal(snapshot.byModel["model-a"].promptTokens, 100);
    assert.ok(snapshot.byModel["model-b"]);
    assert.equal(snapshot.byModel["model-b"].promptTokens, 200);
  });

  test("handles sessions with null usage gracefully", () => {
    const homeDir = makeTempDir();
    const projectRoot = path.join(homeDir, "project");
    fs.mkdirSync(projectRoot, { recursive: true });
    setHomeDir(homeDir);

    const entries = [
      makeSessionEntry("s1", null),
      makeSessionEntry("s2", makeUsage(100, 50)),
      makeSessionEntry("s3", null),
    ];
    writeSessionsIndex(homeDir, projectRoot, entries);

    const tracker = new UsageTracker(projectRoot);
    const total = tracker.getTotalUsage();

    assert.equal(total.promptTokens, 100);
    assert.equal(total.completionTokens, 50);
    assert.equal(total.totalTokens, 150);
  });

  test("handles missing sessions-index.json gracefully", () => {
    const homeDir = makeTempDir();
    const projectRoot = path.join(homeDir, "project");
    fs.mkdirSync(projectRoot, { recursive: true });
    setHomeDir(homeDir);
    // Don't write a sessions-index.json

    const tracker = new UsageTracker(projectRoot);
    const usage = tracker.getUsage();

    assert.equal(usage.usedTokens, 0);
    assert.equal(usage.percentage, 0);
    assert.equal(tracker.getRemaining(), DEFAULT_MAX_CONTEXT_TOKENS);
  });

  test("prefers top-level aggregate fields from sessions-index.json", () => {
    const homeDir = makeTempDir();
    const projectRoot = path.join(homeDir, "project");
    fs.mkdirSync(projectRoot, { recursive: true });
    setHomeDir(homeDir);

    // Write entries with individual usage, but also provide pre-computed
    // aggregates that are larger (simulating a scenario where the index was
    // updated by an external process or a newer version of the tool).
    const entries = [makeSessionEntry("s1", makeUsage(100, 50))];
    writeSessionsIndex(homeDir, projectRoot, entries, {
      totalPromptTokens: 5000,
      totalCompletionTokens: 3000,
      totalTokens: 8000,
    });

    const tracker = new UsageTracker(projectRoot);
    const total = tracker.getTotalUsage();

    // Should use the larger pre-computed value
    assert.equal(total.promptTokens, 5000);
    assert.equal(total.completionTokens, 3000);
    assert.equal(total.totalTokens, 8000);
  });

  test("handles sessions with usagePerModel but no top-level usage", () => {
    const homeDir = makeTempDir();
    const projectRoot = path.join(homeDir, "project");
    fs.mkdirSync(projectRoot, { recursive: true });
    setHomeDir(homeDir);

    const entries: SessionEntry[] = [
      {
        id: "s1",
        summary: "test",
        assistantReply: null,
        assistantThinking: null,
        assistantRefusal: null,
        toolCalls: null,
        status: "completed",
        failReason: null,
        usage: null,
        usagePerModel: {
          "deepseek-v4-pro": makeUsage(500, 250, 2),
        },
        activeTokens: 0,
        createTime: new Date().toISOString(),
        updateTime: new Date().toISOString(),
        processes: null,
      },
    ];
    writeSessionsIndex(homeDir, projectRoot, entries);

    const tracker = new UsageTracker(projectRoot);
    const byModel = tracker.getUsageByModel();

    assert.ok(byModel["deepseek-v4-pro"]);
    assert.equal(byModel["deepseek-v4-pro"].promptTokens, 500);
    assert.equal(byModel["deepseek-v4-pro"].completionTokens, 250);
    assert.equal(byModel["deepseek-v4-pro"].totalRequests, 2);

    // Total should be zero since top-level usage is null
    const total = tracker.getTotalUsage();
    assert.equal(total.promptTokens, 0);
    assert.equal(total.totalTokens, 0);
  });

  test("DEFAULT_MAX_CONTEXT_TOKENS is 1,000,000", () => {
    assert.equal(DEFAULT_MAX_CONTEXT_TOKENS, 1_000_000);
  });
});
