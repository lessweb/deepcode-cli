import type { ResolvedDeepcodingSettings, SessionEntry, SessionMessage } from "@vegamo/deepcode-core";

export type UsageReportKind = "tokens" | "context" | "cost";

// Approximate USD per 1M tokens for common DeepSeek models.
const DEEPSEEK_PRICING_USD_PER_MTOK: Record<string, { input: number; output: number }> = {
  "deepseek-v4-pro": { input: 2, output: 8 },
  "deepseek-v4-flash": { input: 0.28, output: 0.42 },
  "deepseek-chat": { input: 0.27, output: 1.1 },
  "deepseek-reasoner": { input: 0.55, output: 2.19 },
};

const DEFAULT_PRICING: { input: number; output: number } = { input: 1, output: 2 };

export function getPricingForModel(model: string): { input: number; output: number } {
  return DEEPSEEK_PRICING_USD_PER_MTOK[model.trim()] ?? DEFAULT_PRICING;
}

/**
 * Estimate the context-window consumption of the active (non-compacted)
 * session messages using a chars/4 heuristic. (#224)
 */
export function estimateContextTokens(messages: SessionMessage[]): number {
  let chars = 0;
  for (const message of messages) {
    if (message.compacted) {
      continue;
    }
    chars += (message.content ?? "").length;
    if (message.messageParams) {
      chars += JSON.stringify(message.messageParams).length;
    }
    if (Array.isArray(message.contentParams)) {
      for (const param of message.contentParams) {
        const url = (param as { image_url?: { url?: unknown } }).image_url?.url;
        if (typeof url === "string") {
          chars += url.length;
        }
        const text = (param as { text?: unknown }).text;
        if (typeof text === "string") {
          chars += text.length;
        }
      }
    }
  }
  return Math.max(0, Math.ceil(chars / 4));
}

export function buildUsageReport(
  session: SessionEntry | null,
  settings: ResolvedDeepcodingSettings,
  messages: SessionMessage[],
  kind: UsageReportKind
): string {
  const promptTokens = session?.usage?.prompt_tokens ?? 0;
  const completionTokens = session?.usage?.completion_tokens ?? 0;
  const totalTokens = session?.usage?.total_tokens ?? 0;
  const activeTokens = session?.activeTokens ?? 0;
  const estimated = estimateContextTokens(messages);
  const contextWindow = settings.contextWindow;
  const pricing = getPricingForModel(settings.model);
  const estimatedCostUsd = (promptTokens / 1_000_000) * pricing.input + (completionTokens / 1_000_000) * pricing.output;

  if (kind === "tokens") {
    return [
      `/tokens · ${settings.model}`,
      `  prompt tokens:      ${promptTokens.toLocaleString()}`,
      `  completion tokens:  ${completionTokens.toLocaleString()}`,
      `  total tokens:       ${totalTokens.toLocaleString()}`,
      `  active tokens:      ${activeTokens.toLocaleString()}`,
      `  estimated context:  ${estimated.toLocaleString()}`,
    ].join("\n");
  }

  if (kind === "context") {
    const percent = contextWindow > 0 ? Math.min(100, Math.round((estimated / contextWindow) * 100)) : 0;
    return [
      `/context · ${settings.model}`,
      `  context window:   ${contextWindow.toLocaleString()} tokens`,
      `  estimated usage:  ${estimated.toLocaleString()} tokens (${percent}%)`,
      `  messages:         ${messages.filter((m) => !m.compacted).length} active / ${messages.length} total`,
    ].join("\n");
  }

  return [
    `/cost · ${settings.model}`,
    `  input rate:   $${pricing.input}/1M tokens`,
    `  output rate:  $${pricing.output}/1M tokens`,
    `  estimated cost: $${estimatedCostUsd.toFixed(4)}`,
  ].join("\n");
}
