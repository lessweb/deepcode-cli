import chalk from "chalk";
import gradientString from "gradient-string";
import type { ModelUsage, SessionEntry } from "../session";
import { getCurrentThemedChalk, getCurrentThemeTokens } from "./theme";

type ExitSummaryInput = {
  session: SessionEntry | null;
};

const ANSI_RE = /\u001b\[[0-9;]*[a-zA-Z]/g;

function visibleLength(text: string): number {
  return text.replace(ANSI_RE, "").length;
}

function padRight(text: string, width: number): string {
  const padding = Math.max(0, width - visibleLength(text));
  return text + " ".repeat(padding);
}

function padLeft(text: string, width: number): string {
  const padding = Math.max(0, width - visibleLength(text));
  return " ".repeat(padding) + text;
}

function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

type UsageFields = {
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  totalReqs: number;
};

function extractUsageFields(usage: ModelUsage | null): UsageFields {
  const empty: UsageFields = {
    promptTokens: 0,
    completionTokens: 0,
    cachedTokens: 0,
    totalReqs: 0,
  };
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) {
    return empty;
  }

  const record = usage as Record<string, unknown>;
  const promptTokens = typeof record.prompt_tokens === "number" ? record.prompt_tokens : 0;
  const completionTokens = typeof record.completion_tokens === "number" ? record.completion_tokens : 0;
  let cachedTokens = 0;
  const promptDetails = record.prompt_tokens_details;
  if (promptDetails && typeof promptDetails === "object" && !Array.isArray(promptDetails)) {
    const cached = (promptDetails as Record<string, unknown>).cached_tokens;
    if (typeof cached === "number") {
      cachedTokens = cached;
    }
  }

  // Some providers use prompt_cache_hit_tokens directly
  if (cachedTokens === 0 && typeof record.prompt_cache_hit_tokens === "number") {
    cachedTokens = record.prompt_cache_hit_tokens;
  }

  const totalReqs = typeof record.total_reqs === "number" ? record.total_reqs : 0;

  return { promptTokens, completionTokens, cachedTokens, totalReqs };
}

export function buildExitSummaryText(input: ExitSummaryInput): string {
  const { session } = input;

  const innerWidth = 98;
  const contentWidth = innerWidth - 4; // "│  " prefix + "  │" suffix → 4 chars padding

  const theme = getCurrentThemeTokens();
  const tc = getCurrentThemedChalk();
  const borderColor = chalk.hex(theme.border.subtle);
  const titleColor = gradientString(...theme.gradients.logo);
  const line = (text: string) => `${borderColor("│")}  ${padRight(text, contentWidth)}  ${borderColor("│")}`;

  const header = chalk.bold(titleColor("Goodbye!"));

  const rows: string[] = ["", `${header}`, ""];

  const usageRows = Object.entries(session?.usagePerModel ?? {})
    .map(([modelName, usage]) => ({
      modelName,
      usage: extractUsageFields(usage),
    }))
    .filter(
      (row) =>
        row.usage.totalReqs > 0 ||
        row.usage.promptTokens > 0 ||
        row.usage.completionTokens > 0 ||
        row.usage.cachedTokens > 0
    )
    .sort(
      (left, right) => right.usage.totalReqs - left.usage.totalReqs || left.modelName.localeCompare(right.modelName)
    );
  const hasUsage = usageRows.length > 0;

  if (hasUsage) {
    const colModel = 34;
    const colReqs = 8;
    const colInput = 16;
    const colOutput = 16;
    const colCached = 18;
    const tableWidth = colModel + colReqs + colInput + colOutput + colCached;
    const divider = "─".repeat(tableWidth);

    const headerRow =
      padRight("Model Usage", colModel) +
      padLeft("Reqs", colReqs) +
      padLeft("Input Tokens", colInput) +
      padLeft("Output Tokens", colOutput) +
      padLeft("Cached Tokens", colCached);
    rows.push(chalk.bold(headerRow));
    rows.push(tc.textMuted(divider));

    for (const { modelName, usage } of usageRows) {
      const reqsStr = formatNumber(usage.totalReqs).padStart(colReqs);
      const inputStr = formatNumber(usage.promptTokens).padStart(colInput);
      const outputStr = formatNumber(usage.completionTokens).padStart(colOutput);
      const cachedStr = formatNumber(usage.cachedTokens).padStart(colCached);
      const dataRow =
        padRight(modelName, colModel) +
        padRight(reqsStr, colReqs) +
        padRight(tc.warning(inputStr), colInput) +
        padRight(tc.warning(outputStr), colOutput) +
        padRight(tc.warning(cachedStr), colCached);
      rows.push(dataRow);
    }

    rows.push("");
  }

  rows.push("");

  const border = borderColor("─".repeat(innerWidth));
  const top = `${borderColor("╭")}${border}${borderColor("╮")}`;
  const bottom = `${borderColor("╰")}${border}${borderColor("╯")}`;

  const body = rows.map((row) => line(row)).join("\n");

  return [top, body, bottom].join("\n");
}

// ---------------------------------------------------------------------------
// Structured exit summary for React rendering
// ---------------------------------------------------------------------------

export type ExitSummaryRow = {
  modelName: string;
  reqs: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
};

export type ExitSummaryData = {
  rows: ExitSummaryRow[];
  hasUsage: boolean;
};

export function buildExitSummaryData(input: ExitSummaryInput): ExitSummaryData {
  const { session } = input;

  const rows = Object.entries(session?.usagePerModel ?? {})
    .map(([modelName, usage]) => {
      const fields = extractUsageFields(usage);
      return {
        modelName,
        reqs: fields.totalReqs,
        inputTokens: fields.promptTokens,
        outputTokens: fields.completionTokens,
        cachedTokens: fields.cachedTokens,
      };
    })
    .filter((row) => row.reqs > 0 || row.inputTokens > 0 || row.outputTokens > 0 || row.cachedTokens > 0)
    .sort((left, right) => right.reqs - left.reqs || left.modelName.localeCompare(right.modelName));

  return { rows, hasUsage: rows.length > 0 };
}
