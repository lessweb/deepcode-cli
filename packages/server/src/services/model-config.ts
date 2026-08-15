/**
 * Model configuration helpers.
 *
 * Summary:
 * Builds and validates the model configuration payload exposed by GET /model and
 * accepted by POST /model. This keeps model option handling outside HTTP route
 * dispatch and independent from CLI UI code.
 *
 * Exports:
 * - buildAvailableModelOptions(): ModelOption[]
 * - buildReasoningEffortOptions(): ReasoningEffort[]
 * - buildThinkingOptions(): boolean[]
 * - normalizeModelSelection(body: RequestBody, current: ResolvedDeepcodingSettings)
 * - type ModelOption
 */
import {
  defaultsToThinkingMode,
  supportsMultimodal,
  type ModelConfigSelection,
  type ReasoningEffort,
  type ResolvedDeepcodingSettings,
} from "@vegamo/deepcode-core";
import { MODEL_COMMAND_MODELS, MODEL_COMMAND_THINKING_OPTIONS } from "../model-options";
import type { RequestBody } from "./request-body";

export type ModelOption = {
  model: string;
  thinkingDefault: boolean;
  supportsMultimodal: boolean;
};

export function buildAvailableModelOptions(): ModelOption[] {
  return MODEL_COMMAND_MODELS.map((model) => ({
    model,
    thinkingDefault: defaultsToThinkingMode(model),
    supportsMultimodal: supportsMultimodal(model),
  }));
}

export function buildReasoningEffortOptions(): ReasoningEffort[] {
  const efforts = MODEL_COMMAND_THINKING_OPTIONS.map((option) => option.reasoningEffort).filter(
    (effort): effort is ReasoningEffort => effort === "high" || effort === "max"
  );
  return Array.from(new Set(efforts));
}

export function buildThinkingOptions(): boolean[] {
  return Array.from(new Set(MODEL_COMMAND_THINKING_OPTIONS.map((option) => option.thinkingEnabled)));
}

export function normalizeModelSelection(
  body: RequestBody,
  current: ResolvedDeepcodingSettings
): { ok: true; data: ModelConfigSelection } | { ok: false; error: string } {
  const model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : current.model;
  const thinkingEnabled = typeof body.thinkingEnabled === "boolean" ? body.thinkingEnabled : current.thinkingEnabled;
  const hasReasoningEffort = Object.prototype.hasOwnProperty.call(body, "reasoningEffort");
  const requestedReasoningEffort = hasReasoningEffort ? normalizeReasoningEffort(body.reasoningEffort) : undefined;
  if (hasReasoningEffort && !requestedReasoningEffort) {
    return { ok: false, error: "reasoningEffort must be high or max" };
  }
  return {
    ok: true,
    data: { model, thinkingEnabled, reasoningEffort: requestedReasoningEffort ?? current.reasoningEffort },
  };
}

function normalizeReasoningEffort(value: unknown): ReasoningEffort | undefined {
  return value === "high" || value === "max" ? value : undefined;
}
