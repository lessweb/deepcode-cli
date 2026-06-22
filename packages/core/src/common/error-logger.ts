import * as fs from "fs";
import * as path from "path";
import * as os from "os";

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
  return (
    text
      // Mask Bearer tokens in Authorization headers
      .replace(/(Authorization:\s*Bearer\s+)[^\s\r\n]+/gi, "$1***MASKED***")
      // Mask "apiKey" or "api_key" values in JSON-like strings
      .replace(/((?:api[Kk]ey|api_key|secret)\s*[:=]\s*"?)[^",}\s]+/gi, "$1***MASKED***")
  );
}

const CONTENT_TRUNCATE_PREVIEW = 100;

/**
 * Truncate a content string for logging: keep a short prefix and append the
 * total length so the payload structure is preserved while content bloat is
 * avoided.
 */
function truncateContent(value: string): string {
  if (value.length <= CONTENT_TRUNCATE_PREVIEW) {
    return value;
  }
  return `${value.slice(0, CONTENT_TRUNCATE_PREVIEW)}...(total ${value.length} chars)`;
}

/**
 * Deep-clone a request payload, only truncating `content` fields whose value
 * is a string.  Every other field is kept exactly as-is so the logged request
 * mirrors the original API payload (no fields added or removed).
 */
function sanitizeRequestPayload(request: Record<string, unknown>): Record<string, unknown> {
  function walk(value: unknown): unknown {
    if (!value || typeof value !== "object") {
      return value;
    }

    if (Array.isArray(value)) {
      return value.map(walk);
    }

    const record = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};

    for (const [key, val] of Object.entries(record)) {
      if (key === "content" && typeof val === "string") {
        result[key] = truncateContent(val);
      } else {
        result[key] = walk(val);
      }
    }

    return result;
  }

  return walk(request) as Record<string, unknown>;
}

export type ApiErrorLogEntry = {
  timestamp: string;
  location: string;
  requestId: string;
  sessionId?: string;
  model?: string;
  baseURL?: string;
  error: {
    name: string;
    message: string;
    stack?: string;
  };
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
      error: {
        name: entry.error.name,
        message: maskSensitive(entry.error.message),
        stack: entry.error.stack ? maskSensitive(entry.error.stack) : undefined,
      },
      request: sanitizeRequestPayload(entry.request),
    };

    if (entry.response !== undefined) {
      logLine.response = typeof entry.response === "string" ? maskSensitive(entry.response) : entry.response;
    }

    const newLine = JSON.stringify(logLine) + "\n";
    fs.appendFileSync(ERROR_LOG_PATH, newLine, "utf8");

    // Keep only the last N entries
    const MAX_ENTRIES = 20;
    const raw = fs.readFileSync(ERROR_LOG_PATH, "utf8");
    const lines = raw.split("\n").filter((line) => line.trim().length > 0);
    if (lines.length > MAX_ENTRIES) {
      fs.writeFileSync(ERROR_LOG_PATH, lines.slice(-MAX_ENTRIES).join("\n") + "\n", "utf8");
    }
  } catch {
    // Silently ignore logging failures to avoid disrupting the main flow
  }
}
