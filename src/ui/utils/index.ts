import { renderMessageToStdout } from "../components/MessageView/utils";
import type { RawMode } from "../contexts";
import type { PromptDraft } from "../views/PromptInput";
import type { ModelConfigSelection } from "../../settings";
import type { SessionEntry, SessionMessage } from "../../session";
import type { SessionManager } from "../../session";
import { getCurrentThemedChalk } from "../theme";

/**
 * Render all messages directly to stdout for Raw mode display.
 * Writes each message followed by the "Press ESC to exit raw mode" footer.
 */
export function renderRawModeMessages(allMessages: SessionMessage[], mode: string | RawMode): void {
  const tc = getCurrentThemedChalk();
  for (const msg of allMessages) {
    process.stdout.write("\n");
    process.stdout.write(renderMessageToStdout(msg, mode as RawMode) + "\n\n");
  }
  if (allMessages.length > 0) {
    process.stdout.write("\n\n");
    process.stdout.write(tc.dim("Press ESC to exit raw mode"));
  } else {
    process.stdout.write("\n");
    process.stdout.write(tc.dim("(No messages in this session yet. Start chatting to see them here.)"));
    process.stdout.write("\n\n");
    process.stdout.write(tc.dim("Press ESC to exit raw mode"));
  }
}

export function buildSyntheticUserMessage(content: string, imageCount: number): SessionMessage {
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
  };
}

export function buildPromptDraftFromSessionMessage(message: SessionMessage, nonce: number): PromptDraft {
  return {
    nonce,
    text: typeof message.content === "string" ? message.content : "",
    imageUrls: extractImageUrlsFromContentParams(message.contentParams),
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

export function buildStatusLine(entry: SessionEntry): string {
  const parts: string[] = [];
  parts.push(`status: ${entry.status}`);
  if (typeof entry.activeTokens === "number" && entry.activeTokens > 0) {
    parts.push(`tokens: ${entry.activeTokens}`);
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
