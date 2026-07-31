import { handleAskUserQuestionTool } from "./ask-user-question-handler";
import { handleBashTool } from "./bash-handler";
import { handleEditTool } from "./edit-handler";
import { handleReadTool } from "./read-handler";
import { handleUpdatePlanTool } from "./update-plan-handler";
import { handleWebSearchTool } from "./web-search-handler";
import { handleWriteTool } from "./write-handler";
import { compressContent } from "../context/compact";
import type { McpManager } from "../mcp/mcp-manager";
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
  private readonly toolHandlers = new Map<string, ToolHandler>();

  /** Doom loop: tracks last N tool call shapes for cycle detection */
  private readonly doomLoopBuffer = new Map<string, { name: string; args: string }[]>();

  /** Max identical consecutive tool calls before triggering doom loop protection */
  private static readonly DOOM_LOOP_THRESHOLD = 3;

  /** Max total tool calls across all iterations before forced break */
  private static readonly DOOM_LOOP_TOTAL_CAP = 50;

  constructor(projectRoot: string, createOpenAIClient?: CreateOpenAIClient, mcpManager?: McpManager) {
    this.projectRoot = projectRoot;
    this.createOpenAIClient = createOpenAIClient;
    this.mcpManager = mcpManager;
    this.registerToolHandlers();
  }

  /**
   * Reset doom loop tracking for a new session / new user prompt.
   */
  resetDoomLoopTracking(sessionId: string): void {
    this.doomLoopBuffer.set(sessionId, []);
  }

  /**
   * Check if a tool call set constitutes a doom loop.
   * Returns an error message when a loop is detected, or null if everything is fine.
   */
  checkDoomLoop(sessionId: string, toolCalls: unknown[], iteration: number): string | null {
    // Total cap check
    if (iteration >= ToolExecutor.DOOM_LOOP_TOTAL_CAP) {
      return `Doom loop detected: exceeded ${ToolExecutor.DOOM_LOOP_TOTAL_CAP} total tool call iterations without completion. The agent appears stuck in a loop.`;
    }

    const parsed = toolCalls.map((tc) => this.parseToolCall(tc)).filter((tc): tc is ToolCall => Boolean(tc));

    if (parsed.length === 0) return null;

    const buffer = this.doomLoopBuffer.get(sessionId) ?? [];
    const currentShape = parsed.map((t) => ({
      name: t.function.name,
      args: t.function.arguments.replace(/\s+/g, "").slice(0, 80), // normalize whitespace
    }));

    buffer.push(...currentShape);
    // Keep only last N entries for threshold check
    if (buffer.length > ToolExecutor.DOOM_LOOP_THRESHOLD) {
      buffer.splice(0, buffer.length - ToolExecutor.DOOM_LOOP_THRESHOLD);
    }
    this.doomLoopBuffer.set(sessionId, buffer);

    // Check: if the last N entries are all the same tool call shape
    if (buffer.length >= ToolExecutor.DOOM_LOOP_THRESHOLD) {
      const allSame = buffer.every((e) => e.name === buffer[0].name && e.args === buffer[0].args);
      if (allSame) {
        const { name } = buffer[0];
        return (
          `Doom loop detected: tool \`${name}\` was called ${ToolExecutor.DOOM_LOOP_THRESHOLD} times consecutively ` +
          "with identical arguments and all returned without errors. " +
          "The agent appears stuck. Try a different approach or explain the issue to the user."
        );
      }
    }

    return null;
  }

  async executeToolCalls(
    sessionId: string,
    toolCalls: unknown[],
    hooks?: ToolExecutionHooks
  ): Promise<ToolCallExecution[]> {
    const parsedCalls = toolCalls
      .map((toolCall) => this.parseToolCall(toolCall))
      .filter((toolCall): toolCall is ToolCall => Boolean(toolCall));

    // Reset doom loop buffer for this batch
    this.doomLoopBuffer.set(sessionId, []);

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
      return await handler(parsedArgs.args, {
        sessionId,
        projectRoot: this.projectRoot,
        toolCall,
        createOpenAIClient: this.createOpenAIClient,
        onProcessStart: hooks?.onProcessStart,
        onProcessExit: hooks?.onProcessExit,
        onProcessStdout: hooks?.onProcessStdout,
        onProcessTimeoutControl: hooks?.onProcessTimeoutControl,
        onBackgroundProcessComplete: hooks?.onBackgroundProcessComplete,
        onBeforeFileMutation: hooks?.onBeforeFileMutation,
        onAfterFileMutation: hooks?.onAfterFileMutation,
      });
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

    const json = JSON.stringify(payload, null, 2);
    return compressContent(json);
  }
}
