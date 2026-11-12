import type { ReasoningEffort } from "../settings";

type ThinkingConfig = {
  type: "enabled" | "disabled";
};

type ThinkingRequestOptions = {
  thinking?: ThinkingConfig;
  // Top level, not `extra_body`: `extra_body` is a Python-SDK convention. The Node OpenAI SDK sends it
  // as a literal JSON key, which the DeepSeek API ignores.
  reasoning_effort?: ReasoningEffort;
};

export function buildThinkingRequestOptions(
  thinkingEnabled: false,
  baseURL?: string,
  reasoningEffort?: ReasoningEffort
): { thinking: { type: "disabled" } };
export function buildThinkingRequestOptions(
  thinkingEnabled: boolean,
  baseURL?: string,
  reasoningEffort?: ReasoningEffort
): ThinkingRequestOptions;
export function buildThinkingRequestOptions(
  thinkingEnabled: boolean,
  _baseURL?: string,
  reasoningEffort: ReasoningEffort = "max"
): ThinkingRequestOptions {
  const thinking: ThinkingConfig = { type: thinkingEnabled ? "enabled" : "disabled" };

  return {
    thinking,
    ...(thinkingEnabled ? { reasoning_effort: reasoningEffort } : {}),
  };
}
