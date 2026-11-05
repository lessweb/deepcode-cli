import { isUserHistoryMessage } from "@vegamo/deepcode-core";
import chalk from "chalk";
import { renderMessageToStdout } from "../components/MessageView/utils";
import type { RawMode } from "../contexts";
import type { PromptDraft } from "../views/PromptInput";
import type { ModelConfigSelection } from "@vegamo/deepcode-core";
import type { SessionEntry, SessionMessage } from "@vegamo/deepcode-core";
import type { SessionManager } from "@vegamo/deepcode-core";
import type { MessageMeta } from "@vegamo/deepcode-core";

/**
 * Render eligible messages directly to stdout, followed by the Raw mode exit footer.
 */
export function renderRawModeMessages(allMessages: SessionMessage[], mode: string | RawMode): void {
  let hasMessages = false;
  for (const msg of allMessages) {
    const rendered = renderMessageToStdout(msg, mode as RawMode);
    if (!rendered) continue;
    hasMessages = true;
    process.stdout.write("\n");
    process.stdout.write(rendered + "\n\n");
  }
  if (hasMessages) {
    process.stdout.write("\n\n");
    process.stdout.write(chalk.dim("Press ESC to exit raw mode"));
  } else {
    process.stdout.write("\n");
    process.stdout.write(chalk.dim("(No messages in this session yet. Start chatting to see them here.)"));
    process.stdout.write("\n\n");
    process.stdout.write(chalk.dim("Press ESC to exit raw mode"));
  }
}

export function buildSyntheticUserMessage(content: string, imageCount: number, meta?: MessageMeta): SessionMessage {
  const now = new Date().toISOString();
  return {
    id: `local-${Math.random().toString(36).slice(2)}`,
    sessionId: "local",
    role: "user",
    content,
    contentParams:
      imageCount > 0
        ? Array.from({ length: imageCount }, () => ({
            type: "image_url",
            image_url: { url: "" },
          }))
        : null,
    messageParams: null,
    compacted: false,
    visible: true,
    createTime: now,
    updateTime: now,
    meta,
  };
}

export function buildPromptHistory(messages: SessionMessage[]): string[] {
  return messages
    .filter(isUserHistoryMessage)
    .map((message) => message.content ?? "")
    .filter((content) => content.length > 0);
}

export function buildPromptDraftFromSessionMessage(message: SessionMessage, nonce: number): PromptDraft {
  const storedImageUrls = message.meta?.userPrompt?.imageUrls;
  return {
    nonce,
    text: typeof message.content === "string" ? message.content : "",
    imageUrls: Array.isArray(storedImageUrls)
      ? storedImageUrls.filter((url): url is string => typeof url === "string" && url.length > 0)
      : extractImageUrlsFromContentParams(message.contentParams),
  };
}

export function extractImageUrlsFromContentParams(contentParams: unknown): string[] {
  const params = Array.isArray(contentParams) ? contentParams : contentParams ? [contentParams] : [];
  const imageUrls: string[] = [];
  for (const param of params) {
    if (!param || typeof param !== "object") {
      continue;
    }
    const record = param as { type?: unknown; image_url?: { url?: unknown } };
    const url = record.image_url?.url;
    if (record.type === "image_url" && typeof url === "string" && url) {
      imageUrls.push(url);
    }
  }
  return imageUrls;
}

export function isCurrentSessionEmpty(sessionManager: SessionManager): boolean {
  const activeSessionId = sessionManager.getActiveSessionId();
  return !activeSessionId || !sessionManager.getSession(activeSessionId);
}

const CONTEXT_BAR_WIDTH = 10;

export function formatTokenCount(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) {
    return "0";
  }
  if (tokens < 1024) {
    return String(Math.round(tokens));
  }

  const unit = tokens >= 1024 * 1024 ? "M" : "K";
  const divisor = unit === "M" ? 1024 * 1024 : 1024;
  return `${Number((tokens / divisor).toFixed(1))}${unit}`;
}

export function formatContextUsage(activeTokens: number, contextWindow: number): string {
  const safeActiveTokens = Number.isFinite(activeTokens) ? Math.max(0, activeTokens) : 0;
  const ratio = Number.isFinite(contextWindow) && contextWindow > 0 ? safeActiveTokens / contextWindow : 0;
  const cappedRatio = Math.min(1, ratio);
  const filledBlocks = Math.round(cappedRatio * CONTEXT_BAR_WIDTH);
  const bar = `${"▓".repeat(filledBlocks)}${"░".repeat(CONTEXT_BAR_WIDTH - filledBlocks)}`;
  const percent = Math.min(100, Math.round(ratio * 100));
  return `${formatTokenCount(safeActiveTokens)}/${formatTokenCount(contextWindow)} [${bar}] ${percent}%`;
}

export function buildStatusLine(
  entry: SessionEntry,
  settings: Pick<ModelConfigSelection, "model" | "thinkingEnabled" | "reasoningEffort"> & {
    contextWindow: number;
  }
): string {
  const parts: string[] = [];
  parts.push(`status: ${entry.status}`);
  if (typeof entry.activeTokens === "number" && entry.activeTokens > 0) {
    parts.push(formatContextUsage(entry.activeTokens, settings.contextWindow));
  }
  const model = settings.model.trim();
  if (model) {
    const modelLabel = settings.thinkingEnabled ? `${model} ${settings.reasoningEffort}` : model;
    parts.push(`${modelLabel}${entry.usingPlus ? " plus" : ""}`);
  }
  if (entry.failReason) {
    parts.push(`fail: ${entry.failReason}`);
  }
  return parts.join(" · ");
}

export function formatThinkingMode(
  settings: Pick<ModelConfigSelection, "thinkingEnabled" | "reasoningEffort">
): string {
  if (!settings.thinkingEnabled) {
    return "no thinking";
  }
  return `thinking ${settings.reasoningEffort}`;
}

export function formatModelConfig(settings: ModelConfigSelection): string {
  return `${settings.model}, ${formatThinkingMode(settings)}`;
}
