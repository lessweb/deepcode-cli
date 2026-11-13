import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { LlmErrorDetails } from "./llm-error";

const LOG_DIR = path.join(os.homedir(), ".deepcode", "logs");
const ERROR_LOG_PATH = path.join(LOG_DIR, "error.log");

function ensureLogDir(): void {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

/**
 * Mask sensitive values (API keys, tokens) that may appear in error messages
 * or response bodies.
 */
function maskSensitive(text: string): string {
  return text
    .replace(/(Authorization:\s*(?:Bearer\s+)?)[^\s\r\n]+/gi, "$1***MASKED***")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "sk-***MASKED***")
    .replace(/((?:api[Kk]ey|api_key|secret|token|authorization)\s*[:=]\s*"?)[^",}\s]+/gi, "$1***MASKED***");
}

const MAX_STRING_LENGTH = 500;
const MAX_LOG_LINE_CHARS = 32_000;
const MAX_ENTRIES = 50;

function truncateString(value: string): string {
  const masked = maskSensitive(value);
  if (masked.length <= MAX_STRING_LENGTH) {
    return masked;
  }
  return `${masked.slice(0, MAX_STRING_LENGTH)}...(total ${masked.length} chars)`;
}

/**
 * Deep-clone a payload, masking and truncating every string value. This keeps
 * the structure for debugging without logging full prompts, tool arguments, or
 * response bodies.
 */
function sanitizePayload(value: unknown): unknown {
  if (typeof value === "string") {
    return truncateString(value);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(sanitizePayload);
  }
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    result[key] = sanitizePayload(val);
  }
  return result;
}

export type ApiErrorLogEntry = {
  timestamp: string;
  location: string;
  requestId: string;
  sessionId?: string;
  model?: string;
  baseURL?: string;
  error: LlmErrorDetails;
  request: Record<string, unknown>;
  response?: unknown;
};

/**
 * Write an API error log entry to ~/.deepcode/logs/error.log.
 */
export function logApiError(entry: ApiErrorLogEntry): void {
  try {
    ensureLogDir();

    const logLine: Record<string, unknown> = {
      timestamp: entry.timestamp,
      location: entry.location,
      requestId: entry.requestId,
      sessionId: entry.sessionId,
      model: entry.model,
      baseURL: entry.baseURL,
      error: sanitizeError(entry.error),
      request: sanitizePayload(entry.request),
    };

    if (entry.response !== undefined) {
      logLine.response = sanitizePayload(entry.response);
    }

    let newLine = JSON.stringify(logLine);
    if (newLine.length > MAX_LOG_LINE_CHARS) {
      newLine = JSON.stringify({
        timestamp: entry.timestamp,
        location: entry.location,
        requestId: entry.requestId,
        sessionId: entry.sessionId,
        model: entry.model,
        baseURL: entry.baseURL,
        error: sanitizeError(entry.error),
        truncated: true,
        note: `entry exceeded ${MAX_LOG_LINE_CHARS} chars`,
      });
    }
    fs.appendFileSync(ERROR_LOG_PATH, `${newLine}\n`, "utf8");

    // Keep only the last N entries
    const raw = fs.readFileSync(ERROR_LOG_PATH, "utf8");
    const lines = raw.split("\n").filter((line) => line.trim().length > 0);
    if (lines.length > MAX_ENTRIES) {
      fs.writeFileSync(ERROR_LOG_PATH, lines.slice(-MAX_ENTRIES).join("\n") + "\n", "utf8");
    }
  } catch {
    // Silently ignore logging failures to avoid disrupting the main flow
  }
}

function sanitizeError(error: LlmErrorDetails): LlmErrorDetails {
  return {
    ...error,
    message: truncateString(error.message),
    stack: error.stack ? truncateString(error.stack) : undefined,
    causes: error.causes?.map(sanitizeError),
  };
}
