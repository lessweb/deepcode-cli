import type { LlmRetryEvent, LlmStreamProgress, SessionEntry } from "@vegamo/deepcode-core";
import stringWidth from "string-width";

type RunningProcesses = SessionEntry["processes"];

export type LoadingTextInput = {
  progress: LlmStreamProgress | null;
  retry?: LlmRetryEvent | null;
  processes?: RunningProcesses;
  now: number;
  screenWidth?: number;
};

const STALL_THRESHOLD_MS = 3000;
const MIN_PREVIEW_TERMINAL_WIDTH = 80;
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function buildLoadingText(input: LoadingTextInput): string {
  const { progress, retry, processes, now } = input;
  const processText = buildProcessLoadingText(processes, now);
  if (processText) {
    return processText;
  }

  if (retry) {
    return `Reconnecting... ${retry.attempt}/${retry.maxRetries} (esc to interrupt)`;
  }

  if (!progress) {
    return "Thinking...";
  }

  const startedAt = parseTimestamp(progress.startedAt);
  if (startedAt === null) {
    return "Thinking...";
  }

  const elapsedMs = Math.max(0, now - startedAt);
  if (elapsedMs < STALL_THRESHOLD_MS) {
    return "Thinking...";
  }

  const elapsedSeconds = Math.floor(elapsedMs / 1000);
  const tokens = progress.formattedTokens || "0";
  const status = `Thinking... (${elapsedSeconds}s) · ↓ ${tokens} tokens`;
  const preview = progress.previewText;
  if (progress.estimatedTokens <= 1500 || !preview || (input.screenWidth ?? 0) < MIN_PREVIEW_TERMINAL_WIDTH) {
    return status;
  }
  const available = (input.screenWidth ?? 0) - 28 - stringWidth(status) - 3; // Space and brackets.
  if (available <= 0) {
    return status;
  }
  if (stringWidth(preview) <= available) {
    return `${status} [${preview}]`;
  }
  let tail = "";
  let width = 3; // Leading ellipsis.
  const graphemes = Array.from(segmenter.segment(preview), (part) => part.segment);
  for (let i = graphemes.length - 1; i >= 0; i--) {
    width += stringWidth(graphemes[i]!);
    if (width > available) break;
    tail = graphemes[i] + tail;
  }
  return tail ? `${status} [...${tail}]` : status;
}

function buildProcessLoadingText(processes: RunningProcesses | undefined, now: number): string | null {
  if (!processes || processes.size === 0) {
    return null;
  }

  const first = processes.values().next().value as { startTime: string; command: string } | undefined;
  if (!first) {
    return null;
  }

  return `(${formatElapsedTime(first.startTime, now)}) ${first.command}`;
}

function formatElapsedTime(startTimeIso: string, now: number): string {
  const startTime = parseTimestamp(startTimeIso);
  const elapsedMs = startTime === null ? 0 : Math.max(0, now - startTime);
  const elapsedSeconds = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  if (minutes > 0) {
    return `${minutes}m${seconds}s`;
  }
  return `${seconds}s`;
}

function parseTimestamp(value: string): number | null {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return parsed;
}
