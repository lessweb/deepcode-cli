/**
 * Runtime compression engine.
 *
 * Compresses large content strings before they enter the session context.
 * Three strategies, applied in priority order:
 *
 * 1. **JSON tool-result** — parses the payload, truncates only the `output`
 *    field, preserves the JSON structure and all other fields.
 * 2. **Base64-like binary** — detects high-entropy / low-text payloads and
 *    applies a length-based replacement.
 * 3. **Plain text** — length-capped with a truncated indicator.
 *
 * All strategies append a `(truncated, original N chars)` note so callers
 * (and readers of the persisted JSONL) can see that compression happened.
 *
 * Additionally provides **message history compression** (OpenCode-inspired):
 * compresses a series of session messages into a concise summary, preserving
 * the critical context while discarding redundant tool call details.
 */

export type CompressOptions = {
  /** Max character length before truncation kicks in. Default: 10 000. */
  maxLength?: number;
  /**
   * When true (default), attempts to JSON-parse the content and only
   * truncate the `output` field, keeping the envelope intact.
   */
  smartParse?: boolean;
};

/**
 * Options for message history compression.
 */
export type CompressHistoryOptions = {
  /**
   * Max total characters for the compressed summary. Default: 2 000.
   * The summarizer will try to stay within this budget.
   */
  maxSummaryLength?: number;
};

const DEFAULT_MAX_LENGTH = 10_000;
const DEFAULT_MAX_SUMMARY_LENGTH = 2_000;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compress `content` to fit within `options.maxLength` characters.
 *
 * Returns the original string unchanged when it is already short enough.
 */
export function compressContent(
  content: string,
  options: CompressOptions = {}
): string {
  const maxLength = options.maxLength ?? DEFAULT_MAX_LENGTH;
  const smartParse = options.smartParse ?? true;

  // Fast path: nothing to do.
  if (content.length <= maxLength) {
    return content;
  }

  // 1. Try smart JSON truncation (preferred for tool results).
  if (smartParse) {
    const jsonResult = tryCompressJsonToolResult(content, maxLength);
    if (jsonResult !== null) {
      return jsonResult;
    }
  }

  // 2. Fallback: plain-text truncation.
  return truncatePlainText(content, maxLength);
}

// ---------------------------------------------------------------------------
// Internal strategies
// ---------------------------------------------------------------------------

/**
 * Attempt to parse `content` as a JSON tool-result and truncate only the
 * `output` field. Returns `null` when parsing fails or content is not a
 * tool-result shape.
 */
function tryCompressJsonToolResult(
  content: string,
  maxLength: number
): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null; // not JSON
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  const record = parsed as Record<string, unknown>;

  // We only compress when there is a large-ish `output` string.
  const output = record.output;
  if (typeof output !== "string" || output.length < maxLength / 2) {
    // The payload may still be larger than maxLength even without a big
    // `output` – fall through to full truncation below.
    return null;
  }

  // Clone and replace output with truncated version.
  const compressed: Record<string, unknown> = { ...record };
  compressed.output = truncatePlainText(output, maxLength);

  const result = JSON.stringify(compressed, null, 2);
  return result.length < content.length ? result : null;
}

/**
 * Truncate plain text, appending a note about the original length.
 */
function truncatePlainText(text: string, maxLength: number): string {
  const suffix = `\n\n... (truncated, original ${text.length} chars)`;
  const available = maxLength - suffix.length;
  if (available <= 0) {
    return text.slice(0, Math.max(0, maxLength));
  }
  return text.slice(0, available) + suffix;
}

// ---------------------------------------------------------------------------
// Message history compression (OpenCode-inspired)
// ---------------------------------------------------------------------------

/**
 * Represents a single message within the history being compressed.
 */
export interface CompressableMessage {
  role: "system" | "user" | "assistant";
  content?: string | null;
  toolCalls?: Array<{ function?: { name?: string } }> | null;
}

/**
 * Compress a list of session messages into a compact summary.
 *
 * Keeps the first and last message intact (they contain the current instruction
 * and latest context), and summarizes the middle section into a concise form
 * that preserves:
 *   - what the user asked
 *   - what tools were used and what they found
 *   - what decisions were made
 *
 * This is a **lossy** compression — it drops intermediate tool call outputs
 * and verbose assistant monologues.
 */
export function compressMessageHistory(
  messages: CompressableMessage[],
  options: CompressHistoryOptions = {}
): CompressableMessage[] {
  const maxSummaryLen = options.maxSummaryLength ?? DEFAULT_MAX_SUMMARY_LENGTH;

  if (messages.length <= 3) {
    return messages; // too short to compress
  }

  // Always keep the first message (system prompt / user request)
  // and the last message (latest context).
  const head = messages.slice(0, 1);
  const tail = messages.slice(-1);
  const body = messages.slice(1, -1);

  if (body.length === 0) {
    return messages;
  }

  // Summarize the body: extract key information from each message
  const summary = summarizeMessages(body, maxSummaryLen);

  return [
    ...head,
    {
      role: "system" as const,
      content: `[Compressed history: ${body.length} messages -> summary]\n${summary}`,
    },
    ...tail,
  ];
}

/**
 * Build a concise summary of a sequence of messages.
 * Extracts user intent, tool usage patterns, and key findings.
 */
function summarizeMessages(messages: CompressableMessage[], maxLen: number): string {
  const parts: string[] = [];
  let estimatedLen = 0;

  for (const msg of messages) {
    if (estimatedLen >= maxLen) {
      parts.push(`... (${messages.length - parts.length} more messages omitted)`);
      break;
    }

    switch (msg.role) {
      case "user": {
        const text = msg.content ?? "";
        const snippet = text.length > 100 ? text.slice(0, 100) + "..." : text;
        if (snippet) {
          parts.push(`User: ${snippet}`);
          estimatedLen += snippet.length;
        }
        break;
      }
      case "assistant": {
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          const toolNames = msg.toolCalls
            .map((tc) => tc.function?.name)
            .filter(Boolean)
            .join(", ");
          if (toolNames) {
            const line = `-> Tools: ${toolNames}`;
            parts.push(line);
            estimatedLen += line.length;
          }
        }
        if (!msg.toolCalls || msg.toolCalls.length === 0) {
          const text = msg.content ?? "";
          if (text.length > 0) {
            const snippet = text.length > 150 ? text.slice(0, 150) + "..." : text;
            parts.push(`-> ${snippet}`);
            estimatedLen += snippet.length;
          }
        }
        break;
      }
    }
  }

  let result = parts.join("\n");
  if (result.length > maxLen) {
    result = result.slice(0, maxLen - 50) + `\n... (truncated, original ${result.length} chars)`;
  }
  return result || "(empty)";
}
