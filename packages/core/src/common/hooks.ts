import { execSync } from "child_process";
import type { HooksConfig } from "../settings";

/**
 * Execute a hook command string synchronously.
 * Returns { stdout, exitCode }.
 */
function runHook(command: string): { stdout: string; exitCode: number } {
  try {
    const stdout = execSync(command, {
      encoding: "utf8",
      timeout: 15_000,
      windowsHide: true,
    });
    return { stdout: stdout.trim(), exitCode: 0 };
  } catch (error: unknown) {
    const err = error as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: (err.stdout ?? err.stderr ?? String(error)).toString().trim(),
      exitCode: err.status ?? 1,
    };
  }
}

export type HookEvent =
  | "beforeWrite"
  | "afterWrite"
  | "beforeCommand"
  | "afterCommand"
  | "onError"
  // Extended hook events (OpenCode-inspired)
  | "beforeRead"
  | "afterRead"
  | "beforeToolCall"
  | "afterToolCall"
  | "beforeLlmCall"
  | "afterLlmCall"
  | "onPermissionAsk"
  | "onPermissionResolve"
  | "onSessionStart"
  | "onSessionEnd"
  | "onCompact"
  | "onSnapshot"
  | "onRollback";

/**
 * Fire a hook by event name. Receives context variables that can be
 * referenced in the hook command string.
 *
 * Hook commands can use placeholders:
 *   {filePath}  - the file being written/edited
 *   {command}   - the shell command being executed
 *   {error}     - the error message (onError only)
 *   {toolName}  - the tool being called
 *   {sessionId} - current session ID
 *   {model}     - current model name
 */
export function fireHook(
  hooks: HooksConfig | undefined,
  event: HookEvent,
  context: Record<string, string> = {}
): void {
  const command = hooks?.[event as keyof HooksConfig] as string | undefined;
  if (!command) {
    return;
  }

  // Replace placeholders
  const resolved = command.replace(/\{(\w+)\}/g, (_match: string, key: string) => context[key] ?? "");

  const { stdout, exitCode } = runHook(resolved);
  if (exitCode !== 0) {
    // Log but don't throw — hooks should not break the main flow
    console.error(`[hook:${event}] exited ${exitCode}: ${stdout}`);
  }
}
