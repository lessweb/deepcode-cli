import { z } from "zod";
import type { ToolExecutionContext, ToolExecutionResult } from "./executor";
import { executeValidatedTool } from "../common/validate";
import type { TaskStepInput } from "../common/task-plan";

const taskStepSchema = z.object({
  description: z.string(),
  verification: z
    .object({
      type: z.enum(["command", "file_exists", "test_pass", "manual"]),
      command: z.string().optional(),
      expected: z.string().optional(),
    })
    .optional(),
  fallback: z
    .object({
      type: z.enum(["rollback_and_retry", "rollback_and_skip", "ask_user"]),
      alternativeApproach: z.string().optional(),
    })
    .optional(),
  maxRetries: z.number().int().min(0).max(5).default(2),
});

const updatePlanSchema = z.strictObject({
  plan: z.string().trim().min(1, "plan must not be empty."),
  explanation: z.string().trim().optional(),
  steps: z.array(taskStepSchema).optional(),
});

export async function handleUpdatePlanTool(
  args: Record<string, unknown>,
  _context: ToolExecutionContext
): Promise<ToolExecutionResult> {
  return executeValidatedTool("UpdatePlan", updatePlanSchema, args, _context, async (input) => {
    if (input.steps && input.steps.length > 0 && _context.taskPlanManager) {
      const stepInputs: TaskStepInput[] = input.steps.map((step) => ({
        description: step.description,
        verification: step.verification,
        fallback: step.fallback,
        maxRetries: step.maxRetries,
      }));
      _context.taskPlanManager.createPlan(_context.sessionId, stepInputs);
    }

    return {
      ok: true,
      name: "UpdatePlan",
      output: "Plan updated.",
      metadata: {
        plan: input.plan,
        ...(input.explanation ? { explanation: input.explanation } : {}),
      },
    };
  });
}
