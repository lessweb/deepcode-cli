export type PlanImplementationChoice = "implement" | "clear-context" | "stay" | "default";

export const PLAN_IMPLEMENTATION_CHOICES: Array<{ value: PlanImplementationChoice; label: string }> = [
  { value: "implement", label: "implement this plan" },
  { value: "clear-context", label: "clear context and implement" },
  { value: "stay", label: "stay in Plan mode" },
  { value: "default", label: "switch to Default mode" },
];

const CLEAR_CONTEXT_IMPLEMENTATION_PREFIX =
  "A previous agent produced the plan below to accomplish the user's task. " +
  "Implement the plan in a fresh context. Treat the plan as the source of " +
  "user intent, re-read files as needed, and carry the work through " +
  "implementation and verification.";

/** Extract a complete, non-empty proposed plan from the final reply. */
export function extractProposedPlan(reply: string | null): string | null {
  if (!reply) {
    return null;
  }
  const match = reply.match(/<proposed_plan>\s*([\s\S]*?\S[\s\S]*?)\s*<\/proposed_plan>/);
  return match?.[1] ?? null;
}

export function getImplementationPrompt(plan: string): string {
  const fullWidthPunctuationCount = (plan.match(/[，、；。]/g) ?? []).length;
  return fullWidthPunctuationCount > 5 ? "实现此方案。" : "Implement the plan.";
}

export function getClearContextImplementationPrompt(plan: string): string {
  return `${CLEAR_CONTEXT_IMPLEMENTATION_PREFIX}\n\n${plan}`;
}

export function getCompletedProposedPlan(
  planMode: boolean,
  status: string | null | undefined,
  reply: string | null
): string | null {
  return planMode && status === "completed" ? extractProposedPlan(reply) : null;
}
