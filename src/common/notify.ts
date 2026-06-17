import { spawn, spawnSync, type SpawnOptions } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

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
  question?: string;
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
  delete env.QUESTION;
  delete env.BODY;
  delete env.TITLE;

  if (context.status) {
    env.STATUS = context.status;
  }
  if (context.failReason) {
    env.FAIL_REASON = context.failReason;
  }
  if (context.question) {
    env.QUESTION = context.question;
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
 * The esbuild ESM bundle does not inject `__dirname`, so we replicate the
 * same fallback pattern used by `getExtensionRoot`.
 */
export function resolveBuiltinNotifyPath(): string | null {
  if (process.platform !== "win32") {
    return null;
  }
  try {
    const moduleDir =
      typeof __dirname !== "undefined"
        ? path.resolve(__dirname)
        : path.resolve(path.dirname(fileURLToPath(import.meta.url)));
    const candidates = [
      path.resolve(moduleDir, "..", "templates", "tools", "deepcode-notify.ps1"),
      path.resolve(moduleDir, "..", "..", "templates", "tools", "deepcode-notify.ps1"),
    ];
    return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
  } catch {
    return null;
  }
}

export function captureForegroundWindowHwnd(): string | undefined {
  if (process.platform !== "win32") {
    return undefined;
  }

  const script = [
    "$code = @'",
    "using System;",
    "using System.Runtime.InteropServices;",
    "public static class DCForeground {",
    '  [DllImport("user32.dll")]',
    "  public static extern IntPtr GetForegroundWindow();",
    "}",
    "'@",
    "Add-Type -TypeDefinition $code",
    "[DCForeground]::GetForegroundWindow().ToInt64()",
  ].join("\n");

  try {
    const result = spawnSync("powershell.exe", ["-ExecutionPolicy", "Bypass", "-NoProfile", "-Command", script], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 700,
      windowsHide: true,
    });
    if (result.status !== 0) {
      return undefined;
    }
    const hwnd = result.stdout.trim();
    return /^[1-9]\d*$/.test(hwnd) ? hwnd : undefined;
  } catch {
    return undefined;
  }
}

function getBuiltinNotifyEnv(
  durationMs: number,
  configuredEnv: Record<string, string>,
  context: NotifyContext,
  workingDirectory?: string
): NodeJS.ProcessEnv {
  const env = buildNotifyEnv(durationMs, { ...process.env, ...configuredEnv }, context);
  env.DEEPCODE_NOTIFY_PROCESS_PID ??= String(process.pid);
  env.DEEPCODE_NOTIFY_PARENT_PID ??= String(process.ppid);

  const debugEnabled = env.DEEPCODE_NOTIFY_DEBUG === "1" || env.DEEPCODE_NOTIFY_DEBUG === "true";
  if (debugEnabled && !env.DEEPCODE_NOTIFY_DEBUG_LOG) {
    env.DEEPCODE_NOTIFY_DEBUG_LOG = path.join(workingDirectory ?? process.cwd(), ".deepcode", "notify.log");
  }

  return env;
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
    env: getBuiltinNotifyEnv(durationMs, configuredEnv, context, workingDirectory),
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
