import type { ReasoningEffort } from "../settings";
import type { ToolCall, ToolExecutionResult } from "../tools/executor";

// ── Public types ──────────────────────────────────────────────

export type TurnInput = {
  /** Raw tool calls from the assistant response (before execution). */
  toolCalls: ToolCall[];
  /** Execution results after tool calls completed (same order as toolCalls). */
  toolExecutions: ToolExecutionResult[];
};

// ── Internal state ───────────────────────────────────────────

type ManagerState = {
  currentEffort: ReasoningEffort;
  consecutiveFailures: number;
  consecutiveIdenticalCalls: number;
  lastFingerprint: string | null;
  turnsAtCurrentEffort: number;
  cleanTurnStreak: number;
  downgradeCooldownRemaining: number;
  downgradeThreshold: number;
  escalateCooldownRemaining: number;
};

// ── Constants ─────────────────────────────────────────────────

const FAILURE_ESCALATION_THRESHOLD = 2;
/**
 * Number of consecutive identical tool calls required to trigger escalation.
 * Per spec: "≥3 consecutive tool calls with identical (name, arguments) pairs".
 */
const REPETITION_ESCALATION_THRESHOLD = 3;
const DEFAULT_DOWNGRADE_THRESHOLD = 5;
const DOWNGRADE_COOLDOWN_TURNS = 3;
const ESCALATE_COOLDOWN_TURNS = 2;

// ── Manager ───────────────────────────────────────────────────

export class RuntimeReasoningEffortManager {
  private state: ManagerState;

  constructor() {
    this.state = {
      currentEffort: "high",
      consecutiveFailures: 0,
      consecutiveIdenticalCalls: 0,
      lastFingerprint: null,
      turnsAtCurrentEffort: 0,
      cleanTurnStreak: 0,
      downgradeCooldownRemaining: 0,
      downgradeThreshold: DEFAULT_DOWNGRADE_THRESHOLD,
      escalateCooldownRemaining: 0,
    };
  }

  static computeFingerprint(toolCalls: ToolCall[]): string {
    const normalized = toolCalls.map((tc) => ({
      name: tc.function.name,
      args: tc.function.arguments.replace(/\s+/g, ""),
    }));
    return JSON.stringify(normalized);
  }

  evaluate(input: TurnInput): ReasoningEffort | null {
    const fingerprint = RuntimeReasoningEffortManager.computeFingerprint(input.toolCalls);
    const allOk = input.toolExecutions.length > 0 && input.toolExecutions.every((e) => e.ok);

    this.state.turnsAtCurrentEffort += 1;

    let result: ReasoningEffort | null;
    if (this.state.currentEffort === "high") {
      result = this.evaluateEscalation(input, fingerprint, allOk);
    } else {
      result = this.evaluateDowngrade(allOk, fingerprint);
    }

    // Only decrement cooldowns when no state change occurred.
    // If escalate()/downgrade() just fired, the new cooldown was set
    // and should NOT be decremented in the same turn.
    if (result === null) {
      this.state.downgradeCooldownRemaining = Math.max(0, this.state.downgradeCooldownRemaining - 1);
      this.state.escalateCooldownRemaining = Math.max(0, this.state.escalateCooldownRemaining - 1);
    }

    return result;
  }

  getCurrentEffort(): ReasoningEffort {
    return this.state.currentEffort;
  }

  reset(): void {
    this.state = {
      currentEffort: "high",
      consecutiveFailures: 0,
      consecutiveIdenticalCalls: 0,
      lastFingerprint: null,
      turnsAtCurrentEffort: 0,
      cleanTurnStreak: 0,
      downgradeCooldownRemaining: 0,
      downgradeThreshold: DEFAULT_DOWNGRADE_THRESHOLD,
      escalateCooldownRemaining: 0,
    };
  }

  getState(): Readonly<ManagerState> {
    return { ...this.state };
  }

  // ── Private helpers ─────────────────────────────────────────

  private evaluateEscalation(_input: TurnInput, fingerprint: string, allOk: boolean): ReasoningEffort | null {
    if (this.state.escalateCooldownRemaining > 0) {
      return null;
    }

    if (!allOk) {
      this.state.consecutiveFailures += 1;
      // A failure breaks the "identical success" streak.
      this.state.consecutiveIdenticalCalls = 0;
      if (this.state.consecutiveFailures >= FAILURE_ESCALATION_THRESHOLD) {
        return this.escalate();
      }
    } else {
      this.state.consecutiveFailures = 0;
    }

    if (fingerprint === this.state.lastFingerprint && fingerprint !== null && this.state.lastFingerprint !== null) {
      this.state.consecutiveIdenticalCalls += 1;
      if (this.state.consecutiveIdenticalCalls >= REPETITION_ESCALATION_THRESHOLD) {
        return this.escalate();
      }
    } else {
      // First occurrence of this fingerprint — start the streak at 1.
      // (Per spec: escalation triggers on ≥3 identical calls; the 3rd triggers.)
      this.state.consecutiveIdenticalCalls = 1;
    }

    this.state.lastFingerprint = fingerprint;
    return null;
  }

  private evaluateDowngrade(allOk: boolean, fingerprint: string): ReasoningEffort | null {
    if (this.state.downgradeCooldownRemaining > 0) {
      this.state.lastFingerprint = fingerprint;
      return null;
    }

    if (allOk && fingerprint !== this.state.lastFingerprint) {
      this.state.cleanTurnStreak += 1;
      if (this.state.cleanTurnStreak >= this.state.downgradeThreshold) {
        return this.downgrade();
      }
    } else if (!allOk) {
      this.state.cleanTurnStreak = 0;
    }

    this.state.lastFingerprint = fingerprint;
    return null;
  }

  private escalate(): ReasoningEffort {
    this.state.currentEffort = "max";
    this.state.consecutiveFailures = 0;
    this.state.consecutiveIdenticalCalls = 0;
    this.state.cleanTurnStreak = 0;
    this.state.downgradeCooldownRemaining = DOWNGRADE_COOLDOWN_TURNS;
    this.state.turnsAtCurrentEffort = 0;
    return "max";
  }

  private downgrade(): ReasoningEffort | null {
    this.state.currentEffort = "high";
    this.state.cleanTurnStreak = 0;
    this.state.escalateCooldownRemaining = ESCALATE_COOLDOWN_TURNS;
    this.state.consecutiveFailures = 0;
    this.state.consecutiveIdenticalCalls = 0;
    this.state.turnsAtCurrentEffort = 0;
    if (this.state.downgradeThreshold === DEFAULT_DOWNGRADE_THRESHOLD) {
      this.state.downgradeThreshold = DEFAULT_DOWNGRADE_THRESHOLD * 2;
    } else {
      this.state.downgradeThreshold = DEFAULT_DOWNGRADE_THRESHOLD * 4;
    }
    return "high";
  }
}
