import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { getProjectCode } from "../session";
import type { ModelUsage } from "../session";
import type { ResolvedPricingConfig } from "../settings";
import { DEFAULT_PRICING } from "../settings";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Cost breakdown for an API request or aggregated usage. */
export type CostBreakdown = {
  /** Cost from uncached input tokens (USD). */
  inputCost: number;
  /** Cost from cached input tokens (USD). */
  inputCacheHitCost: number;
  /** Cost from output tokens (USD). */
  outputCost: number;
  /** Total cost (sum of the above). */
  totalCost: number;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TOKENS_PER_MILLION = 1_000_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute USD cost from raw token counts using the given pricing config.
 *
 * Cache-miss tokens are computed as `promptTokens - cachedPromptTokens`
 * (clamped to >= 0).  If the underlying usage carries `prompt_cache_hit_tokens`
 * and `prompt_cache_miss_tokens` fields, the caller can split them before
 * calling this function.
 */
export function computeCost(
  promptTokens: number,
  completionTokens: number,
  cachedPromptTokens: number,
  pricing: ResolvedPricingConfig
): CostBreakdown {
  const safePrompt = Math.max(0, promptTokens);
  const safeCompletion = Math.max(0, completionTokens);
  const safeCached = Math.max(0, Math.min(cachedPromptTokens, safePrompt));
  const cacheMissPrompt = safePrompt - safeCached;

  const inputCost = (cacheMissPrompt / TOKENS_PER_MILLION) * pricing.inputPerMillion;
  const inputCacheHitCost = (safeCached / TOKENS_PER_MILLION) * pricing.inputCacheHitPerMillion;
  const outputCost = (safeCompletion / TOKENS_PER_MILLION) * pricing.outputPerMillion;

  return {
    inputCost: roundUSD(inputCost),
    inputCacheHitCost: roundUSD(inputCacheHitCost),
    outputCost: roundUSD(outputCost),
    totalCost: roundUSD(inputCost + inputCacheHitCost + outputCost),
  };
}

/** Extract cost from a ModelUsage object. */
export function computeCostFromUsage(usage: ModelUsage, pricing: ResolvedPricingConfig): CostBreakdown {
  const promptTokens = typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : 0;
  const completionTokens = typeof usage.completion_tokens === "number" ? usage.completion_tokens : 0;

  // Prefer explicit cache fields when available
  const cachedPromptTokens = typeof usage.prompt_cache_hit_tokens === "number" ? usage.prompt_cache_hit_tokens : 0;

  return computeCost(promptTokens, completionTokens, cachedPromptTokens, pricing);
}

function roundUSD(value: number): number {
  // Round to 6 decimal places (microprecision) then remove trailing zeros via Number.
  return Number(Math.round(value * 1_000_000) / 1_000_000);
}

function sumCostBreakdowns(a: CostBreakdown, b: CostBreakdown): CostBreakdown {
  return {
    inputCost: roundUSD(a.inputCost + b.inputCost),
    inputCacheHitCost: roundUSD(a.inputCacheHitCost + b.inputCacheHitCost),
    outputCost: roundUSD(a.outputCost + b.outputCost),
    totalCost: roundUSD(a.totalCost + b.totalCost),
  };
}

// ---- Sessions-index shape ----

type SessionsIndexMinimal = {
  version: number;
  entries: Array<{
    id: string;
    usage: ModelUsage | null;
    usagePerModel?: Record<string, ModelUsage> | null;
  }>;
  totalCost?: number;
};

// ---------------------------------------------------------------------------
// CostCalculator
// ---------------------------------------------------------------------------

/**
 * Computes API costs based on token usage and configurable pricing.
 *
 * Usage:
 * ```ts
 * const calc = new CostCalculator("/path/to/project");
 * const cost = calc.calculateCost(15000, 5000, 2000);
 * const sessionCost = calc.getSessionCost("session-id");
 * ```
 */
export class CostCalculator {
  private readonly projectRoot: string;
  private readonly pricing: ResolvedPricingConfig;

  constructor(projectRoot: string, pricing?: Partial<ResolvedPricingConfig>) {
    this.projectRoot = path.resolve(projectRoot);
    this.pricing = {
      inputPerMillion: pricing?.inputPerMillion ?? DEFAULT_PRICING.inputPerMillion,
      inputCacheHitPerMillion: pricing?.inputCacheHitPerMillion ?? DEFAULT_PRICING.inputCacheHitPerMillion,
      outputPerMillion: pricing?.outputPerMillion ?? DEFAULT_PRICING.outputPerMillion,
    };
  }

  // ---- Public API ----

  /**
   * Calculate the cost for a single API request.
   *
   * @param promptTokens  - Total prompt (input) tokens.
   * @param completionTokens - Completion (output) tokens.
   * @param cachedTokens  - Prompt tokens served from cache (hit).
   * @returns Cost breakdown in USD.
   */
  calculateCost(promptTokens: number, completionTokens: number, cachedTokens = 0): CostBreakdown {
    return computeCost(promptTokens, completionTokens, cachedTokens, this.pricing);
  }

  /**
   * Calculate cost from a ModelUsage object (as returned by the API).
   */
  calculateCostFromUsage(usage: ModelUsage): CostBreakdown {
    return computeCostFromUsage(usage, this.pricing);
  }

  /**
   * Return the total cost for a specific session, or the aggregate cost
   * across all sessions when no sessionId is provided.
   *
   * Returns null if the session does not exist.
   */
  getSessionCost(sessionId?: string): CostBreakdown | null {
    const index = this.loadSessionsIndex();
    if (!sessionId) {
      // Aggregate across all sessions
      let total: CostBreakdown = { inputCost: 0, inputCacheHitCost: 0, outputCost: 0, totalCost: 0 };
      for (const entry of index.entries) {
        if (entry.usage) {
          total = sumCostBreakdowns(total, computeCostFromUsage(entry.usage, this.pricing));
        }
      }
      return total;
    }

    const entry = index.entries.find((e) => e.id === sessionId);
    if (!entry || !entry.usage) {
      return null;
    }
    return computeCostFromUsage(entry.usage, this.pricing);
  }

  /**
   * Get total cost across all sessions, including per-model breakdowns.
   */
  getTotalCost(): {
    total: CostBreakdown;
    byModel: Record<string, CostBreakdown>;
  } {
    const index = this.loadSessionsIndex();
    const total: CostBreakdown = { inputCost: 0, inputCacheHitCost: 0, outputCost: 0, totalCost: 0 };
    const byModel: Record<string, CostBreakdown> = {};

    for (const entry of index.entries) {
      if (entry.usage) {
        const sessionCost = computeCostFromUsage(entry.usage, this.pricing);
        total.totalCost = roundUSD(total.totalCost + sessionCost.totalCost);
        total.inputCost = roundUSD(total.inputCost + sessionCost.inputCost);
        total.inputCacheHitCost = roundUSD(total.inputCacheHitCost + sessionCost.inputCacheHitCost);
        total.outputCost = roundUSD(total.outputCost + sessionCost.outputCost);
      }

      if (entry.usagePerModel) {
        for (const [model, modelUsage] of Object.entries(entry.usagePerModel)) {
          const modelCost = computeCostFromUsage(modelUsage, this.pricing);
          const existing = byModel[model];
          byModel[model] = existing ? sumCostBreakdowns(existing, modelCost) : modelCost;
        }
      }
    }

    // Prefer the pre-computed totalCost from the index if available
    if (typeof index.totalCost === "number" && index.totalCost > total.totalCost) {
      total.totalCost = index.totalCost;
    }

    return { total, byModel };
  }

  /**
   * Return the current pricing config.
   */
  getPricing(): ResolvedPricingConfig {
    return { ...this.pricing };
  }

  // ---- Internal ----

  private getSessionsIndexPath(): string {
    const projectCode = getProjectCode(this.projectRoot);
    return path.join(os.homedir(), ".deepcode", "projects", projectCode, "sessions-index.json");
  }

  private loadSessionsIndex(): SessionsIndexMinimal {
    const indexPath = this.getSessionsIndexPath();
    if (!fs.existsSync(indexPath)) {
      return { version: 1, entries: [] };
    }
    try {
      const raw = fs.readFileSync(indexPath, "utf8");
      return JSON.parse(raw) as SessionsIndexMinimal;
    } catch {
      return { version: 1, entries: [] };
    }
  }
}
