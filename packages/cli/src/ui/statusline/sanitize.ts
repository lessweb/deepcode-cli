export const STATUS_SEGMENT_MAX_LENGTH = 40;

const ANSI_PATTERN = /\x1B\[[0-?]*[ -/]*[@-~]/g;

export function sanitizeStatusText(value: unknown, maxLength: number = STATUS_SEGMENT_MAX_LENGTH): string {
  if (value === null || value === undefined) {
    return "";
  }
  const text = typeof value === "string" ? value : String(value);
  if (!text) {
    return "";
  }
  // Take only first non-empty line, strip ANSI escapes, collapse whitespace.
  const firstLine = text.split(/\r?\n/).find((line) => line.trim().length > 0) ?? "";
  const stripped = firstLine.replace(ANSI_PATTERN, "");
  const collapsed = stripped.replace(/\s+/g, " ").trim();
  if (collapsed.length <= maxLength) {
    return collapsed;
  }
  return collapsed.slice(0, Math.max(1, maxLength - 1)) + "…";
}
