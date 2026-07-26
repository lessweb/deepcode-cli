// Upstream reference: claude_code_formatted.js L1867-L1884
// OpenTelemetry-style structured metrics for observability

const DEFAULT_NEW_PROMPT_API_URL = "https://deepcode.vegamo.cn/api/plugin/new";
const DEFAULT_REPORT_TIMEOUT_MS = 3000;

export type NewPromptReportOptions = {
  enabled: boolean;
  machineId?: string;
  timeoutMs?: number;
};

export type PermissionDecisionMetrics = {
  /** Tool type: "Edit" | "Write" | "Read" | "Bash" | "NotebookEdit" */
  toolType: string;
  /** Decision: "accept" | "reject" */
  decision: "accept" | "reject";
};

export type ToolUsageMetrics = {
  /** Total cost in USD for the session */
  totalCostUSD: number;
  /** Total API duration in ms */
  totalAPIDuration: number;
  /** Lines of code added */
  totalLinesAdded: number;
  /** Lines of code removed */
  totalLinesRemoved: number;
  /** Number of tool calls made */
  totalToolCalls: number;
};

/**
 * Fire-and-forget report of a new prompt session.
 * Respects the `enabled` toggle: when disabled, the call is a no-op.
 */
export function reportNewPrompt(options: NewPromptReportOptions): void {
  if (!options.enabled || !options.machineId) {
    return;
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_REPORT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  void fetch(DEFAULT_NEW_PROMPT_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Token: options.machineId,
    },
    body: JSON.stringify({}),
    signal: controller.signal,
  })
    .catch(() => {})
    .finally(() => clearTimeout(timeout));
}

// In-memory metrics store (non-persistent, per-session)
let sessionPermissionDecisions: { accept: number; reject: number } = { accept: 0, reject: 0 };
let sessionToolUsage: ToolUsageMetrics = {
  totalCostUSD: 0,
  totalAPIDuration: 0,
  totalLinesAdded: 0,
  totalLinesRemoved: 0,
  totalToolCalls: 0,
};

/**
 * Record a permission decision (accept/reject for a tool).
 * Upstream reference: code_edit_tool.decision counter
 */
export function recordPermissionDecision(decision: PermissionDecisionMetrics): void {
  if (decision.decision === "accept") {
    sessionPermissionDecisions.accept++;
  } else {
    sessionPermissionDecisions.reject++;
  }
}

/**
 * Record tool usage metrics.
 * Upstream reference: totalToolDuration, totalCostUSD, totalLinesAdded/Removed
 */
export function recordToolUsage(metrics: Partial<ToolUsageMetrics>): void {
  if (metrics.totalCostUSD !== undefined) {
    sessionToolUsage.totalCostUSD += metrics.totalCostUSD;
  }
  if (metrics.totalAPIDuration !== undefined) {
    sessionToolUsage.totalAPIDuration += metrics.totalAPIDuration;
  }
  if (metrics.totalLinesAdded !== undefined) {
    sessionToolUsage.totalLinesAdded += metrics.totalLinesAdded;
  }
  if (metrics.totalLinesRemoved !== undefined) {
    sessionToolUsage.totalLinesRemoved += metrics.totalLinesRemoved;
  }
  if (metrics.totalToolCalls !== undefined) {
    sessionToolUsage.totalToolCalls += metrics.totalToolCalls;
  }
}

export function getSessionPermissionDecisions(): { accept: number; reject: number } {
  return { ...sessionPermissionDecisions };
}

export function getSessionToolUsage(): ToolUsageMetrics {
  return { ...sessionToolUsage };
}

/** Reset all metrics (for testing or session restart) */
export function resetSessionMetrics(): void {
  sessionPermissionDecisions = { accept: 0, reject: 0 };
  sessionToolUsage = {
    totalCostUSD: 0,
    totalAPIDuration: 0,
    totalLinesAdded: 0,
    totalLinesRemoved: 0,
    totalToolCalls: 0,
  };
}
