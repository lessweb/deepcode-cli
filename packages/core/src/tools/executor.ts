import { handleAskUserQuestionTool } from "./ask-user-question-handler";
import { handleBashTool } from "./bash-handler";
import { handleDelegateTool } from "./delegate-handler";
import { handleEditTool } from "./edit-handler";
import { handleReadTool } from "./read-handler";
import { handleRecallTool } from "./recall-handler";
import { handleUpdatePlanTool } from "./update-plan-handler";
import { handleWebSearchTool } from "./web-search-handler";
import { handleWriteTool } from "./write-handler";
import type { McpManager } from "../mcp/mcp-manager";
import type { ContextManager } from "../common/context-manager";
import type { TaskPlanManager } from "../common/task-plan-manager";
import type { HooksManager, HookPhase } from "../common/hooks-manager";
import type { ShellSessionManager } from "../common/shell-sessions";
import type {
  CreateOpenAIClient,
  ToolCall,
  ToolExecutionHooks,
  ToolExecutionResult,
  ToolHandler,
  ToolCallExecution,
} from "../common/tool-types";

export type {
  CreateOpenAIClient,
  ToolCall,
  ToolExecutionContext,
  ToolExecutionHooks,
  ToolExecutionResult,
  ToolHandler,
  ToolCallExecution,
  ProcessTimeoutInfo,
  ProcessTimeoutControl,
  BackgroundProcessCompletion,
  ToolExecutionFollowUpMessage,
} from "../common/tool-types";

const BUILT_IN_TOOL_NAME_ALIASES = new Map<string, string>([
  ["Bash", "bash"],
  ["Read", "read"],
  ["Write", "write"],
  ["Edit", "edit"],
]);

export class ToolExecutor {
  private readonly projectRoot: string;
  private readonly createOpenAIClient?: CreateOpenAIClient;
  private readonly mcpManager?: McpManager;
  private readonly taskPlanManager?: TaskPlanManager;
  private readonly contextManager?: ContextManager;
  private readonly hooksManager?: HooksManager;
  private readonly shellSessions?: ShellSessionManager;
  private readonly toolHandlers = new Map<string, ToolHandler>();

  constructor(
    projectRoot: string,
    createOpenAIClient?: CreateOpenAIClient,
    mcpManager?: McpManager,
    taskPlanManager?: TaskPlanManager,
    contextManager?: ContextManager,
    hooksManager?: HooksManager,
    shellSessions?: ShellSessionManager
  ) {
    this.projectRoot = projectRoot;
    this.createOpenAIClient = createOpenAIClient;
    this.mcpManager = mcpManager;
    this.taskPlanManager = taskPlanManager;
    this.contextManager = contextManager;
    this.hooksManager = hooksManager;
    this.shellSessions = shellSessions;
    this.registerToolHandlers();
  }

  async executeToolCalls(
    sessionId: string,
    toolCalls: unknown[],
    hooks?: ToolExecutionHooks
  ): Promise<ToolCallExecution[]> {
    const parsedCalls = toolCalls
      .map((toolCall) => this.parseToolCall(toolCall))
      .filter((toolCall): toolCall is ToolCall => Boolean(toolCall));

    const executions: ToolCallExecution[] = [];
    for (const toolCall of parsedCalls) {
      if (hooks?.shouldStop?.()) {
        break;
      }
      const result = await this.executeToolCall(sessionId, toolCall, hooks);
      executions.push({
        toolCallId: toolCall.id,
        content: this.formatToolResult(result),
        result,
      });
      if (hooks?.shouldStop?.()) {
        break;
      }
    }
    return executions;
  }

  private registerToolHandlers(): void {
    this.toolHandlers.set("bash", handleBashTool);
    this.toolHandlers.set("read", handleReadTool);
    this.toolHandlers.set("write", handleWriteTool);
    this.toolHandlers.set("edit", handleEditTool);
    this.toolHandlers.set("AskUserQuestion", handleAskUserQuestionTool);
    this.toolHandlers.set("UpdatePlan", handleUpdatePlanTool);
    this.toolHandlers.set("Recall", handleRecallTool);
    this.toolHandlers.set("Delegate", handleDelegateTool);
    this.toolHandlers.set("WebSearch", handleWebSearchTool);
  }

  private parseToolCall(toolCall: unknown): ToolCall | null {
    if (!toolCall || typeof toolCall !== "object") {
      return null;
    }

    const record = toolCall as {
      id?: unknown;
      type?: unknown;
      function?: { name?: unknown; arguments?: unknown };
    };

    if (typeof record.id !== "string") {
      return null;
    }

    const functionRecord = record.function;
    if (!functionRecord || typeof functionRecord !== "object") {
      return null;
    }

    if (typeof functionRecord.name !== "string") {
      return null;
    }

    const rawArguments = typeof functionRecord.arguments === "string" ? functionRecord.arguments : "";

    return {
      id: record.id,
      type: "function",
      function: {
        name: functionRecord.name,
        arguments: rawArguments,
      },
    };
  }

  private async executeToolCall(
    sessionId: string,
    toolCall: ToolCall,
    hooks?: ToolExecutionHooks
  ): Promise<ToolExecutionResult> {
    const toolName = toolCall.function.name;
    const handlerName = BUILT_IN_TOOL_NAME_ALIASES.get(toolName) ?? toolName;
    const handler = this.toolHandlers.get(handlerName);
    if (!handler) {
      if (this.mcpManager?.isMcpTool(toolName)) {
        const parsedArgs = this.parseToolArguments(toolCall.function.arguments);
        const args = parsedArgs.ok ? parsedArgs.args : {};
        return this.mcpManager.executeMcpTool(toolName, args);
      }
      return {
        ok: false,
        name: toolName,
        error: `Unknown tool: ${toolName}`,
      };
    }

    const parsedArgs = this.parseToolArguments(toolCall.function.arguments);
    if (!parsedArgs.ok) {
      return {
        ok: false,
        name: toolName,
        error: parsedArgs.error,
      };
    }

    try {
      // Pre-hook
      const prePhase = this.getPreHookPhase(handlerName);
      if (prePhase && this.hooksManager) {
        const preResult = await this.hooksManager.runPreHook(prePhase, this.projectRoot, {
          tool: handlerName,
          sessionId,
          projectRoot: this.projectRoot,
          filePath: this.extractFilePath(parsedArgs.args),
          command: this.extractCommand(handlerName, parsedArgs.args),
        });
        if (preResult.blocked) {
          return {
            ok: false,
            name: toolName,
            error: preResult.reason ?? `Blocked by ${prePhase} hook.`,
          };
        }
      }

      const result = await handler(parsedArgs.args, {
        sessionId,
        projectRoot: this.projectRoot,
        toolCall,
        createOpenAIClient: this.createOpenAIClient,
        taskPlanManager: this.taskPlanManager,
        contextManager: this.contextManager,
        onProcessStart: hooks?.onProcessStart,
        onProcessExit: hooks?.onProcessExit,
        onProcessStdout: hooks?.onProcessStdout,
        onProcessTimeoutControl: hooks?.onProcessTimeoutControl,
        onBackgroundProcessComplete: hooks?.onBackgroundProcessComplete,
        onBeforeFileMutation: hooks?.onBeforeFileMutation,
        onAfterFileMutation: hooks?.onAfterFileMutation,
      });

      // Post-hook (fire and forget, don't block)
      const postPhase = this.getPostHookPhase(handlerName);
      if (postPhase && this.hooksManager) {
        this.hooksManager.runPostHook(postPhase, this.projectRoot, {
          tool: handlerName,
          sessionId,
          projectRoot: this.projectRoot,
          filePath: this.extractFilePath(parsedArgs.args),
          command: this.extractCommand(handlerName, parsedArgs.args),
          ok: result.ok,
          error: result.error,
        });
      }

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        name: toolName,
        error: message,
      };
    }
  }

  private parseToolArguments(
    rawArguments: string
  ): { ok: true; args: Record<string, unknown> } | { ok: false; error: string } {
    if (!rawArguments) {
      return { ok: true, args: {} };
    }

    try {
      const parsed = JSON.parse(rawArguments);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { ok: false, error: "InputParseError: Tool arguments must be a JSON object." };
      }
      return { ok: true, args: parsed as Record<string, unknown> };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        error:
          `InputParseError: Failed to parse tool arguments: ${message}. ` +
          "Ensure the tool call arguments are valid JSON. Prefer Edit over Write for large existing-file changes.",
      };
    }
  }

  private formatToolResult(result: ToolExecutionResult): string {
    const payload: Record<string, unknown> = {
      ok: result.ok,
      name: result.name,
    };

    if (typeof result.output !== "undefined") {
      payload.output = result.output;
    }

    if (result.error) {
      payload.error = result.error;
    }

    if (result.metadata && Object.keys(result.metadata).length > 0) {
      payload.metadata = result.metadata;
    }

    if (result.awaitUserResponse === true) {
      payload.awaitUserResponse = true;
    }

    return JSON.stringify(payload, null, 2);
  }

  private getPreHookPhase(toolName: string): HookPhase | null {
    switch (toolName) {
      case "bash":
        return "pre-bash";
      case "read":
        return "pre-read";
      case "write":
        return "pre-write";
      case "edit":
        return "pre-edit";
      default:
        return null;
    }
  }

  private getPostHookPhase(toolName: string): HookPhase | null {
    switch (toolName) {
      case "bash":
        return "post-bash";
      case "read":
        return "post-read";
      case "write":
        return "post-write";
      case "edit":
        return "post-edit";
      default:
        return null;
    }
  }

  private extractFilePath(args: Record<string, unknown>): string | undefined {
    if (typeof args.file_path === "string") return args.file_path;
    if (typeof args.filePath === "string") return args.filePath;
    return undefined;
  }

  private extractCommand(toolName: string, args: Record<string, unknown>): string | undefined {
    if (toolName === "bash" && typeof args.command === "string") {
      return args.command.slice(0, 200);
    }
    return undefined;
  }
}
