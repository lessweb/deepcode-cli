import { spawn, type SpawnOptions } from "child_process";
import { findGitBashPath, windowsPathToPosixPath } from "./shell-utils";

type NotifyChildProcess = {
  once(event: "error", listener: (error: NodeJS.ErrnoException) => void): NotifyChildProcess;
  unref(): void;
};

export type NotifySpawn = (
  command: string,
  args: string[],
  options: Pick<SpawnOptions, "cwd" | "detached" | "env" | "stdio" | "windowsHide">
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
  context: NotifyContext = {},
  runtime: { platform: NodeJS.Platform; findGitBashPath: () => string } = {
    platform: process.platform,
    findGitBashPath,
  }
): void {
  const commandPath = notifyPath?.trim();
  if (!commandPath) {
    return;
  }

  const isWindows = runtime.platform === "win32";
  const options = {
    cwd: workingDirectory,
    detached: !isWindows,
    env: buildNotifyEnv(durationMs, { ...process.env, ...configuredEnv }, context),
    stdio: "ignore" as const,
    ...(isWindows ? { windowsHide: true } : {}),
  };

  try {
    const useGitBash = isWindows && /\.sh$/i.test(commandPath);
    const child = useGitBash
      ? spawnProcess(
          runtime.findGitBashPath(),
          ["--noprofile", "--norc", "--", windowsPathToPosixPath(commandPath)],
          options
        )
      : spawnProcess(commandPath, [], options);
    child.once("error", (error) => {
      if (isWindows) {
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
