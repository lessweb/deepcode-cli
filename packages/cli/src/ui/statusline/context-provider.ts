import type { StatusProvider } from "./types";

/**
 * Built-in statusline provider that shows the current session's context-window
 * usage as a percentage, e.g. `ctx 12%`. (#234)
 */
export function createContextStatusProvider(
  id: string,
  color?: string,
  newLine?: boolean,
  maxLength?: number
): StatusProvider {
  return {
    id,
    color,
    newLine,
    maxLength,
    fetch: async (ctx) => {
      const info = ctx.getSessionInfo?.();
      if (!info || !info.activeSessionId || info.maxContextTokens <= 0) {
        return "";
      }
      const percent = Math.min(100, Math.round((info.activeTokens / info.maxContextTokens) * 100));
      return `ctx ${percent}%`;
    },
  };
}
