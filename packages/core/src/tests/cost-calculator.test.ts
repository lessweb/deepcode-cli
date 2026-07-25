import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { CostCalculator, computeCost, computeCostFromUsage } from "../common/cost-calculator";
import { DEFAULT_PRICING } from "../settings";
import { getProjectCode } from "../session";
import type { ModelUsage, SessionEntry } from "../session";

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cost-calc-test-"));
  tempDirs.push(dir);
  return dir;
}

function makeUsage(overrides: Partial<ModelUsage> = {}): ModelUsage {
  return {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
    total_reqs: 1,
    ...overrides,
  };
}

function makeSessionEntry(id: string, usage: ModelUsage | null): SessionEntry {
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
    usagePerModel: null,
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
  aggregates?: { totalCost?: number }
): void {
  const projectCode = getProjectCode(projectRoot);
  const projectDir = path.join(homeDir, ".deepcode", "projects", projectCode);
  fs.mkdirSync(projectDir, { recursive: true });
  const indexPath = path.join(projectDir, "sessions-index.json");
  const index = {
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
// computeCost (pure function)
// ---------------------------------------------------------------------------

describe("computeCost", () => {
  test("zero tokens returns zero cost", () => {
    const cost = computeCost(0, 0, 0, DEFAULT_PRICING);
    assert.equal(cost.totalCost, 0);
    assert.equal(cost.inputCost, 0);
    assert.equal(cost.inputCacheHitCost, 0);
    assert.equal(cost.outputCost, 0);
  });

  test("1M prompt tokens (cache miss) costs $0.14", () => {
    const cost = computeCost(1_000_000, 0, 0, DEFAULT_PRICING);
    assert.equal(cost.totalCost, 0.14);
    assert.equal(cost.inputCost, 0.14);
    assert.equal(cost.outputCost, 0);
  });

  test("1M completion tokens costs $0.28", () => {
    const cost = computeCost(0, 1_000_000, 0, DEFAULT_PRICING);
    assert.equal(cost.totalCost, 0.28);
    assert.equal(cost.outputCost, 0.28);
    assert.equal(cost.inputCost, 0);
  });

  test("1M cached prompt tokens costs $0.0028", () => {
    const cost = computeCost(1_000_000, 0, 1_000_000, DEFAULT_PRICING);
    assert.equal(cost.totalCost, 0.0028);
    assert.equal(cost.inputCacheHitCost, 0.0028);
    assert.equal(cost.inputCost, 0);
  });

  test("mixed input: half cache hit, half miss", () => {
    // 500K cache hit + 500K cache miss = 1M total prompt
    const cost = computeCost(1_000_000, 0, 500_000, DEFAULT_PRICING);
    // miss: 500K → $0.07, hit: 500K → $0.0014
    assert.equal(cost.inputCost, 0.07);
    assert.equal(cost.inputCacheHitCost, 0.0014);
    assert.equal(cost.totalCost, 0.0714);
  });

  test("full request: 10K prompt (2K cached) + 5K completion", () => {
    const cost = computeCost(10_000, 5_000, 2_000, DEFAULT_PRICING);
    // miss: 8000/1M * 0.14 = 0.00112
    // hit:  2000/1M * 0.0028 = 0.0000056
    // out:  5000/1M * 0.28 = 0.0014
    // total = 0.00112 + 0.0000056 + 0.0014 = 0.0025256
    assert.equal(cost.inputCost, 0.00112);
    assert.equal(cost.inputCacheHitCost, 0.000006); // rounded to 6 decimals: 0.0000056 → 0.000006
    assert.equal(cost.outputCost, 0.0014);
    assert.equal(cost.totalCost, 0.002526); // 0.0025256 → 0.002526
  });

  test("cached tokens clamped to prompt tokens", () => {
    // cached > prompt → clamped to 1M
    const cost = computeCost(1_000_000, 0, 2_000_000, DEFAULT_PRICING);
    assert.equal(cost.inputCost, 0);
    assert.equal(cost.inputCacheHitCost, 0.0028);
  });

  test("negative values clamped to zero", () => {
    const cost = computeCost(-100, -200, -50, DEFAULT_PRICING);
    assert.equal(cost.totalCost, 0);
  });

  test("custom pricing overrides defaults", () => {
    const customPricing = {
      inputPerMillion: 1.0,
      inputCacheHitPerMillion: 0.1,
      outputPerMillion: 2.0,
    };
    const cost = computeCost(1_000_000, 1_000_000, 500_000, customPricing);
    // miss: 500K/1M * 1.0 = 0.5
    // hit:  500K/1M * 0.1 = 0.05
    // out:  1M/1M * 2.0 = 2.0
    // total = 2.55
    assert.equal(cost.inputCost, 0.5);
    assert.equal(cost.inputCacheHitCost, 0.05);
    assert.equal(cost.outputCost, 2.0);
    assert.equal(cost.totalCost, 2.55);
  });
});

// ---------------------------------------------------------------------------
// computeCostFromUsage
// ---------------------------------------------------------------------------

describe("computeCostFromUsage", () => {
  test("uses prompt_cache_hit_tokens when available", () => {
    const usage: ModelUsage = {
      prompt_tokens: 10_000,
      completion_tokens: 5_000,
      total_tokens: 15_000,
      prompt_cache_hit_tokens: 3_000,
      prompt_cache_miss_tokens: 7_000,
      total_reqs: 1,
    };
    const cost = computeCostFromUsage(usage, DEFAULT_PRICING);
    // miss: 7000/1M * 0.14 = 0.00098
    // hit:  3000/1M * 0.0028 = 0.000008
    assert.equal(cost.inputCost, 0.00098);
    assert.equal(cost.inputCacheHitCost, 0.000008);
    assert.equal(cost.totalCost, 0.002388);
  });

  test("treats all prompt as cache miss when no cache hit info", () => {
    const usage: ModelUsage = {
      prompt_tokens: 10_000,
      completion_tokens: 5_000,
      total_tokens: 15_000,
      total_reqs: 1,
    };
    const cost = computeCostFromUsage(usage, DEFAULT_PRICING);
    assert.equal(cost.inputCost, 0.0014);
    assert.equal(cost.inputCacheHitCost, 0);
    assert.equal(cost.outputCost, 0.0014);
  });
});

// ---------------------------------------------------------------------------
// CostCalculator class
// ---------------------------------------------------------------------------

describe("CostCalculator", () => {
  test("calculateCost with default pricing", () => {
    const homeDir = makeTempDir();
    const projectRoot = path.join(homeDir, "project");
    fs.mkdirSync(projectRoot, { recursive: true });
    setHomeDir(homeDir);

    const calc = new CostCalculator(projectRoot);
    const cost = calc.calculateCost(1_000_000, 0, 0);

    assert.equal(cost.totalCost, 0.14);
  });

  test("calculateCost respects custom pricing", () => {
    const homeDir = makeTempDir();
    const projectRoot = path.join(homeDir, "project");
    fs.mkdirSync(projectRoot, { recursive: true });
    setHomeDir(homeDir);

    const calc = new CostCalculator(projectRoot, {
      inputPerMillion: 2.0,
      outputPerMillion: 3.0,
    });
    // 1M prompt + 1M completion = 2 + 3 = 5
    const cost = calc.calculateCost(1_000_000, 1_000_000);
    assert.equal(cost.inputCost, 2.0);
    assert.equal(cost.outputCost, 3.0);
    assert.equal(cost.totalCost, 5.0);
  });

  test("calculateCostFromUsage with ModelUsage", () => {
    const homeDir = makeTempDir();
    const projectRoot = path.join(homeDir, "project");
    fs.mkdirSync(projectRoot, { recursive: true });
    setHomeDir(homeDir);

    const calc = new CostCalculator(projectRoot);
    const usage: ModelUsage = {
      prompt_tokens: 100_000,
      completion_tokens: 50_000,
      total_tokens: 150_000,
      prompt_cache_hit_tokens: 20_000,
      total_reqs: 1,
    };
    const cost = calc.calculateCostFromUsage(usage);
    // miss: 80K/1M * 0.14 = 0.0112
    // hit:  20K/1M * 0.0028 = 0.000056
    // out:  50K/1M * 0.28 = 0.014
    // total = 0.025256
    assert.equal(cost.totalCost, 0.025256);
  });

  test("getSessionCost with no sessions returns zero cost", () => {
    const homeDir = makeTempDir();
    const projectRoot = path.join(homeDir, "project");
    fs.mkdirSync(projectRoot, { recursive: true });
    setHomeDir(homeDir);
    writeSessionsIndex(homeDir, projectRoot, []);

    const calc = new CostCalculator(projectRoot);
    const cost = calc.getSessionCost(); // aggregate all

    assert.ok(cost);
    assert.equal(cost.totalCost, 0);
  });

  test("getSessionCost aggregates across multiple sessions", () => {
    const homeDir = makeTempDir();
    const projectRoot = path.join(homeDir, "project");
    fs.mkdirSync(projectRoot, { recursive: true });
    setHomeDir(homeDir);

    const entries = [
      makeSessionEntry("s1", makeUsage({ prompt_tokens: 1_000_000, completion_tokens: 0, total_tokens: 1_000_000 })),
      makeSessionEntry("s2", makeUsage({ prompt_tokens: 0, completion_tokens: 1_000_000, total_tokens: 1_000_000 })),
    ];
    writeSessionsIndex(homeDir, projectRoot, entries);

    const calc = new CostCalculator(projectRoot);
    const cost = calc.getSessionCost(); // aggregate

    assert.ok(cost);
    // s1: 0.14 input, s2: 0.28 output => total 0.42
    assert.equal(cost.totalCost, 0.42);
  });

  test("getSessionCost for a specific session", () => {
    const homeDir = makeTempDir();
    const projectRoot = path.join(homeDir, "project");
    fs.mkdirSync(projectRoot, { recursive: true });
    setHomeDir(homeDir);

    const entries = [
      makeSessionEntry("s1", makeUsage({ prompt_tokens: 1_000_000, completion_tokens: 0, total_tokens: 1_000_000 })),
      makeSessionEntry("s2", makeUsage({ prompt_tokens: 0, completion_tokens: 500_000, total_tokens: 500_000 })),
    ];
    writeSessionsIndex(homeDir, projectRoot, entries);

    const calc = new CostCalculator(projectRoot);

    const s1Cost = calc.getSessionCost("s1");
    assert.ok(s1Cost);
    assert.equal(s1Cost.totalCost, 0.14);

    const s2Cost = calc.getSessionCost("s2");
    assert.ok(s2Cost);
    assert.equal(s2Cost.totalCost, 0.14);

    const missingCost = calc.getSessionCost("nonexistent");
    assert.equal(missingCost, null);
  });

  test("getTotalCost returns total and byModel breakdown", () => {
    const homeDir = makeTempDir();
    const projectRoot = path.join(homeDir, "project");
    fs.mkdirSync(projectRoot, { recursive: true });
    setHomeDir(homeDir);

    const entries: SessionEntry[] = [
      {
        ...makeSessionEntry("s1", makeUsage({ prompt_tokens: 1_000_000, completion_tokens: 0 })),
        usagePerModel: { "model-a": makeUsage({ prompt_tokens: 1_000_000, completion_tokens: 0, total_reqs: 1 }) },
      },
      {
        ...makeSessionEntry("s2", makeUsage({ prompt_tokens: 0, completion_tokens: 1_000_000 })),
        usagePerModel: { "model-b": makeUsage({ prompt_tokens: 0, completion_tokens: 1_000_000, total_reqs: 1 }) },
      },
    ];
    writeSessionsIndex(homeDir, projectRoot, entries);

    const calc = new CostCalculator(projectRoot);
    const { total, byModel } = calc.getTotalCost();

    assert.equal(total.totalCost, 0.42);
    assert.ok(byModel["model-a"]);
    assert.equal(byModel["model-a"].totalCost, 0.14);
    assert.ok(byModel["model-b"]);
    assert.equal(byModel["model-b"].totalCost, 0.28);
  });

  test("getTotalCost prefers pre-computed totalCost", () => {
    const homeDir = makeTempDir();
    const projectRoot = path.join(homeDir, "project");
    fs.mkdirSync(projectRoot, { recursive: true });
    setHomeDir(homeDir);

    const entries = [makeSessionEntry("s1", makeUsage({ prompt_tokens: 1_000, completion_tokens: 500 }))];
    // Pre-computed value larger than what entries would produce
    writeSessionsIndex(homeDir, projectRoot, entries, { totalCost: 99.99 });

    const calc = new CostCalculator(projectRoot);
    const { total } = calc.getTotalCost();

    assert.equal(total.totalCost, 99.99);
  });

  test("getPricing returns the resolved pricing config", () => {
    const homeDir = makeTempDir();
    const projectRoot = path.join(homeDir, "project");
    fs.mkdirSync(projectRoot, { recursive: true });
    setHomeDir(homeDir);

    const calc = new CostCalculator(projectRoot, { inputPerMillion: 1.5 });
    const pricing = calc.getPricing();

    assert.equal(pricing.inputPerMillion, 1.5);
    assert.equal(pricing.inputCacheHitPerMillion, DEFAULT_PRICING.inputCacheHitPerMillion);
    assert.equal(pricing.outputPerMillion, DEFAULT_PRICING.outputPerMillion);
  });

  test("handles missing sessions-index.json gracefully", () => {
    const homeDir = makeTempDir();
    const projectRoot = path.join(homeDir, "project");
    fs.mkdirSync(projectRoot, { recursive: true });
    setHomeDir(homeDir);

    const calc = new CostCalculator(projectRoot);
    const cost = calc.getSessionCost();

    assert.ok(cost);
    assert.equal(cost.totalCost, 0);
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_PRICING validation
// ---------------------------------------------------------------------------

describe("DEFAULT_PRICING", () => {
  test("matches DeepSeek V4 official rates", () => {
    assert.equal(DEFAULT_PRICING.inputPerMillion, 0.14);
    assert.equal(DEFAULT_PRICING.inputCacheHitPerMillion, 0.0028);
    assert.equal(DEFAULT_PRICING.outputPerMillion, 0.28);

    // Cache hit should be exactly 2% of cache miss (0.0028 / 0.14 = 0.02)
    const ratio = DEFAULT_PRICING.inputCacheHitPerMillion / DEFAULT_PRICING.inputPerMillion;
    assert.ok(Math.abs(ratio - 0.02) < 1e-10, `ratio ${ratio} should be ~0.02`);

    // Output should be 2x input (0.28 / 0.14 = 2)
    const outInRatio = DEFAULT_PRICING.outputPerMillion / DEFAULT_PRICING.inputPerMillion;
    assert.equal(outInRatio, 2);
  });
});
