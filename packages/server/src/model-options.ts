/**
 * Server model option constants.
 *
 * Summary:
 * Defines the model and thinking-mode choices exposed by the local HTTP/SSE
 * server contract. This module contains data only and has no CLI, UI, Ink, or
 * React dependency.
 *
 * Exports:
 * - MODEL_COMMAND_MODELS: readonly model id list exposed by GET /model.
 * - MODEL_COMMAND_THINKING_OPTIONS: thinking-mode choices exposed by GET /model.
 */
import type { ReasoningEffort } from "@vegamo/deepcode-core";

export type ThinkingModeOption = {
  label: string;
  thinkingEnabled: boolean;
  reasoningEffort?: ReasoningEffort;
};

export const MODEL_COMMAND_MODELS = ["deepseek-v4-pro", "deepseek-v4-flash"] as const;

export const MODEL_COMMAND_THINKING_OPTIONS: ThinkingModeOption[] = [
  { label: "Thinking mode [max]", thinkingEnabled: true, reasoningEffort: "max" },
  { label: "Thinking mode [high]", thinkingEnabled: true, reasoningEffort: "high" },
  { label: "No thinking", thinkingEnabled: false },
];
