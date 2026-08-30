import {
  SessionManager,
  createOpenAIClient,
  killAllMcpProcesses,
  resolveCurrentSettings,
  type AskPermissionRequest,
  type AskPermissionScope,
  type PermissionSettings,
  type SessionManagerOptions,
} from "@vegamo/deepcode-core";
import { buildExecPrompt, type ExecInputStream } from "./exec-input";
import { writeStderrLine, writeStdoutLine } from "./utils/stdio-helpers";

type ExecSessionManager = Pick<
  SessionManager,
  | "dispose"
  | "getActiveSessionId"
  | "getSession"
  | "forkSession"
  | "handleUserPrompt"
  | "initMcpServers"
  | "interruptActiveSession"
  | "setActiveSessionId"
>;

interface SignalTarget {
  on(event: "SIGINT", listener: () => void): unknown;
  off(event: "SIGINT", listener: () => void): unknown;
}

export interface ExecRunnerOptions {
  prompt: string;
  projectRoot: string;
  resumeSessionId?: string;
  forkSessionId?: string;
  input?: ExecInputStream;
}

export interface ExecRunnerDependencies {
  buildPrompt: typeof buildExecPrompt;
  createSessionManager: (options: SessionManagerOptions) => ExecSessionManager;
  resolveSettings: typeof resolveCurrentSettings;
  signalTarget: SignalTarget;
  writeStdoutLine: (message: string) => void;
  writeStderrLine: (message: string) => void;
}

const defaultDependencies: ExecRunnerDependencies = {
  buildPrompt: buildExecPrompt,
  createSessionManager: (options) => new SessionManager(options),
  resolveSettings: resolveCurrentSettings,
  signalTarget: process,
  writeStdoutLine,
  writeStderrLine,
};

/** Run exactly one model turn without mounting Ink or requiring a TTY. */
export async function runExecMode(
  options: ExecRunnerOptions,
  dependencies: Partial<ExecRunnerDependencies> = {}
): Promise<number> {
  const deps = { ...defaultDependencies, ...dependencies };
  let manager: ExecSessionManager | null = null;
  let interrupted = false;

  // Last-resort cleanup: whatever happens (crash, abort, hard exit), no MCP
  // child process is left behind as an orphan holding RAM.
  const killOnExit = (): void => {
    killAllMcpProcesses();
  };
  process.on("exit", killOnExit);

  const handleSigint = (): void => {
    interrupted = true;
    manager?.interruptActiveSession();
  };

  deps.signalTarget.on("SIGINT", handleSigint);
  try {
    const settings = deps.resolveSettings(options.projectRoot);
    manager = deps.createSessionManager({
      projectRoot: options.projectRoot,
      createOpenAIClient: () => createOpenAIClient(options.projectRoot),
      getResolvedSettings: () => deps.resolveSettings(options.projectRoot),
      renderMarkdown: (text) => text,
      nonInteractive: true,
      onAssistantMessage: () => {},
    });

    const mcpFailures = await manager.initMcpServers(settings.mcpServers);
    if (mcpFailures.length > 0) {
      deps.writeStderrLine(
        `MCP servers failed to start (${mcpFailures.length}): ${mcpFailures
          .map((f) => `${f.name} (${f.error.slice(0, 80)})`)
          .join("; ")}`
      );
    }
    if (interrupted) {
      return 130;
    }

    if (options.resumeSessionId) {
      if (!manager.getSession(options.resumeSessionId)) {
        deps.writeStderrLine(`No saved session found with ID "${options.resumeSessionId}".`);
        return 1;
      }
    }
    if (options.forkSessionId) {
      if (!manager.getSession(options.forkSessionId)) {
        deps.writeStderrLine(`No saved session found with ID "${options.forkSessionId}".`);
        return 1;
      }
    }

    const prompt = await deps.buildPrompt(options.prompt, options.input ?? process.stdin);
    if (interrupted) {
      return 130;
    }

    if (options.forkSessionId) {
      manager.setActiveSessionId(manager.forkSession(options.forkSessionId));
    } else if (options.resumeSessionId) {
      manager.setActiveSessionId(options.resumeSessionId);
    }

    await manager.handleUserPrompt({ text: prompt });
    const sessionId = manager.getActiveSessionId();
    const session = sessionId ? manager.getSession(sessionId) : null;

    if (interrupted || session?.status === "interrupted") {
      if (!interrupted) {
        deps.writeStderrLine("Execution was interrupted.");
      }
      return interrupted ? 130 : 1;
    }
    if (!session) {
      deps.writeStderrLine("Execution failed before a session was created.");
      return 1;
    }
    if (session.status === "ask_permission") {
      deps.writeStderrLine(formatPermissionConfirmationError(session.askPermissions, settings.permissions));
      return 1;
    }
    if (session.status === "waiting_for_user") {
      deps.writeStderrLine("Execution requires user input, which is unavailable in --exec mode.");
      return 1;
    }
    if (session.status !== "completed") {
      deps.writeStderrLine(
        session.failReason ? `Execution failed: ${session.failReason}` : `Execution failed (${session.status}).`
      );
      return 1;
    }

    deps.writeStdoutLine(session.assistantReply ?? "");
    return 0;
  } catch (error) {
    if (interrupted) {
      return 130;
    }
    const message = error instanceof Error ? error.message : String(error);
    deps.writeStderrLine(`deepcode: ${message}`);
    return 1;
  } finally {
    deps.signalTarget.off("SIGINT", handleSigint);
    process.off("exit", killOnExit);
    manager?.dispose();
    killAllMcpProcesses();
  }
}

export function formatPermissionConfirmationError(
  requests: AskPermissionRequest[] | undefined,
  settings: Required<PermissionSettings>
): string {
  const lines = ["Execution requires permission confirmation, which is unavailable in --exec mode."];
  if (!requests?.length) {
    lines.push("No permission request details were provided.");
  } else {
    lines.push(requests.length === 1 ? "Permission request:" : "Permission requests:");
    for (const request of requests) {
      lines.push(`- Tool: ${sanitizeDiagnosticValue(request.name) || "unknown"}`);
      const action = sanitizeDiagnosticValue(request.command);
      if (action) {
        lines.push(`  Action: ${action}`);
      }
      const description = sanitizeDiagnosticValue(request.description ?? "");
      if (description) {
        lines.push(`  Description: ${description}`);
      }
      const scopes = request.scopes.length > 0 ? request.scopes : (["unknown"] as const);
      lines.push("  Permissions:");
      for (const scope of scopes) {
        lines.push(`    - ${scope}: ${describePermissionScope(scope)}`);
        lines.push(`      Reason: ${describePermissionReason(scope, settings)}`);
      }
    }
  }
  lines.push(
    "Run interactively to approve the request. To allow it in --exec mode, remove the required scopes from permissions.ask and add them to permissions.allow as appropriate."
  );
  return lines.join("\n");
}

function describePermissionScope(scope: AskPermissionScope): string {
  switch (scope) {
    case "read-in-cwd":
      return "read files inside the workspace";
    case "read-out-cwd":
      return "read files outside the workspace";
    case "write-in-cwd":
      return "write files inside the workspace";
    case "write-out-cwd":
      return "write files outside the workspace";
    case "delete-in-cwd":
      return "delete files inside the workspace";
    case "delete-out-cwd":
      return "delete files outside the workspace";
    case "query-git-log":
      return "query Git history";
    case "mutate-git-log":
      return "change Git history";
    case "network":
      return "network access";
    case "mcp":
      return "MCP tool access";
    case "unknown":
      return "unclassified side effects";
  }
}

function describePermissionReason(scope: AskPermissionScope, settings: Required<PermissionSettings>): string {
  if (scope === "unknown") {
    return "the tool's side effects could not be classified safely.";
  }
  if (settings.ask.includes(scope)) {
    return `"${scope}" is configured in permissions.ask.`;
  }
  if (settings.defaultMode === "askAll" && !settings.allow.includes(scope)) {
    return `permissions.defaultMode is "askAll" and "${scope}" is not configured in permissions.allow.`;
  }
  return `"${scope}" requires confirmation for this tool call.`;
}

function sanitizeDiagnosticValue(value: string): string {
  const normalized = value
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.length > 500 ? `${normalized.slice(0, 497)}...` : normalized;
}
