import type { SessionMessage } from "../session";
import type { CreateOpenAIClient } from "../tools/executor";
import { buildThinkingRequestOptions } from "./openai-thinking";

const MAX_CHARS = 36;
const MAX_PROMPT_BYTES = 960;
const RECENT_MESSAGES = 8;

// Keep the instructions and prompt framing verbatim with Codex's
// codex-rs/tui/src/app/thread_title.rs.
const INSTRUCTIONS =
  "Generate a concise, single-line task title of at most " +
  "36 characters and under five words where possible. " +
  "Start with an imperative verb. Capitalize only the first word unless the " +
  "user's language, proper nouns, acronyms, or code terms require otherwise. " +
  "Preserve ticket references exactly. Write in the user's language. " +
  "Do not use quotes, markdown, or trailing punctuation. " +
  "Do not answer the request.";

function truncateUtf8(text: string, bytes: number): string {
  let result = "";
  for (const char of text) {
    bytes -= Buffer.byteLength(char);
    if (bytes < 0) break;
    result += char;
  }
  return result;
}

export function firstMessageTitlePrompt(text: string): string {
  const prefix = `${INSTRUCTIONS}\n\nUser prompt:\n`;
  return prefix + truncateUtf8(text.trim(), MAX_PROMPT_BYTES - Buffer.byteLength(prefix));
}

export function recentConversationTitlePrompt(messages: SessionMessage[]): string | null {
  const prefix = `${INSTRUCTIONS}\nPrioritize the current task and latest substantive user request.\n\nRecent conversation messages:\n`;
  const seen = new Set<string>();
  const recent = messages
    .filter((message) => {
      if (seen.has(message.id)) return false;
      seen.add(message.id);
      return (
        (message.role === "user" || message.role === "assistant") &&
        message.visible &&
        !message.meta?.asThinking &&
        !message.meta?.isSummary &&
        Boolean(message.content?.trim())
      );
    })
    .slice(-RECENT_MESSAGES)
    .map(({ role, content }) => ({
      role,
      text: content!.trim().replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"),
    }));
  if (!recent.length) return null;

  const markupBytes =
    Buffer.byteLength("<conversation>\n\n</conversation>") +
    recent.length -
    1 +
    recent.reduce((sum, { role }) => sum + Buffer.byteLength(`<message role="${role}"></message>`), 0);
  const contentBytes = Math.max(0, MAX_PROMPT_BYTES - Buffer.byteLength(prefix) - markupBytes);
  const perMessageBytes = Math.floor(contentBytes / recent.length);
  const shouldTruncate = recent.reduce((sum, { text }) => sum + Buffer.byteLength(text), 0) > contentBytes;
  const conversation = recent.map(({ role, text }) => {
    if (shouldTruncate && Buffer.byteLength(text) > perMessageBytes) {
      text = truncateUtf8(text, perMessageBytes);
      const entityStart = text.lastIndexOf("&");
      if (entityStart >= 0 && !text.slice(entityStart).includes(";")) text = text.slice(0, entityStart);
    }
    return `<message role="${role}">${text}</message>`;
  });
  return `${prefix}<conversation>\n${conversation.join("\n")}\n</conversation>`;
}

export function parseSessionTitle(response: string): string | null {
  try {
    const value: unknown = JSON.parse(response);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (Object.keys(record).length !== 1 || typeof record.title !== "string") return null;
    const title = record.title
      .trim()
      .replace(/^["'`“”‘’]+|["'`“”‘’]+$/gu, "")
      .trim()
      .split(/\s+/u)
      .join(" ")
      .replace(/[.?!]+$/u, "")
      .trimEnd();
    return title ? Array.from(title).slice(0, MAX_CHARS).join("") : null;
  } catch {
    return null;
  }
}

export async function generateSessionTitle(
  createOpenAIClient: CreateOpenAIClient,
  prompt: string,
  signal: AbortSignal
): Promise<string | null> {
  signal.throwIfAborted();
  const { client, model, baseURL } = createOpenAIClient();
  if (!client) return null;
  const response = await client.chat.completions.create(
    {
      model,
      messages: [
        { role: "system", content: 'Return a JSON object with exactly one string field: {"title":"..."}.' },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      ...buildThinkingRequestOptions(false, baseURL),
    },
    { signal, timeout: 30_000, maxRetries: 0 }
  );
  signal.throwIfAborted();
  return parseSessionTitle(response.choices?.[0]?.message?.content ?? "");
}
