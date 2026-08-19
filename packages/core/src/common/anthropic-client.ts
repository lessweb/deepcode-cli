/**
 * Anthropic-compatible LLM adapter (pi-ai style multi-provider layer).
 *
 * SessionManager consumes OpenAI chat.completions streaming chunks
 * (delta.content / reasoning_content / tool_calls / usage). This adapter
 * presents the SAME `chat.completions.create` surface while speaking the
 * Anthropic Messages API on the wire: it converts the OpenAI-shaped request
 * to Anthropic messages, streams the SSE response, and normalizes each event
 * back into OpenAI-shaped chunks — so the caller needs zero changes.
 *
 * Also works against Anthropic-compatible endpoints such as DeepSeek's
 * `https://api.deepseek.com/anthropic/v1`.
 */

type OpenAIChunk = {
  choices?: Array<{ delta?: Record<string, unknown>; index?: number }>;
  usage?: Record<string, unknown>;
};

function messagesUrl(baseURL: string): string {
  const base = baseURL.replace(/\/+$/, "");
  if (base.endsWith("/messages")) {
    return base;
  }
  if (base.endsWith("/v1")) {
    return `${base}/messages`;
  }
  return `${base}/v1/messages`;
}

function convertTools(tools: unknown): unknown[] | undefined {
  if (!Array.isArray(tools)) {
    return undefined;
  }
  const out: unknown[] = [];
  for (const raw of tools) {
    const fn = (raw as { function?: unknown } | undefined)?.function as
      | { name?: string; description?: string; parameters?: unknown }
      | undefined;
    if (!fn?.name) {
      continue;
    }
    out.push({
      name: fn.name,
      description: fn.description ?? "",
      input_schema: fn.parameters ?? { type: "object", properties: {} },
    });
  }
  return out.length > 0 ? out : undefined;
}

function convertMessages(messages: unknown, systemHint: string): { system?: string; messages: unknown[] } {
  if (!Array.isArray(messages)) {
    return { messages: [] };
  }
  const systemParts: string[] = [];
  const converted: unknown[] = [];
  for (const msg of messages as Array<Record<string, unknown>>) {
    const role = String(msg.role ?? "user");
    const content = msg.content;
    if (role === "system") {
      if (typeof content === "string") {
        systemParts.push(content);
      }
      continue;
    }
    if (role === "tool") {
      converted.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: String((msg as { tool_call_id?: string }).tool_call_id ?? "tool_call"),
            content: typeof content === "string" ? content : JSON.stringify(content ?? ""),
          },
        ],
      });
      continue;
    }
    if (role === "assistant" && Array.isArray((msg as { tool_calls?: unknown }).tool_calls)) {
      const blocks: unknown[] = [];
      if (typeof content === "string" && content) {
        blocks.push({ type: "text", text: content });
      }
      for (const raw of (msg as { tool_calls: unknown[] }).tool_calls) {
        const fn = (raw as { function?: { name?: string; arguments?: string } }).function;
        const id = String((raw as { id?: string }).id ?? `toolu_${blocks.length}`);
        let input: unknown = {};
        if (fn?.arguments) {
          try {
            input = JSON.parse(fn.arguments);
          } catch {
            input = {};
          }
        }
        blocks.push({ type: "tool_use", id, name: fn?.name ?? "unknown", input });
      }
      converted.push({ role: "assistant", content: blocks });
      continue;
    }
    if (typeof content === "string") {
      converted.push({ role, content: [{ type: "text", text: content }] });
    } else if (Array.isArray(content)) {
      // Already block-shaped (multimodal etc.): pass through.
      converted.push({ role, content });
    } else {
      converted.push({ role, content: [{ type: "text", text: JSON.stringify(content ?? "") }] });
    }
  }
  if (systemHint) {
    systemParts.push(systemHint);
  }
  return {
    ...(systemParts.length > 0 ? { system: systemParts.join("\n\n") } : {}),
    messages: converted,
  };
}

function convertRequest(request: Record<string, unknown>): Record<string, unknown> {
  const systemHint = (request as { response_format?: { type?: string } }).response_format?.type === "json_object"
    ? 'Respond with a single JSON object (no markdown fences, no commentary).'
    : "";
  const { system, messages } = convertMessages(request.messages, systemHint);
  const out: Record<string, unknown> = {
    model: request.model ?? "anthropic-default",
    messages,
    max_tokens: typeof request.max_tokens === "number" ? request.max_tokens : 8192,
    stream: true,
  };
  if (system) {
    out.system = system;
  }
  if (typeof request.temperature === "number") {
    out.temperature = request.temperature;
  }
  const tools = convertTools(request.tools);
  if (tools) {
    out.tools = tools;
  }
  return out;
}

async function* parseSseStream(body: ReadableStream<Uint8Array>): AsyncGenerator<Record<string, unknown>> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) {
        continue;
      }
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") {
        continue;
      }
      try {
        yield JSON.parse(data) as Record<string, unknown>;
      } catch {
        // ignore malformed event
      }
    }
  }
}

/**
 * Normalize Anthropic SSE events into OpenAI-shaped streaming chunks.
 * Maintains tool-call accumulation state across events.
 */
function normalizeAnthropicEvent(event: Record<string, unknown>): OpenAIChunk | OpenAIChunk[] | null {
  const type = event.type;
  if (type === "message_start") {
    return { choices: [{ index: 0, delta: { role: "assistant" } }] };
  }
  if (type === "content_block_start") {
    const block = (event as { content_block?: { type?: string; id?: string; name?: string } }).content_block;
    if (block?.type === "tool_use") {
      return {
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                { index: 0, id: block.id ?? "toolu_0", type: "function", function: { name: block.name ?? "" } },
              ],
            },
          },
        ],
      };
    }
    return null;
  }
  if (type === "content_block_delta") {
    const delta = (event as { delta?: { type?: string; text?: string; thinking?: string; partial_json?: string } }).delta;
    if (!delta) {
      return null;
    }
    if (delta.type === "text_delta" && typeof delta.text === "string") {
      return { choices: [{ index: 0, delta: { content: delta.text } }] };
    }
    if (delta.type === "thinking_delta" && typeof delta.thinking === "string") {
      return { choices: [{ index: 0, delta: { reasoning_content: delta.thinking } }] };
    }
    if (delta.type === "input_json_delta" && typeof delta.partial_json === "string") {
      return {
        choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: delta.partial_json } }] } }],
      };
    }
    return null;
  }
  if (type === "message_delta") {
    const usage = (event as { usage?: { input_tokens?: number; output_tokens?: number } }).usage;
    if (usage) {
      return {
        usage: {
          prompt_tokens: usage.input_tokens ?? 0,
          completion_tokens: usage.output_tokens ?? 0,
          total_tokens: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
        },
      };
    }
    return null;
  }
  return null;
}

export type AnthropicCompatibleClientOptions = {
  apiKey: string;
  baseURL: string;
  model?: string;
  timeoutMs?: number;
};

export type AnthropicCompatibleClient = {
  chat: {
    completions: {
      create: (
        request: Record<string, unknown>,
        options?: { signal?: AbortSignal }
      ) => Promise<AsyncIterable<OpenAIChunk>>;
    };
  };
};

export function createAnthropicCompatibleClient(options: AnthropicCompatibleClientOptions): AnthropicCompatibleClient {
  const url = messagesUrl(options.baseURL);
  const timeoutMs = options.timeoutMs ?? 120_000;

  return {
    chat: {
      completions: {
        create: async (request, createOptions) => {
          const anthropicRequest = convertRequest(request);
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), timeoutMs);
          const externalSignal = createOptions?.signal;
          const onExternalAbort = () => controller.abort();
          externalSignal?.addEventListener("abort", onExternalAbort);

          let response: Response;
          try {
            response = await fetch(url, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-api-key": options.apiKey,
                "anthropic-version": "2023-06-01",
                Accept: "text/event-stream",
              },
              body: JSON.stringify(anthropicRequest),
              signal: controller.signal,
            });
          } finally {
            clearTimeout(timer);
            externalSignal?.removeEventListener("abort", onExternalAbort);
          }

          if (!response.ok || !response.body) {
            const detail = await response.text().catch(() => "");
            throw new Error(
              `Anthropic-compatible endpoint ${response.status} (${url}): ${detail.slice(0, 300)}`
            );
          }

          return (async function* (): AsyncIterable<OpenAIChunk> {
            for await (const event of parseSseStream(response.body as ReadableStream<Uint8Array>)) {
              const normalized = normalizeAnthropicEvent(event);
              if (!normalized) {
                continue;
              }
              if (Array.isArray(normalized)) {
                for (const chunk of normalized) {
                  yield chunk;
                }
              } else {
                yield normalized;
              }
            }
          })();
        },
      },
    },
  };
}
