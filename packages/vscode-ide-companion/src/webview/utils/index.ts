import type { TokenTelemetry } from "@/webview/types";
import type { AnswerFormValues } from "@/webview/components/AskQuestionCarousel";

export function flattenUsageFields(value: unknown, prefix = "") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }

  const rows: [string, unknown][] = [];
  Object.entries(value).forEach(([key, nestedValue]) => {
    const fieldName = prefix ? `${prefix}.${key}` : key;
    if (nestedValue && typeof nestedValue === "object" && !Array.isArray(nestedValue)) {
      rows.push(...flattenUsageFields(nestedValue, fieldName));
    } else {
      rows.push([fieldName, nestedValue]);
    }
  });
  return rows;
}

/**
 * Get token usage percent.
 * @param telemetry
 */
export function getTokenUsagePercent(telemetry?: TokenTelemetry) {
  const activeTokens = Number(telemetry?.activeTokens || 0);
  const threshold = Number(telemetry?.compactPromptTokenThreshold || 0);
  if (!Number.isFinite(activeTokens) || !Number.isFinite(threshold) || threshold <= 0) {
    return 0;
  }
  return Math.trunc(((0.5 * activeTokens) / threshold) * 100);
}

/**
 * Format usage field label.
 * @param label
 */
export function formatUsageFieldLabel(label: string) {
  if (label === "prompt_tokens_details.cached_tokens") {
    return "prompt_cached_tokens";
  }
  if (label === "completion_tokens_details.reasoning_tokens") {
    return "completion_reasoning_tokens";
  }
  return label;
}

/**
 * Convert a string to title case.
 * @param str
 */
const acronymMap: Record<string, string> = {
  api: "API",
  id: "ID",
  url: "URL",
  http: "HTTP",
  https: "HTTPS",
  cpu: "CPU",
  gpu: "GPU",
};

/**
 * 将下划线命名的字符串转换为标题大小写的可读字符串。
 *
 * @param str - 下划线分隔的字符串，如 `'prompt_cache_miss_tokens'` 或 `'api_key'`
 * @returns 转换后的字符串，如 `'Prompt Cache Miss Tokens'`
 *
 * @example
 * toTitleCase('prompt_cache_miss_tokens') // "Prompt Cache Miss Tokens"
 * toTitleCase('api-key')                  // "Api Key"
 * toTitleCase('api_key')                  // "Api Key"
 * toTitleCase('api__key')                 // "Api Key"
 * toTitleCase('')                         // ""
 */
export function toTitleCase(str: string): string {
  if (!str) return "";

  return str
    .trim()
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((word) => {
      const lower = word.toLowerCase();

      if (acronymMap[lower]) {
        return acronymMap[lower];
      }

      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

/**
 * 将字符串的首字母大写。
 * @param str
 */
export function capitalize(str: string): string {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * 构建 AskUserQuestion 的回复。
 * @param questions
 */
export function buildAskUserQuestionReply(questions: AnswerFormValues["answers"]) {
  const lines = ["Answer to AskUserQuestion:"];

  for (let index = 0; index < questions.length; index += 1) {
    const question = questions[index];

    const otherText = question?.other?.trim() || "";

    if (question?.options?.length === 0 && !otherText) {
      return {
        ok: false,
        error: `Please answer question ${index + 1}.`,
      };
    }

    lines.push("");
    lines.push(`${index + 1}. ${question.question}`);
    if ((question?.options || [])?.length > 0) {
      lines.push(`- Selected: ${(question?.options || []).join(", ")}`);
    }
    if (otherText) {
      lines.push(`- Other: ${otherText}`);
    }
  }

  return {
    ok: true,
    text: lines.join("\n"),
  };
}
