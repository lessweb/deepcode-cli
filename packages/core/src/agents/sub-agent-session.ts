import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { AgentManifest } from "./agent-registry";
import type { CreateOpenAIClient } from "../common/tool-types";
import type { ToolExecutor } from "../tools/executor";
import { getTools } from "../prompt";

/**
 * Sub-agent 执行进度事件
 *
 * Note: `toolInput` / `output` carry the full, untruncated content. Callers
 * that only need a short label for a status line (e.g. the CLI's spinner
 * text) are responsible for truncating themselves. This keeps the full
 * fidelity available for callers that need to persist a durable history
 * of what the sub-agent actually did (e.g. session transcript storage).
 */
export type SubAgentProgressEvent =
  | { type: "start"; agentName: string; model: string }
  | { type: "thinking"; agentName: string }
  | { type: "tool_call"; agentName: string; toolCallId: string; toolName: string; toolInput: string }
  | {
      type: "tool_result";
      agentName: string;
      toolCallId: string;
      toolName: string;
      toolInput: string;
      output: string;
      ok: boolean;
    }
  | { type: "model_fallback"; agentName: string; fromModel: string; toModel: string }
  | { type: "complete"; agentName: string; response: string }
  | { type: "error"; agentName: string; message: string };

export type SubAgentProgressCallback = (event: SubAgentProgressEvent) => void;

export type SubAgentOptions = {
  manifest: AgentManifest;
  task: string;
  projectRoot: string;
  parentModel: string;
  createOpenAIClient: CreateOpenAIClient;
  resolvedSkillPrompts: string[];
  toolExecutor: ToolExecutor;
  /** 进度回调，用于实时通知 UI 层 sub-agent 执行状态 */
  onProgress?: SubAgentProgressCallback;
  /** 单次 API 调用超时（毫秒），默认 120000 (2分钟) */
  apiTimeout?: number;
};

export type SubAgentResult = {
  ok: boolean;
  response: string;
  error?: string;
};

const MAX_TOOL_ROUNDS = 50;
const DEFAULT_API_TIMEOUT = 120_000; // 2 minutes

export const SUB_AGENT_NON_INTERACTIVE_NOTE = `## Execution Context

You are running as a sub-agent in a single, non-interactive turn. You do NOT have access to an AskUserQuestion tool and cannot pause to ask the user clarifying questions mid-task. If required information is missing or ambiguous:
- Make the most reasonable assumption based on the task description and available context, clearly stating the assumption you made in your final response, OR
- If you truly cannot proceed safely without more information, do not attempt any side-effecting actions (e.g. do not deploy, do not modify files) — instead, end your response by clearly listing the specific questions you need answered, so the user can provide that information in a follow-up request.

Do not attempt to call a tool that asks the user a question — no such tool is available to you in this context.`;

export class SubAgentSession {
  private readonly options: SubAgentOptions;

  constructor(options: SubAgentOptions) {
    this.options = options;
  }

  /**
   * Returns the effective model for this sub-agent.
   * Uses manifest model unless it's "default" or empty.
   */
  getModel(): string {
    const { manifest, parentModel } = this.options;
    if (!manifest.model || manifest.model === "default") {
      return parentModel;
    }
    return manifest.model;
  }

  /**
   * Builds the system prompt from manifest instructions + resolved skills.
   */
  buildSystemPrompt(): string {
    const parts: string[] = [];
    if (this.options.manifest.instructions) {
      parts.push(this.options.manifest.instructions);
    }
    for (const skillPrompt of this.options.resolvedSkillPrompts) {
      parts.push(skillPrompt);
    }
    parts.push(SUB_AGENT_NON_INTERACTIVE_NOTE);
    return parts.join("\n\n");
  }

  private emit(event: SubAgentProgressEvent): void {
    this.options.onProgress?.(event);
  }

  /**
   * Execute the sub-agent's task in an isolated LLM loop.
   * Creates fresh message history, runs tool loop, returns final response.
   */
  async execute(signal?: AbortSignal): Promise<SubAgentResult> {
    const agentName = this.options.manifest.name;
    try {
      const model = this.getModel();
      const systemPrompt = this.buildSystemPrompt();

      if (!systemPrompt) {
        return {
          ok: false,
          response: "",
          error: "Sub-agent has no instructions (empty system prompt)",
        };
      }

      this.emit({ type: "start", agentName, model });

      try {
        const response = await this.runIsolatedLoop(model, systemPrompt, signal);
        this.emit({ type: "complete", agentName, response });
        return { ok: true, response };
      } catch (error) {
        // 如果模型不支持（400 错误），自动回退到父模型重试
        const message = error instanceof Error ? error.message : String(error);
        const { parentModel } = this.options;
        if (message.includes("400") && model !== parentModel) {
          this.emit({ type: "model_fallback", agentName, fromModel: model, toModel: parentModel });
          const response = await this.runIsolatedLoop(parentModel, systemPrompt, signal);
          this.emit({ type: "complete", agentName, response });
          return { ok: true, response };
        }
        throw error;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emit({ type: "error", agentName, message });
      return { ok: false, response: "", error: `Sub-agent execution failed: ${message}` };
    }
  }

  private async runIsolatedLoop(model: string, systemPrompt: string, signal?: AbortSignal): Promise<string> {
    const { createOpenAIClient, task, toolExecutor } = this.options;
    const agentName = this.options.manifest.name;
    const apiTimeout = this.options.apiTimeout ?? DEFAULT_API_TIMEOUT;

    const { client } = createOpenAIClient();
    if (!client) {
      throw new Error("Failed to create OpenAI client for sub-agent");
    }

    // Fresh message history — completely isolated from parent
    const messages: ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: task },
    ];

    // Get tool definitions (the same built-in tools), excluding AskUserQuestion:
    // sub-agent sessions are single-shot and non-interactive, so there is no
    // mechanism to pause and route a question to a real user for an answer.
    const tools = getTools().filter((tool) => tool.function.name !== "AskUserQuestion");

    // Generate a unique session ID for tool execution isolation
    const sessionId = `sub-agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      if (signal?.aborted) {
        throw new Error("Sub-agent execution was aborted");
      }

      this.emit({ type: "thinking", agentName });

      // 创建带超时的 AbortSignal
      const timeoutController = new AbortController();
      const timeoutId = setTimeout(() => timeoutController.abort(), apiTimeout);
      const mergedSignal = signal ? combineSignals(signal, timeoutController.signal) : timeoutController.signal;

      let response: {
        choices?: Array<{
          message?: {
            role?: string;
            content?: string | null;
            tool_calls?: Array<{
              id: string;
              type: "function";
              function: { name: string; arguments: string };
            }>;
          };
          finish_reason?: string;
        }>;
      };

      try {
        response = await (
          client.chat.completions.create as unknown as (
            body: Record<string, unknown>,
            options?: Record<string, unknown>
          ) => Promise<typeof response>
        )(
          {
            model,
            messages,
            tools: tools.length > 0 ? tools : undefined,
            stream: false,
          },
          { signal: mergedSignal }
        );
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") {
          if (signal?.aborted) {
            throw new Error("Sub-agent execution was aborted");
          }
          throw new Error(`Sub-agent API call timed out after ${apiTimeout / 1000}s`);
        }
        throw err;
      } finally {
        clearTimeout(timeoutId);
      }

      const choice = response?.choices?.[0];
      if (!choice?.message) {
        throw new Error("No response from LLM");
      }

      const assistantMessage = choice.message;
      const toolCalls = assistantMessage.tool_calls;

      // Append the assistant message to conversation history
      messages.push(assistantMessage as ChatCompletionMessageParam);

      // If no tool calls, the assistant is done — return its text content
      if (!toolCalls || toolCalls.length === 0) {
        return assistantMessage.content ?? "";
      }

      // Execute each tool call and append results
      for (const toolCall of toolCalls) {
        this.emit({
          type: "tool_call",
          agentName,
          toolCallId: toolCall.id,
          toolName: toolCall.function.name,
          toolInput: toolCall.function.arguments,
        });
      }

      const executions = await toolExecutor.executeToolCalls(sessionId, toolCalls);

      for (const execution of executions) {
        const toolCall = toolCalls.find((tc) => tc.id === execution.toolCallId);
        const toolName = toolCall?.function.name ?? "unknown";
        this.emit({
          type: "tool_result",
          agentName,
          toolCallId: execution.toolCallId,
          toolName,
          toolInput: toolCall?.function.arguments ?? "",
          output: execution.content,
          ok: execution.result.ok,
        });

        messages.push({
          role: "tool",
          tool_call_id: execution.toolCallId,
          content: execution.content,
        } as ChatCompletionMessageParam);
      }
    }

    throw new Error(`Sub-agent exceeded maximum tool call rounds (${MAX_TOOL_ROUNDS})`);
  }
}

/**
 * 合并多个 AbortSignal
 */
function combineSignals(...signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      return controller.signal;
    }
    signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
  }
  return controller.signal;
}
