import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { ToolExecutor } from "../tools/executor";
import { getTools, getRuntimeContext, type ToolDefinition } from "../prompt";
import { buildThinkingRequestOptions } from "./openai-thinking";
import type { CreateOpenAIClient } from "./tool-types";

export type SubAgentTask = {
  description: string;
  tools?: string[]; // allowed tool names (default: ["read", "bash"])
  context?: string; // additional system prompt context
  maxIterations?: number; // default 12
  timeoutMs?: number; // default 120000
};

export type SubAgentResult = {
  taskIndex: number;
  ok: boolean;
  summary: string;
  filesRead: string[];
  filesModified: string[];
  errors: string[];
  iterations: number;
  tokensUsed: number;
  durationMs: number;
};

type SubAgentRunOptions = {
  projectRoot: string;
  createOpenAIClient: CreateOpenAIClient;
  toolExecutor: ToolExecutor;
  signal?: AbortSignal;
};

const DEFAULT_TOOLS = ["read", "bash"];
const DEFAULT_MAX_ITERATIONS = 12;
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TOOL_OUTPUT_LENGTH = 6000;

function buildSubAgentSystemPrompt(task: SubAgentTask, projectRoot: string): string {
  return `You are a specialized sub-agent. Execute the following task and report back.

## Task
${task.description}

## Rules
1. **Focus only on this task** — do NOT modify files unrelated to the task.
2. **Read before edit** — always read a file before editing or writing to it.
3. **Minimal changes** — make the smallest change that satisfies the task.
4. **Report results** — after completing the task, provide a clear summary of what you did, which files you read, and which files you modified.
5. **No conversation** — do not ask questions. If something is unclear, make your best guess and proceed.
6. **Stop after completing** — do not continue beyond this task.${task.context ? `\n\n## Additional Context\n${task.context}` : ""}

${getRuntimeContext(projectRoot)}`;
}

export class SubAgentRunner {
  constructor() {}

  async runTasks(tasks: SubAgentTask[], options: SubAgentRunOptions): Promise<SubAgentResult[]> {
    return Promise.all(tasks.map((task, index) => this.runSingleTask(index, task, options)));
  }

  private async runSingleTask(
    taskIndex: number,
    task: SubAgentTask,
    options: SubAgentRunOptions
  ): Promise<SubAgentResult> {
    const startedAt = Date.now();
    const filesRead = new Set<string>();
    const filesModified = new Set<string>();
    const errors: string[] = [];
    let tokensUsed = 0;
    let iterations = 0;

    const { createOpenAIClient, toolExecutor, projectRoot, signal } = options;
    const { client, model, baseURL, temperature, thinkingEnabled, reasoningEffort } = createOpenAIClient();

    if (!client) {
      return {
        taskIndex,
        ok: false,
        summary: "API client not available.",
        filesRead: [],
        filesModified: [],
        errors: ["No API client configured"],
        iterations: 0,
        tokensUsed: 0,
        durationMs: Date.now() - startedAt,
      };
    }

    const maxIterations = task.maxIterations ?? DEFAULT_MAX_ITERATIONS;
    const timeoutMs = task.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const allowedTools = task.tools ?? DEFAULT_TOOLS;

    // Build initial messages
    const systemPrompt = buildSubAgentSystemPrompt(task, projectRoot);
    const messages: ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: task.description },
    ];

    // Get only the allowed tool definitions
    const allTools = getTools({ model, webSearchEnabled: true });
    const filteredTools = allTools.filter((t) => allowedTools.includes(t.function.name));

    try {
      for (iterations = 0; iterations < maxIterations; iterations++) {
        if (signal?.aborted) {
          errors.push("Aborted");
          break;
        }

        if (Date.now() - startedAt > timeoutMs) {
          errors.push(`Timed out after ${timeoutMs}ms`);
          break;
        }

        const thinkingOptions = buildThinkingRequestOptions(thinkingEnabled, baseURL, reasoningEffort);
        const response = await this.createChatCompletion(
          client,
          model,
          messages,
          filteredTools,
          thinkingOptions,
          temperature,
          signal
        );

        if (!response) {
          errors.push("No response from LLM");
          break;
        }

        const choice = response.choices?.[0]?.message;
        if (!choice) {
          break;
        }

        const content = typeof choice.content === "string" ? choice.content : "";
        const toolCalls = (choice as { tool_calls?: unknown[] }).tool_calls;

        if (response.usage) {
          tokensUsed += (response.usage as { total_tokens?: number }).total_tokens ?? 0;
        }

        // Append assistant message
        messages.push({
          role: "assistant",
          content: content || null,
          tool_calls: toolCalls,
        } as ChatCompletionMessageParam);

        if (!toolCalls || toolCalls.length === 0) {
          // No more tool calls — task complete
          break;
        }

        // Execute tool calls via the sub-agent's own ToolExecutor
        const parsedCalls = toolCalls
          .map((tc) => this.parseForToolExecutor(tc))
          .filter((tc): tc is { id: string; type: "function"; function: { name: string; arguments: string } } =>
            Boolean(tc)
          );

        const executions = await toolExecutor.executeToolCalls(`subagent-${taskIndex}`, parsedCalls, {
          shouldStop: () => signal?.aborted ?? false,
        });

        // Process results
        for (const execution of executions) {
          const result = execution.result;
          const toolMeta = result.metadata;

          // Track files
          if (result.name === "read" && toolMeta?.snippet) {
            const fp = (toolMeta.snippet as { filePath?: string }).filePath;
            if (fp) filesRead.add(fp);
          }
          if (result.name === "write" || result.name === "edit") {
            const fp = toolMeta?.file_path;
            if (typeof fp === "string") filesModified.add(fp);
            if (typeof fp === "string") filesRead.add(fp); // also count as read
          }

          if (!result.ok && result.error) {
            errors.push(`[${result.name}] ${result.error.slice(0, 300)}`);
          }

          // Append tool result (truncated)
          const output =
            execution.content.length > MAX_TOOL_OUTPUT_LENGTH
              ? execution.content.slice(0, MAX_TOOL_OUTPUT_LENGTH) +
                `\n... (truncated ${execution.content.length} chars)`
              : execution.content;

          messages.push({
            role: "tool",
            content: output,
            tool_call_id: execution.toolCallId,
          } as ChatCompletionMessageParam);
        }
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }

    // Build summary
    const summaryParts: string[] = [];

    if (filesRead.size > 0) {
      summaryParts.push(`Files read: ${[...filesRead].join(", ")}`);
    }
    if (filesModified.size > 0) {
      summaryParts.push(`Files modified: ${[...filesModified].join(", ")}`);
    }
    if (errors.length > 0) {
      summaryParts.push(`Errors: ${errors.join("; ")}`);
    }

    const lastAssistantMsg = [...messages].reverse().find((m) => m.role === "assistant");
    const lastContent = typeof lastAssistantMsg?.content === "string" ? lastAssistantMsg.content : "";
    const summary = lastContent.slice(0, 500) || summaryParts.join(". ") || "Task completed.";

    return {
      taskIndex,
      ok: errors.length === 0,
      summary,
      filesRead: [...filesRead],
      filesModified: [...filesModified],
      errors,
      iterations,
      tokensUsed,
      durationMs: Date.now() - startedAt,
    };
  }

  private async createChatCompletion(
    client: NonNullable<ReturnType<CreateOpenAIClient>["client"]>,
    model: string,
    messages: ChatCompletionMessageParam[],
    tools: ToolDefinition[],
    thinkingOptions: Record<string, unknown>,
    temperature: number | undefined,
    signal?: AbortSignal
  ): Promise<{
    choices?: Array<{ message?: { content?: string | null; tool_calls?: unknown[] } }>;
    usage?: unknown;
  } | null> {
    try {
      const response = await client.chat.completions.create(
        {
          model,
          messages,
          tools: tools.length > 0 ? tools : undefined,
          ...(temperature !== undefined ? { temperature } : {}),
          ...thinkingOptions,
        },
        { signal }
      );
      return response as unknown as {
        choices?: Array<{ message?: { content?: string | null; tool_calls?: unknown[] } }>;
        usage?: unknown;
      };
    } catch (error) {
      if ((error as { name?: string }).name === "AbortError") {
        return null;
      }
      throw error;
    }
  }

  private parseForToolExecutor(
    toolCall: unknown
  ): { id: string; type: "function"; function: { name: string; arguments: string } } | null {
    if (!toolCall || typeof toolCall !== "object") return null;
    const tc = toolCall as { id?: unknown; type?: unknown; function?: { name?: unknown; arguments?: unknown } };
    if (typeof tc.id !== "string") return null;
    if (!tc.function || typeof tc.function !== "object") return null;
    if (typeof tc.function.name !== "string") return null;
    return {
      id: tc.id,
      type: "function",
      function: {
        name: tc.function.name,
        arguments: typeof tc.function.arguments === "string" ? tc.function.arguments : "",
      },
    };
  }
}
