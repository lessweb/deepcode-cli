import { spawn, type SpawnOptions } from "child_process";
import * as path from "path";

type NotifyChildProcess = {
  once(event: "error", listener: (error: NodeJS.ErrnoException) => void): NotifyChildProcess;
  unref(): void;
};

export type NotifySpawn = (
  command: string,
  args: string[],
  options: Pick<SpawnOptions, "cwd" | "detached" | "env" | "stdio">
) => NotifyChildProcess;

export function formatDurationSeconds(durationMs: number): string {
  const safeMs = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
  return String(Math.floor(safeMs / 1000));
}

export type NotifyContext = {
  status?: string;
  failReason?: string;
  body?: string;
  title?: string;
};

export function buildNotifyEnv(
  durationMs: number,
  baseEnv: NodeJS.ProcessEnv = process.env,
  context: NotifyContext = {}
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...baseEnv,
    DURATION: formatDurationSeconds(durationMs),
  };
  delete env.STATUS;
  delete env.FAIL_REASON;
  delete env.BODY;
  delete env.TITLE;

  if (context.status) {
    env.STATUS = context.status;
  }
  if (context.failReason) {
    env.FAIL_REASON = context.failReason;
  }
  if (context.body) {
    env.BODY = context.body;
  }
  if (context.title) {
    env.TITLE = context.title;
  }
  return env;
}

export function launchNotifyScript(
  notifyPath: string | undefined,
  durationMs: number,
  workingDirectory?: string,
  spawnProcess: NotifySpawn = spawn as unknown as NotifySpawn,
  configuredEnv: Record<string, string> = {},
  context: NotifyContext = {}
): void {
  const commandPath = notifyPath?.trim();
  if (!commandPath) {
    return;
  }

  const options = {
    cwd: workingDirectory,
    detached: process.platform !== "win32",
    env: buildNotifyEnv(durationMs, { ...process.env, ...configuredEnv }, context),
    stdio: "ignore" as const,
  };

  try {
    const child = spawnProcess(commandPath, [], options);
    child.once("error", (error) => {
      if (process.platform === "win32") {
        return;
      }
      if (error.code !== "EACCES" && error.code !== "ENOEXEC") {
        return;
      }

      // Fall back to /bin/sh so plain shell scripts still run without execute permissions.
      try {
        const fallbackChild = spawnProcess("/bin/sh", [commandPath], options);
        fallbackChild.once("error", () => undefined);
        fallbackChild.unref();
      } catch {
        // Ignore notification failures.
      }
    });
    child.unref();
  } catch {
    // Ignore notification failures.
  }
}

/**
 * Resolve the bundled built-in notification script shipped with the CLI.
 * In the esbuild bundle this lives next to `dist/cli.js`, so we resolve
 * relative to `__dirname` (which is `dist/`) and walk up to the project root.
 */
export function resolveBuiltinNotifyPath(): string | null {
  if (process.platform !== "win32") {
    return null;
  }
  try {
    // __dirname is dist/ in the bundled output; the scripts live at
    // <project-root>/templates/tools/deepcode-notify.ps1
    return path.resolve(__dirname, "..", "templates", "tools", "deepcode-notify.ps1");
  } catch {
    return null;
  }
}

/**
 * Launch the built-in Windows notification (PowerShell BalloonTip with
 * click-to-focus behaviour).  Has no effect on non-Windows platforms.
 *
 * This is intentionally separate from `launchNotifyScript` so that callers
 * can decide whether to prefer a user-configured external script or the
 * built-in one.
 */
export function launchBuiltinNotify(
  durationMs: number,
  workingDirectory?: string,
  spawnProcess: NotifySpawn = spawn as unknown as NotifySpawn,
  configuredEnv: Record<string, string> = {},
  context: NotifyContext = {}
): void {
  const scriptPath = resolveBuiltinNotifyPath();
  if (!scriptPath) {
    return;
  }

  const options = {
    cwd: workingDirectory,
    detached: false,
    env: buildNotifyEnv(durationMs, { ...process.env, ...configuredEnv }, context),
    stdio: "ignore" as const,
  };

  try {
    const child = spawnProcess(
      "powershell.exe",
      ["-ExecutionPolicy", "Bypass", "-NoProfile", "-File", scriptPath],
      options
    );
    child.once("error", () => undefined);
    child.unref();
  } catch {
    // Ignore notification failures.
  }
}
