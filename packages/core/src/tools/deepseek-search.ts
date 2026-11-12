import { randomUUID } from "node:crypto";
import { DEFAULT_BASE_URL } from "../settings";
import { logOpenAIChatCompletionDebug } from "../common/debug-logger";
import type { OpenAIClientResult } from "../common/tool-types";
import type { ToolExecutionContext, ToolExecutionResult } from "./executor";

const MAX_OUTPUT_CHARS = 30000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatResults(payload: unknown): string {
  if (!isRecord(payload) || !Array.isArray(payload.results)) {
    throw new Error("DeepSeek returned an invalid search response.");
  }
  const results = payload.results.map((item: unknown, index: number) => {
    if (
      !isRecord(item) ||
      typeof item.url !== "string" ||
      !item.url.trim() ||
      typeof item.title !== "string" ||
      typeof item.snippet !== "string" ||
      (item.summary !== undefined && typeof item.summary !== "string") ||
      (item.date !== null && typeof item.date !== "string")
    ) {
      throw new Error("DeepSeek returned an invalid search result.");
    }
    const summary = typeof item.summary === "string" && item.summary.trim() ? item.summary : item.snippet;
    return [`${index + 1}. ${item.title || item.url}`, item.url, ...(item.date ? [`Date: ${item.date}`] : []), summary]
      .filter(Boolean)
      .join("\n");
  });
  return results.join("\n\n") || "No search results found.";
}

export async function executeDeepSeekWebSearch(
  query: string,
  { apiKey, debugLogEnabled }: Pick<OpenAIClientResult, "apiKey" | "debugLogEnabled">,
  context: ToolExecutionContext,
  activityLabel: string
): Promise<ToolExecutionResult> {
  context.signal?.throwIfAborted();
  let activityId: string | undefined;
  let startedAt: number | undefined;
  let httpStatus: number | undefined;
  try {
    if (Array.from(query).length > 128) {
      throw new Error("DeepSeek search query must not exceed 128 Unicode characters.");
    }
    if (!apiKey?.trim()) {
      throw new Error("DeepSeek search requires an API key.");
    }
    activityId = `web-search-${randomUUID()}`;
    context.onProcessStart?.(activityId, activityLabel);
    context.signal?.throwIfAborted();
    startedAt = Date.now();
    const response = await fetch(`${DEFAULT_BASE_URL}/v1/tools/search`, {
      method: "POST",
      redirect: "error",
      signal: context.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, count: 10, need_content: false }),
    });
    httpStatus = response.status;
    context.signal?.throwIfAborted();
    if (!response.ok) {
      let detail = "";
      try {
        const payload: unknown = await response.json();
        if (isRecord(payload) && isRecord(payload.error) && typeof payload.error.message === "string") {
          detail = payload.error.message;
        }
      } catch {
        // Non-JSON gateway errors still retain their HTTP status.
      }
      context.signal?.throwIfAborted();
      throw new Error(`DeepSeek search request failed (HTTP ${response.status})${detail ? `: ${detail}` : "."}`);
    }
    const payload: unknown = await response.json();
    context.signal?.throwIfAborted();
    const output = formatResults(payload);
    return {
      ok: true,
      name: "WebSearch",
      output: output.slice(0, MAX_OUTPUT_CHARS),
      metadata: {
        originalQuery: query,
        resolvedQuery: query,
        translated: false,
        truncated: output.length > MAX_OUTPUT_CHARS,
      },
    };
  } catch (error) {
    context.signal?.throwIfAborted();
    return {
      ok: false,
      name: "WebSearch",
      error: `WebSearch DeepSeek search failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    if (debugLogEnabled && startedAt !== undefined) {
      logOpenAIChatCompletionDebug({
        timestamp: new Date(startedAt).toISOString(),
        location: "WebSearch.deepseekSearchApi",
        requestId: activityId,
        sessionId: context.sessionId,
        durationMs: Date.now() - startedAt,
        request: { url: `${DEFAULT_BASE_URL}/v1/tools/search`, method: "POST", query },
        response: { status: httpStatus ?? null },
      });
    }
    if (activityId !== undefined) context.onProcessExit?.(activityId);
  }
}
