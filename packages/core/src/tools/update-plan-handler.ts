import { z } from "zod";
import type { ToolExecutionContext, ToolExecutionResult } from "./executor";
import { executeValidatedTool } from "../common/validate";

const updatePlanSchema = z.strictObject({
  plan: z.string().trim().min(1, "plan must not be empty."),
  explanation: z.string().trim().optional(),
});

export async function handleUpdatePlanTool(
  args: Record<string, unknown>,
  _context: ToolExecutionContext
): Promise<ToolExecutionResult> {
  return executeValidatedTool("UpdatePlan", updatePlanSchema, args, _context, async (input) => ({
    ok: true,
    name: "UpdatePlan",
    output: "Plan updated.",
    metadata: {
      plan: input.plan,
      ...(input.explanation ? { explanation: input.explanation } : {}),
    },
  }));
}
