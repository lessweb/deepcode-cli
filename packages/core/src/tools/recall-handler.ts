import { z } from "zod";
import type { ToolExecutionContext, ToolExecutionResult } from "./executor";
import { executeValidatedTool } from "../common/validate";

const recallSchema = z.strictObject({
  query: z.string().trim().min(1, "query must not be empty."),
  category: z
    .string()
    .trim()
    .optional()
    .refine((value) => !value || ["code", "decision", "error", "fact", "all"].includes(value), {
      message: "category must be one of: code, decision, error, fact, all",
    }),
  filePath: z.string().trim().optional(),
  limit: z.number().int().min(1).max(20).default(5),
});

export async function handleRecallTool(
  args: Record<string, unknown>,
  context: ToolExecutionContext
): Promise<ToolExecutionResult> {
  return executeValidatedTool("Recall", recallSchema, args, context, async (input) => {
    const { contextManager } = context;

    if (!contextManager) {
      return {
        ok: false,
        name: "Recall",
        error: "Recall is not available. Context manager not initialized.",
      };
    }

    try {
      const result = contextManager.recall(context.sessionId, input.query, {
        category: input.category ?? "all",
        filePath: input.filePath,
        limit: input.limit,
      });

      const formatted = formatRecallResult(result);

      return {
        ok: true,
        name: "Recall",
        output: formatted,
        metadata: { result },
      };
    } catch (error) {
      return {
        ok: false,
        name: "Recall",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
}

function formatRecallResult(result: unknown): string {
  const r = result as {
    category?: string;
    entries?: Array<Record<string, unknown>>;
  };

  if (!r.entries || r.entries.length === 0) {
    return "No results found.";
  }

  const lines: string[] = [`Found ${r.entries.length} result(s) in ${r.category ?? "all"} category:\n`];

  for (let i = 0; i < r.entries.length; i++) {
    const entry = r.entries[i];
    if (entry.signature) {
      // Code entity
      lines.push(`${i + 1}. **${entry.type}** \`${entry.name}\` in \`${entry.filePath}\``);
      lines.push(`   \`\`\`\n   ${entry.signature}\n   \`\`\``);
    } else if (entry.summary) {
      // Memory fact
      lines.push(`${i + 1}. **[${entry.category}]** ${entry.summary}`);
      if (entry.detail) {
        lines.push(`   ${entry.detail}`);
      }
    }
  }

  return lines.join("\n");
}
