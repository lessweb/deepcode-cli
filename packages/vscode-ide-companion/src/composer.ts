import type { PlanImplementationChoice } from "@vegamo/deepcode-core/common/plan-implementation";
export { PLAN_IMPLEMENTATION_CHOICES } from "@vegamo/deepcode-core/common/plan-implementation";
import { buildSlashCommands } from "@vegamo/deepcode-core/common/slash-commands";
import type { SlashCommandKind } from "@vegamo/deepcode-core/common/slash-commands";
import type { SkillInfo } from "@vegamo/deepcode-core";

export {
  filterSlashCommands,
  getSlashToken,
  resolveSlashSubmission,
  formatSlashCommandDescription,
  formatSlashCommandLabel,
} from "@vegamo/deepcode-core/common/slash-commands";

const supportedCommands = new Set<SlashCommandKind>([
  "skill",
  "skills",
  "plan",
  "new",
  "resume",
  "continue",
  "init",
  "fork",
  "compact",
  "undo",
]);

export function buildComposerCommands(skills: SkillInfo[]) {
  return buildSlashCommands(skills).filter((item) => supportedCommands.has(item.kind));
}

export interface PendingPlanImplementation {
  id: string;
  sessionId: string;
}

export interface ComposerDraft {
  text: string;
  planMode: boolean;
}

/** Input mode is independent of the mode used by the running request. */
export class ComposerState {
  sessionId: string | null = null;
  planMode = false;
  sessionPlanMode = false;
  pendingPlanImplementation: PendingPlanImplementation | null = null;
  private drafts: Record<string, ComposerDraft>;

  constructor(drafts: Record<string, ComposerDraft> = {}) {
    this.drafts = { ...drafts };
  }

  save(text: string): Record<string, ComposerDraft> {
    this.drafts[this.sessionId ?? "new"] = { text, planMode: this.planMode };
    return { ...this.drafts };
  }

  load(sessionId: string | null, planMode: boolean, text: string, fresh = false): string {
    this.save(text);
    this.pendingPlanImplementation = null;
    this.sessionId = sessionId;
    this.sessionPlanMode = planMode;
    const draft = fresh ? undefined : this.drafts[sessionId ?? "new"];
    this.planMode = draft?.planMode ?? planMode;
    return draft?.text ?? "";
  }

  updateSession(sessionId: string, planMode: boolean): void {
    if (this.sessionId && this.sessionId !== sessionId) return;
    if (!this.sessionId) {
      const draft = this.drafts.new;
      if (draft) this.drafts[sessionId] = draft;
      delete this.drafts.new;
    }
    this.sessionId = sessionId;
    this.sessionPlanMode = planMode;
  }

  offerPlanImplementation(pending: PendingPlanImplementation): boolean {
    if (pending.sessionId !== this.sessionId) return false;
    this.pendingPlanImplementation = pending;
    return true;
  }

  resolvePlanImplementation(choice: PlanImplementationChoice): PendingPlanImplementation | null {
    const pending = this.pendingPlanImplementation;
    if (pending) {
      this.pendingPlanImplementation = null;
      this.planMode = choice === "stay";
    }
    return pending;
  }

  requestMode(options: { planMode?: boolean; isAnswers?: boolean; continuation?: boolean } = {}): boolean {
    return options.planMode ?? (options.isAnswers || options.continuation ? this.sessionPlanMode : this.planMode);
  }
}
