import type { ResolvedExperimentalSettings } from "../settings";
import type { CreateOpenAIClient } from "./tool-types";
import { buildThinkingRequestOptions } from "./openai-thinking";

/** Generate a display-only summary without making auxiliary failures fail the turn. */
export async function summarizeReasoning(
  createOpenAIClient: CreateOpenAIClient,
  settings: ResolvedExperimentalSettings | undefined,
  content: string,
  reasoning: string | null,
  title: string | null | undefined,
  signal: AbortSignal
): Promise<string | undefined> {
  if (
    settings?.reasoningSummary !== "on" ||
    content.trim() ||
    !reasoning ||
    !title?.trim() ||
    Array.from(reasoning).length < 400
  ) {
    return undefined;
  }
  signal.throwIfAborted();
  try {
    const { client } = createOpenAIClient();
    if (!client) return undefined;
    const response = await client.chat.completions.create(
      {
        model: settings.reasoningSummaryModel,
        messages: [
          {
            role: "user",
            content: `压缩为一两句且说人话，用与文本「${title}」相同的语言回复，不要解释：\n\`\`\`\n${reasoning}\n\`\`\``,
          },
        ],
        ...buildThinkingRequestOptions(false),
      },
      { signal, timeout: 30_000, maxRetries: 0 }
    );
    signal.throwIfAborted();
    const summary = response.choices?.[0]?.message?.content;
    return typeof summary === "string" && summary.trim() ? summary : undefined;
  } catch {
    signal.throwIfAborted();
    return undefined;
  }
}
