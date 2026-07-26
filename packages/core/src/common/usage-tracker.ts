import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { getProjectCode } from "../session";
import type { ModelUsage, SessionEntry } from "../session";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Aggregated token counts for a single session or across sessions. */
export type UsageSummary = {
  /** Total prompt (input) tokens consumed. */
  promptTokens: number;
  /** Total completion (output) tokens consumed. */
  completionTokens: number;
  /** Sum of prompt + completion tokens. */
  totalTokens: number;
  /** Number of API requests made. */
  totalRequests: number;
};

/** Token usage relative to the model's maximum context window. */
export type UsagePercentage = {
  /** Tokens consumed so far. */
  usedTokens: number;
  /** Maximum context window size in tokens. */
  maxContextTokens: number;
  /** Percentage of max context consumed (0–100). */
  percentage: number;
};

export type UsageSnapshot = {
  /** Per-session usage summaries keyed by session id. */
  sessions: Record<string, UsageSummary>;
  /** Aggregated usage across all sessions. */
  total: UsageSummary;
  /** Usage broken down by model name. */
  byModel: Record<string, UsageSummary>;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default maximum context window size (1M tokens for DeepSeek V4 family). */
export const DEFAULT_MAX_CONTEXT_TOKENS = 1_000_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractUsageSummary(usage: ModelUsage | null | undefined): UsageSummary {
  if (!usage) {
    return { promptTokens: 0, completionTokens: 0, totalTokens: 0, totalRequests: 0 };
  }
  const promptTokens = typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : 0;
  const completionTokens = typeof usage.completion_tokens === "number" ? usage.completion_tokens : 0;
  const totalTokens = typeof usage.total_tokens === "number" ? usage.total_tokens : promptTokens + completionTokens;
  const totalRequests = typeof usage.total_reqs === "number" ? usage.total_reqs : 0;
  return { promptTokens, completionTokens, totalTokens, totalRequests };
}

function sumUsageSummaries(a: UsageSummary, b: UsageSummary): UsageSummary {
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    totalTokens: a.totalTokens + b.totalTokens,
    totalRequests: a.totalRequests + b.totalRequests,
  };
}

function mergeModelUsage(target: Record<string, UsageSummary>, model: string, summary: UsageSummary): void {
  const existing = target[model];
  target[model] = existing ? sumUsageSummaries(existing, summary) : { ...summary };
}

// ---------------------------------------------------------------------------
// UsageTracker
// ---------------------------------------------------------------------------

/**
 * Tracks aggregated token usage across all sessions for a project.
 *
 * Reads from the persisted sessions-index.json to compute cumulative
 * prompt / completion / total tokens, request counts, and per-model breakdowns.
 *
 * Usage:
 * ```ts
 * const tracker = new UsageTracker("/path/to/project");
 * const usage = tracker.getUsage();         // UsagePercentage
 * const remaining = tracker.getRemaining(); // number
 * const snapshot = tracker.getSnapshot();   // UsageSnapshot
 * ```
 */
export class UsageTracker {
  private readonly projectRoot: string;
  private readonly maxContextTokens: number;

  constructor(projectRoot: string, maxContextTokens?: number) {
    this.projectRoot = path.resolve(projectRoot);
    this.maxContextTokens =
      maxContextTokens && Number.isFinite(maxContextTokens) && maxContextTokens > 0
        ? Math.floor(maxContextTokens)
        : DEFAULT_MAX_CONTEXT_TOKENS;
  }

  // ---- Public API ----

  /**
   * Returns token usage as a percentage of the model's maximum context window.
   */
  getUsage(): UsagePercentage {
    const total = this.getTotalUsage();
    const usedTokens = total.totalTokens;
    const maxContextTokens = this.maxContextTokens;
    const percentage =
      maxContextTokens > 0 ? Math.min(100, Math.round((usedTokens / maxContextTokens) * 10000) / 100) : 0;
    return { usedTokens, maxContextTokens, percentage };
  }

  /**
   * Returns the estimated number of tokens remaining before hitting the
   * configured maximum context window.
   */
  getRemaining(): number {
    const { usedTokens } = this.getUsage();
    return Math.max(0, this.maxContextTokens - usedTokens);
  }

  /**
   * Returns aggregated usage across all sessions.
   */
  getTotalUsage(): UsageSummary {
    return this.getSnapshot().total;
  }

  /**
   * Returns usage for a specific session, or null if not found.
   */
  getSessionUsage(sessionId: string): UsageSummary | null {
    return this.getSnapshot().sessions[sessionId] ?? null;
  }

  /**
   * Returns usage broken down by model name.
   */
  getUsageByModel(): Record<string, UsageSummary> {
    return this.getSnapshot().byModel;
  }

  /**
   * Returns a complete usage snapshot including per-session, total,
   * and per-model breakdowns.
   */
  getSnapshot(): UsageSnapshot {
    const index = this.loadSessionsIndex();
    const sessions: Record<string, UsageSummary> = {};
    const byModel: Record<string, UsageSummary> = {};
    let total: UsageSummary = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      totalRequests: 0,
    };

    for (const entry of index.entries) {
      const sessionSummary = extractUsageSummary(entry.usage);
      sessions[entry.id] = sessionSummary;
      total = sumUsageSummaries(total, sessionSummary);

      // Per-model breakdown
      if (entry.usagePerModel) {
        for (const [model, modelUsage] of Object.entries(entry.usagePerModel)) {
          mergeModelUsage(byModel, model, extractUsageSummary(modelUsage));
        }
      }
    }

    // Aggregate top-level fields if present (for pre-computed values)
    if (typeof index.totalPromptTokens === "number") {
      total.promptTokens = Math.max(total.promptTokens, index.totalPromptTokens);
    }
    if (typeof index.totalCompletionTokens === "number") {
      total.completionTokens = Math.max(total.completionTokens, index.totalCompletionTokens);
    }
    if (typeof index.totalTokens === "number") {
      total.totalTokens = Math.max(total.totalTokens, index.totalTokens);
    }

    return { sessions, total, byModel };
  }

  // ---- Internal ----

  private getSessionsIndexPath(): string {
    const projectCode = getProjectCode(this.projectRoot);
    return path.join(os.homedir(), ".deepcode", "projects", projectCode, "sessions-index.json");
  }

  private loadSessionsIndex(): SessionsIndexWithAggregates {
    const indexPath = this.getSessionsIndexPath();
    if (!fs.existsSync(indexPath)) {
      return { version: 1, entries: [], originalPath: this.projectRoot };
    }
    try {
      const raw = fs.readFileSync(indexPath, "utf8");
      return JSON.parse(raw) as SessionsIndexWithAggregates;
    } catch {
      return { version: 1, entries: [], originalPath: this.projectRoot };
    }
  }
}

// ---- SessionsIndex augmented type ----

/**
 * Extended sessions-index.json shape that optionally stores
 * pre-computed aggregate token counts at the top level.
 */
export type SessionsIndexWithAggregates = {
  version: number;
  entries: SessionEntry[];
  originalPath: string;
  /** Pre-computed total prompt tokens across all sessions. */
  totalPromptTokens?: number;
  /** Pre-computed total completion tokens across all sessions. */
  totalCompletionTokens?: number;
  /** Pre-computed total tokens across all sessions. */
  totalTokens?: number;
  /** Pre-computed total cost (USD) across all sessions. */
  totalCost?: number;
};
