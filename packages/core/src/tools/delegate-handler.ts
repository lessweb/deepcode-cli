import { z } from "zod";
import type { ToolExecutionContext, ToolExecutionResult } from "./executor";
import { ToolExecutor } from "./executor";
import { executeValidatedTool } from "../common/validate";
import { SubAgentRunner } from "../common/sub-agent-runner";
import type { SubAgentTask } from "../common/sub-agent-runner";

const taskSchema = z.object({
  description: z.string().min(1),
  tools: z.array(z.string()).optional(),
  context: z.string().optional(),
  maxIterations: z.number().int().min(1).max(30).optional(),
  timeoutMs: z.number().int().min(5000).max(300000).optional(),
});

const delegateSchema = z.strictObject({
  tasks: z.array(taskSchema).min(1).max(8),
  parallel: z.boolean().default(true),
});

const MAX_SUMMARY_LENGTH = 800;

export async function handleDelegateTool(
  args: Record<string, unknown>,
  context: ToolExecutionContext
): Promise<ToolExecutionResult> {
  return executeValidatedTool("Delegate", delegateSchema, args, context, async (input) => {
    const runner = new SubAgentRunner();

    if (!context.createOpenAIClient) {
      return {
        ok: false,
        name: "Delegate",
        error: "Delegate is not available. No API client configured.",
      };
    }

    // Sub-agents get a minimal tool set (read + bash) unless task overrides.
    const subAgentToolExecutor = new ToolExecutor(context.projectRoot, context.createOpenAIClient);

    const tasks: SubAgentTask[] = input.tasks.map((t) => ({
      description: t.description,
      tools: t.tools,
      context: t.context,
      maxIterations: t.maxIterations,
      timeoutMs: t.timeoutMs,
    }));

    const startedAt = Date.now();
    let results;

    if (input.parallel) {
      results = await runner.runTasks(tasks, {
        projectRoot: context.projectRoot,
        createOpenAIClient: context.createOpenAIClient,
        toolExecutor: subAgentToolExecutor,
      });
    } else {
      // Sequential execution
      results = [];
      for (let i = 0; i < tasks.length; i++) {
        const batch = await runner.runTasks([tasks[i]], {
          projectRoot: context.projectRoot,
          createOpenAIClient: context.createOpenAIClient,
          toolExecutor: subAgentToolExecutor,
        });
        results.push(...batch);
      }
    }

    const aggregated = aggregateResults(results, startedAt);

    return {
      ok: aggregated.errors.length === 0,
      name: "Delegate",
      output: aggregated.formatted,
      metadata: {
        results: aggregated.results.map((r) => ({
          taskIndex: r.taskIndex,
          ok: r.ok,
          summary: r.summary.slice(0, MAX_SUMMARY_LENGTH),
          filesRead: r.filesRead,
          filesModified: r.filesModified,
          errors: r.errors,
          iterations: r.iterations,
          tokensUsed: r.tokensUsed,
          durationMs: r.durationMs,
        })),
        totalDurationMs: aggregated.totalDurationMs,
        totalTokensUsed: aggregated.totalTokensUsed,
      },
    };
  });
}

function aggregateResults(
  results: Array<{
    taskIndex: number;
    ok: boolean;
    summary: string;
    filesRead: string[];
    filesModified: string[];
    errors: string[];
    iterations: number;
    tokensUsed: number;
    durationMs: number;
  }>,
  startedAt: number
) {
  const totalDurationMs = Date.now() - startedAt;
  const totalTokensUsed = results.reduce((sum, r) => sum + r.tokensUsed, 0);
  const allFilesRead = new Set(results.flatMap((r) => r.filesRead));
  const allErrors = results.flatMap((r) => r.errors);

  const parts: string[] = [];
  parts.push(`## Sub-Agent Results (${results.length} task(s), ${totalDurationMs}ms, ~${totalTokensUsed} tokens)\n`);

  for (const r of results) {
    const status = r.ok ? "✓" : "✗";
    parts.push(`### Task ${r.taskIndex + 1}: ${status} (${r.iterations} iter, ${r.durationMs}ms)`);
    parts.push(`${r.summary.slice(0, MAX_SUMMARY_LENGTH)}`);

    if (r.filesRead.length > 0) {
      parts.push(`- Files read: ${r.filesRead.join(", ")}`);
    }
    if (r.filesModified.length > 0) {
      parts.push(`- Files modified: ${r.filesModified.join(", ")}`);
    }
    if (r.errors.length > 0) {
      parts.push(`- Errors: ${r.errors.join("; ")}`);
    }
    parts.push("");
  }

  // Cross-task summary
  if (allFilesRead.size > 0) {
    parts.push(`### Files touched: ${[...allFilesRead].join(", ")}`);
  }
  if (allErrors.length > 0) {
    parts.push(`### Issues: ${allErrors.slice(0, 5).join("; ")}`);
  }

  return {
    formatted: parts.join("\n"),
    results,
    totalDurationMs,
    totalTokensUsed,
    errors: allErrors,
  };
}
