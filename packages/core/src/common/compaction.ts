import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { SessionMessage } from "../session";

export const MAX_REQUEST_BODY_BYTES = 48 * 1024 * 1024;

export type CompactBudget = {
  output: number;
  input: number;
  threshold: number;
  byteThreshold: number;
  retain: number;
};

export type CompactRetention = { retainRatio?: number; retainTokens?: number };

export function validateCompactRetention({ retainRatio, retainTokens }: CompactRetention): void {
  if (retainRatio !== undefined && retainTokens !== undefined)
    throw new Error("retainRatio and retainTokens are mutually exclusive.");
  if (retainRatio !== undefined && (!Number.isFinite(retainRatio) || retainRatio <= 0 || retainRatio > 1))
    throw new Error("retainRatio must be a number in (0, 1].");
  if (retainTokens !== undefined && (!Number.isInteger(retainTokens) || retainTokens < 0))
    throw new Error("retainTokens must be a non-negative integer.");
}

export function compactBudget(
  window: number,
  configuredThreshold = Math.floor(window * 0.8),
  retention: CompactRetention = {}
): CompactBudget {
  validateCompactRetention(retention);
  const output = Math.max(1, Math.min(65536, Math.floor(window / 8)));
  const input = window - output;
  const threshold = Math.min(configuredThreshold, input - output);
  if (threshold <= 0) throw new Error("The context window leaves no room for conversation input.");
  // Reserve room for tools and request options without measuring the entire wire payload.
  const byteThreshold = MAX_REQUEST_BODY_BYTES - window * 2;
  if (byteThreshold <= 0) throw new Error("The context window leaves no room in the request size budget.");
  const retain = retention.retainTokens ?? Math.floor(input * (retention.retainRatio ?? 0.16));
  if (retain >= threshold)
    throw new Error(
      `The retention budget (${retain}) must be less than the compaction threshold (${threshold}). Adjust retainRatio or retainTokens.`
    );
  return { output, input, threshold, byteThreshold, retain };
}

export function estimateRequestBytes(messages: readonly ChatCompletionMessageParam[]): number {
  return Buffer.byteLength(JSON.stringify(messages), "utf8");
}

/** An estimate, not a tokenizer. Never charge binary image encodings as text. */
export function estimateRequestTokens(messages: readonly ChatCompletionMessageParam[], tools: unknown = []): number {
  return messages.reduce((sum, message) => sum + 4 + estimateValue(message), estimateValue(tools));
}

function estimateValue(value: unknown): number {
  if (typeof value === "string") {
    let tokens = 0;
    for (const char of value) tokens += /[\u3400-\u9fff\uf900-\ufaff]/u.test(char) ? 0.6 : 0.3;
    return Math.ceil(tokens);
  }
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + estimateValue(item), 0);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (record.type === "image_url" || record.type === "file") {
      // Unknown model/image geometry: allow a conservative multi-tile visual budget.
      // Files here are uploaded images; their short file IDs do not reflect their cost.
      return (record.image_url as { detail?: string } | undefined)?.detail === "low" ? 85 : 4096;
    }
    return Object.entries(record).reduce((sum, [key, item]) => sum + estimateValue(key) + estimateValue(item), 0);
  }
  return value == null ? 0 : 1;
}

export function isFixedContext(message: SessionMessage): boolean {
  return Boolean(message.meta?.skillCatalog) || (message.role === "system" && !message.meta?.isSummary);
}

/** Eligible prefixes, longest first, with tool calls/results kept on the same side. */
export function compactPrefixes(
  messages: SessionMessage[],
  prices: number[],
  retain: number
): {
  history: SessionMessage[];
  ends: number[];
} {
  const history = messages.filter((message) => !isFixedContext(message));
  if (history.length < 2) return { history, ends: [] };
  const priceById = new Map(messages.map((message, index) => [message.id, prices[index] ?? 0]));
  let keepFrom = history.length - 1;
  let tail = priceById.get(history[keepFrom].id) ?? 0;
  while (keepFrom > 0 && tail < retain) tail += priceById.get(history[--keepFrom].id) ?? 0;

  const calls = new Map<string, number[]>();
  const edges: Array<[number, number]> = [];
  const pending = new Set<number>();
  const orphanResults = new Set<number>();
  history.forEach((message, index) => {
    // Once the conversation resumes, missing earlier results are replayed as interrupted.
    if (message.role === "user" || message.role === "assistant") pending.clear();
    const params = message.messageParams as { tool_calls?: Array<{ id?: string }>; tool_call_id?: string } | null;
    if (message.role === "assistant") {
      for (const call of params?.tool_calls ?? []) {
        if (!call.id) continue;
        calls.set(call.id, [...(calls.get(call.id) ?? []), index]);
        pending.add(index);
      }
    }
    if (message.role === "tool") {
      const candidates = calls.get(params?.tool_call_id ?? "");
      const from = candidates?.at(-1);
      if (from === undefined) orphanResults.add(index);
      else edges.push([from, index]);
    }
  });
  // Without a later conversation message, the trailing batch needs all of its results.
  for (const index of pending) {
    const params = history[index].messageParams as { tool_calls: Array<{ id?: string }> };
    if (
      params.tool_calls.every((call) =>
        history
          .slice(index + 1)
          .some(
            (message) =>
              message.role === "tool" &&
              (message.messageParams as { tool_call_id?: string } | null)?.tool_call_id === call.id
          )
      )
    )
      pending.delete(index);
  }
  const lastSummary = history.reduce((last, message, index) => (message.meta?.isSummary ? index : last), -1);
  const ends: number[] = [];
  for (let end = keepFrom; end > 0; end--) {
    if (end <= lastSummary || edges.some(([from, to]) => from < end && to >= end)) continue;
    if ([...pending, ...orphanResults].some((index) => index < end)) continue;
    ends.push(end);
  }
  return { history, ends };
}

function errorRecord(error: unknown): Record<string, unknown> {
  return error && typeof error === "object" ? (error as Record<string, unknown>) : {};
}

export function isContextOverflow(error: unknown): boolean {
  const outer = errorRecord(error);
  const inner = errorRecord(outer.error);
  const code = String(inner.code ?? outer.code ?? "");
  const message = String(inner.message ?? outer.message ?? "");
  if (outer.status != null && outer.status !== 400 && outer.status !== 413 && outer.status !== 422) return false;
  return (
    /^(context_length_exceeded|context_window_exceeded|max_context_length|CONTEXT_OVERFLOW)$/i.test(code) ||
    /(?:maximum context length|context (?:window|length).{0,40}(?:exceed|too (?:long|large))|(?:exceed|too many).{0,40}(?:context|input tokens))/i.test(
      message
    )
  );
}

/** Only explicit image capacity failures authorize lossy image projection. */
export function imageOffloadCount(error: unknown): number {
  const outer = errorRecord(error);
  const inner = errorRecord(outer.error);
  if (outer.status != null && outer.status !== 400 && outer.status !== 413 && outer.status !== 422) return 0;
  const code = String(inner.code ?? outer.code ?? "");
  const message = String(inner.message ?? outer.message ?? "");
  if (
    !/^(IMAGE_OFFLOAD_REQUIRED|too_many_images|image_limit_exceeded|image_token_limit_exceeded)$/i.test(code) &&
    !/(?:too many images|images?.{0,80}(?:exceed.{0,40}(?:limit|budget)|(?:token|count|number).{0,30}(?:limit|exceed)))/i.test(
      message
    )
  )
    return 0;
  const count = inner.offloadImages ?? outer.offloadImages;
  return typeof count === "number" && Number.isInteger(count) && count > 0 ? count : 1;
}
