import type { DiffPreviewLine, ToolSummary } from "./types";
import type { SessionMessage } from "../../../session";
import { RawMode } from "../../contexts";
import chalk from "chalk";
import { t } from "../../../common/i18n";
import { truncateDisplay } from "../../../common/display-width";

/** Type guard that checks whether a value is a plain object (not null, not an array). */
export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/** Capitalizes the first character of a tool status name, falling back to "Tool". */
export function formatStatusName(value: string): string {
  return value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : t("ui.messageView.toolName");
}

/** Truncates a string to the given maximum length, appending an ellipsis when truncated. */
export function truncate(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max)}…`;
}

/** Returns the first non-empty line from a multi-line string, normalizing whitespace. */
export function firstNonEmptyLine(value: string): string {
  for (const line of value.split(/\r?\n/)) {
    const trimmed = line.trim().replace(/\s+/g, " ");
    if (trimmed) {
      return trimmed;
    }
  }
  return "";
}

/**
 * Builds a one-line summary of thinking / reasoning content.
 * Falls back to "(reasoning...)" when only reasoning_content params are present.
 */
export function buildThinkingSummary(content: string, messageParams: unknown | null, mode?: RawMode): string {
  if (content) {
    const normalized = content.replace(/\r?\n/g, " ").replace(/\s+/g, " ");
    let result = truncateDisplay(normalized, 100);
    if (result.endsWith(":") || result.endsWith("：")) {
      result = result.slice(0, -1);
    }
    return result;
  }

  const params = messageParams as { reasoning_content?: unknown } | null | undefined;
  if (typeof params?.reasoning_content === "string" && params.reasoning_content.trim()) {
    return mode !== RawMode.Lite ? params?.reasoning_content || "" : t("ui.messageView.reasoningFallback");
  }

  return "";
}

/** Formats a tool's parameters for status display, preserving full bash commands but truncating others. */
export function formatToolStatusParams(summary: ToolSummary): string {
  const params = firstNonEmptyLine(summary.params);
  return summary.name.toLowerCase() === "bash" ? params : truncateDisplay(params, 120);
}

/** Builds a structured summary (name, params, ok, metadata) from a tool session message. */
export function buildToolSummary(message: SessionMessage): ToolSummary {
  const payload = parseToolPayload(message.content);
  const metaFunctionName =
    message.meta?.function && typeof (message.meta.function as { name?: unknown }).name === "string"
      ? (message.meta.function as { name: string }).name
      : null;
  const name = payload.name || metaFunctionName || "tool";
  const params =
    name === "AskUserQuestion"
      ? extractAskUserQuestionParams(message) || getMetaParams(message)
      : getMetaParams(message);

  return {
    name,
    params,
    ok: payload.ok !== false,
    metadata: payload.metadata,
  };
}

/** Extracts the paramsMd field from a session message's metadata, trimmed. */
export function getMetaParams(message: SessionMessage): string {
  return typeof message.meta?.paramsMd === "string" ? message.meta.paramsMd.trim() : "";
}

/**
 * Extracts human-readable question text from an AskUserQuestion tool message.
 * Tries the tool function arguments first, then falls back to parsing metadata params.
 */
export function extractAskUserQuestionParams(message: SessionMessage): string {
  const fromFunction = extractQuestionsFromToolFunction(message.meta?.function);
  if (fromFunction) {
    return fromFunction;
  }

  const params = getMetaParams(message);
  if (!params) {
    return "";
  }

  try {
    const parsed = JSON.parse(params);
    return extractQuestionsFromValue(parsed);
  } catch {
    return "";
  }
}

/**
 * Extracts question strings from a tool function object by parsing its JSON arguments.
 */
export function extractQuestionsFromToolFunction(toolFunction: unknown): string {
  if (!toolFunction || typeof toolFunction !== "object") {
    return "";
  }
  const args = (toolFunction as { arguments?: unknown }).arguments;
  if (typeof args !== "string" || !args.trim()) {
    return "";
  }
  try {
    const parsed = JSON.parse(args);
    return extractQuestionsFromValue((parsed as { questions?: unknown })?.questions);
  } catch {
    return "";
  }
}

/** Extracts and joins question strings from an array of question objects. */
export function extractQuestionsFromValue(value: unknown): string {
  if (!Array.isArray(value)) {
    return "";
  }
  return value
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return "";
      }
      return typeof (item as { question?: unknown }).question === "string"
        ? (item as { question: string }).question.trim()
        : "";
    })
    .filter(Boolean)
    .join(" / ");
}

/** Parses a tool's JSON payload, extracting name, ok flag, and metadata. */
export function parseToolPayload(content: string | null): {
  name: string | null;
  ok: boolean;
  metadata: Record<string, unknown> | null;
} {
  if (!content) {
    return { name: null, ok: true, metadata: null };
  }

  try {
    const parsed = JSON.parse(content) as { name?: unknown; ok?: unknown; metadata?: unknown };
    return {
      name: typeof parsed.name === "string" && parsed.name.trim() ? parsed.name.trim() : null,
      ok: parsed.ok !== false,
      metadata: isPlainRecord(parsed.metadata) ? parsed.metadata : null,
    };
  } catch {
    return { name: null, ok: true, metadata: null };
  }
}

/**
 * Returns structured diff preview lines for successful edit or write tool calls.
 * Returns an empty array if the tool is not edit/write or has no diff_preview metadata.
 */
export function getToolDiffPreviewLines(summary: ToolSummary): DiffPreviewLine[] {
  if (!summary.ok || !["edit", "write"].includes(summary.name.toLowerCase())) {
    return [];
  }
  const diffPreview = summary.metadata?.diff_preview;
  if (typeof diffPreview !== "string" || !diffPreview.trim()) {
    return [];
  }
  return parseDiffPreview(diffPreview);
}

/** Parses a unified-diff-style preview string into an array of structured diff lines. */
export function parseDiffPreview(diffPreview: string): DiffPreviewLine[] {
  return diffPreview
    .split("\n")
    .filter((line) => line && !line.startsWith("--- ") && !line.startsWith("+++ ") && !line.startsWith("@@ "))
    .map((line) => {
      if (line.startsWith("+")) {
        return { marker: "+", content: line.slice(1), kind: "added" };
      }
      if (line.startsWith("-")) {
        return { marker: "-", content: line.slice(1), kind: "removed" };
      }
      return {
        marker: " ",
        content: line.startsWith(" ") ? line.slice(1) : line,
        kind: "context",
      };
    });
}

export function renderMessageToStdout(message: SessionMessage, mode: RawMode): string {
  if (!message.visible) {
    return "";
  }

  if (message.role === "user") {
    const text = message.content || t("ui.messageView.noContent");
    return chalk(`> ${text}`);
  }

  if (message.role === "assistant") {
    const isThinking = Boolean(message.meta?.asThinking);
    const content = (message.content || "").trim();

    if (isThinking) {
      const summary = buildThinkingSummary(content, message.messageParams, mode);
      return `${chalk("✧")} ${chalk(t("ui.messageView.thinking"))}${summary ? ` ${chalk(summary)}` : ""}`;
    }

    return `${chalk("✦")} ${content}`;
  }

  if (message.role === "tool") {
    const payload = parseToolPayload(message.content);
    const metaFunctionName =
      message.meta?.function && typeof (message.meta.function as { name?: unknown }).name === "string"
        ? (message.meta.function as { name: string }).name
        : null;
    const name = payload.name || metaFunctionName || "tool";
    const metaParams = typeof message.meta?.paramsMd === "string" ? message.meta.paramsMd.trim() : "";
    const params = name.toLowerCase() === "bash" ? metaParams : truncateDisplay(metaParams, 120);
    const statusLine = `${chalk("✧")} ${chalk(formatStatusName(name))}${params ? ` ${chalk(params)}` : ""}`;

    const metaResultMd = typeof message.meta?.resultMd === "string" ? message.meta.resultMd.trim() : "";
    const result = metaResultMd ? `\n${chalk.dim(t("ui.messageView.result"))}\n${metaResultMd}` : "";

    const summary: ToolSummary = {
      name,
      params,
      ok: payload.ok !== false,
      metadata: payload.metadata,
    };
    const planLines = getUpdatePlanPreviewLines(summary);
    if (planLines.length > 0) {
      const planText = planLines.map((line) => `  ${line}`).join("\n");
      return `${statusLine}\n${chalk.dim(t("ui.messageView.plan"))}\n${planText}${result}`;
    }

    return `${statusLine}${result}`;
  }

  if (message.role === "system") {
    if (message.meta?.isModelChange) {
      return chalk(`> ${message.content}`);
    }
    if (message.meta?.skill && typeof message.meta.skill === "object") {
      const skillName = (message.meta.skill as { name?: unknown }).name;
      return chalk(t("ui.messageView.loadedSkill", { name: typeof skillName === "string" ? skillName : "" }));
    }
    if (message.meta?.isSummary) {
      return chalk.dim.italic(t("ui.messageView.conversationSummaryInserted"));
    }
    return "";
  }

  return "";
}

export function getUpdatePlanPreviewLines(summary: ToolSummary): string[] {
  if (!summary.ok || summary.name !== "UpdatePlan") {
    return [];
  }
  const plan = summary.metadata?.plan;
  if (typeof plan !== "string" || !plan.trim()) {
    return [];
  }
  return plan
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
}
