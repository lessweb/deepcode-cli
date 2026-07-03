import { spawn } from "child_process";
import * as path from "path";
import type { StatusLineProviderConfig } from "@vegamo/deepcode-core";
import type { StatusProvider, StatusProviderContext } from "./types";

const DEFAULT_TIMEOUT_MS = 1500;
const MIN_TIMEOUT_MS = 100;
const MAX_OUTPUT_BYTES = 4096;

function resolveTimeout(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < MIN_TIMEOUT_MS) {
    return DEFAULT_TIMEOUT_MS;
  }
  return Math.floor(value);
}

function resolveCwd(configCwd: string | undefined, projectRoot: string): string {
  if (!configCwd) {
    return projectRoot;
  }
  return path.isAbsolute(configCwd) ? configCwd : path.resolve(projectRoot, configCwd);
}

export function createCommandStatusProvider(
  config: Extract<StatusLineProviderConfig, { type: "command" }>,
  projectRoot: string,
  id: string
): StatusProvider {
  const timeoutMs = resolveTimeout(config.timeoutMs);
  const cwd = resolveCwd(config.cwd, projectRoot);

  return {
    id,
    color: config.color,
    newLine: config.newLine,
    maxLength: config.maxLength,
    fetch: ({ signal }: StatusProviderContext) =>
      new Promise<string>((resolve) => {
        if (signal.aborted) {
          resolve("");
          return;
        }
        const isWindows = process.platform === "win32";
        const child = spawn(config.command, {
          cwd,
          shell: isWindows ? true : "/bin/sh",
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        });

        let stdout = "";
        let stdoutBytes = 0;
        let settled = false;
        const finish = (value: string): void => {
          if (settled) {
            return;
          }
          settled = true;
          cleanup();
          if (!child.killed) {
            child.kill();
          }
          resolve(value);
        };

        const onAbort = (): void => finish("");
        signal.addEventListener("abort", onAbort, { once: true });

        const timer = setTimeout(() => finish(""), timeoutMs);

        const cleanup = (): void => {
          clearTimeout(timer);
          signal.removeEventListener("abort", onAbort);
        };

        child.stdout?.on("data", (chunk: Buffer | string) => {
          if (settled) {
            return;
          }
          const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
          if (stdoutBytes >= MAX_OUTPUT_BYTES) {
            return;
          }
          const remaining = MAX_OUTPUT_BYTES - stdoutBytes;
          const slice = text.length > remaining ? text.slice(0, remaining) : text;
          stdout += slice;
          stdoutBytes += slice.length;
        });
        // Drain stderr to avoid blocking, but ignore content.
        child.stderr?.on("data", () => undefined);
        child.on("error", () => finish(""));
        child.on("close", () => finish(stdout));
      }),
  };
}
