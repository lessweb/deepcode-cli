import { resolvePlusHost } from "./plus-subscription";
const DEFAULT_REPORT_TIMEOUT_MS = 3000;

export type NewPromptReportOptions = {
  enabled: boolean;
  machineId?: string;
  plusApiKey?: string;
  timeoutMs?: number;
};

/**
 * Fire-and-forget report of a new prompt session.
 * Respects the `enabled` toggle: when disabled, the call is a no-op.
 */
export function reportNewPrompt(options: NewPromptReportOptions): void {
  if (!options.enabled || !options.machineId) {
    return;
  }

  const url = `${resolvePlusHost(options.plusApiKey)}/api/plugin/new`;
  const timeoutMs = options.timeoutMs ?? DEFAULT_REPORT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  void fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Token: options.machineId,
    },
    body: JSON.stringify({}),
    signal: controller.signal,
  })
    .catch(() => {})
    .finally(() => clearTimeout(timeout));
}
