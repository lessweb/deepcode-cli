export const DEFAULT_BASH_TIMEOUT_MS = 10 * 60 * 1000;
export const MIN_BASH_TIMEOUT_MS = 60 * 1000;
export const BASH_TIMEOUT_INCREMENT_MS = 5 * 60 * 1000;
export const BASH_TIMEOUT_DECREMENT_MS = 60 * 1000;

export function clampBashTimeoutMs(timeoutMs: number, minTimeoutMs: number = MIN_BASH_TIMEOUT_MS): number {
  if (!Number.isFinite(timeoutMs)) {
    return DEFAULT_BASH_TIMEOUT_MS;
  }
  const minimum = Number.isFinite(minTimeoutMs) ? Math.max(1, Math.round(minTimeoutMs)) : MIN_BASH_TIMEOUT_MS;
  return Math.max(minimum, Math.round(timeoutMs));
}
