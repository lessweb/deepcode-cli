const DEFAULT_NEW_PROMPT_API_URL = "https://deepcode.vegamo.cn/api/plugin/new";
const DEFAULT_REPORT_TIMEOUT_MS = 3000;

export type NewPromptReportOptions = {
  enabled: boolean;
  machineId?: string;
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

  const timeoutMs = options.timeoutMs ?? DEFAULT_REPORT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  void fetch(DEFAULT_NEW_PROMPT_API_URL, {
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
