import * as path from "path";
import type { StatusProvider, StatusProviderContext } from "./types";

const DEFAULT_TIMEOUT_MS = 2000;

/**
 * Validate that the module path is within the allowed base directory.
 * Only paths under or relative to the project root or home directory are allowed.
 */
export function validateModulePath(modulePath: string, projectRoot: string): string | null {
  // Resolve relative to project root first.
  const resolved = path.isAbsolute(modulePath) ? modulePath : path.resolve(projectRoot, modulePath);
  const normalized = path.normalize(resolved);

  const homeDir = process.env.HOME || process.env.USERPROFILE || "";
  const allowedBases = [projectRoot];
  if (homeDir) {
    allowedBases.push(homeDir);
  }

  for (const base of allowedBases) {
    const normalizedBase = path.normalize(base);
    // Check if the resolved path is under the allowed base.
    if (normalized.startsWith(normalizedBase + path.sep) || normalized === normalizedBase) {
      return normalized;
    }
  }
  return null;
}

export async function loadModuleProvider(
  resolvedPath: string,
  color: string | undefined,
  id: string,
  timeoutMs: number | undefined,
  maxLength?: number
): Promise<StatusProvider | null> {
  try {
    const timeout =
      typeof timeoutMs === "number" && Number.isFinite(timeoutMs) && timeoutMs >= 100
        ? Math.floor(timeoutMs)
        : DEFAULT_TIMEOUT_MS;

    let mod: unknown;
    try {
      mod = await import(resolvedPath);
    } catch {
      // Try with file:// protocol
      const fileUrl = path.isAbsolute(resolvedPath) ? `file://${resolvedPath}` : resolvedPath;
      mod = await import(fileUrl);
    }

    const providerFn = (mod as Record<string, unknown>).default ?? (mod as Record<string, unknown>).provider;
    if (typeof providerFn !== "function") {
      return null;
    }

    return {
      id,
      color,
      maxLength,
      fetch: async (ctx: StatusProviderContext): Promise<string> => {
        if (ctx.signal.aborted) {
          return "";
        }
        let timer: ReturnType<typeof setTimeout> | null = null;
        let onAbort: (() => void) | null = null;
        const timeoutPromise = new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("timeout")), timeout);
          onAbort = () => reject(new Error("aborted"));
          ctx.signal.addEventListener("abort", onAbort, { once: true });
        });

        try {
          const result = await Promise.race([
            Promise.resolve().then(() =>
              providerFn({
                projectRoot: ctx.projectRoot,
                session: ctx.getSessionInfo ? ctx.getSessionInfo() : null,
              })
            ),
            timeoutPromise,
          ]);
          return typeof result === "string" ? result : "";
        } finally {
          if (timer) {
            clearTimeout(timer);
          }
          if (onAbort) {
            ctx.signal.removeEventListener("abort", onAbort);
          }
        }
      },
    };
  } catch {
    return null;
  }
}
