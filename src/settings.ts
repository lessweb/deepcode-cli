import { defaultsToThinkingMode } from "./model-capabilities";

export type DeepcodingEnv = {
  MODEL?: string;
  BASE_URL?: string;
  API_KEY?: string;
  THINKING?: string;
};

export type ReasoningEffort = "high" | "max";

export type DeepcodingSettings = {
  env?: DeepcodingEnv;
  model?: string;
  thinkingEnabled?: boolean;
  reasoningEffort?: ReasoningEffort;
  debugLogEnabled?: boolean;
  notify?: string;
  webSearchTool?: string;
};

export type ResolvedDeepcodingSettings = {
  apiKey?: string;
  baseURL: string;
  model: string;
  thinkingEnabled: boolean;
  reasoningEffort: ReasoningEffort;
  debugLogEnabled: boolean;
  notify?: string;
  webSearchTool?: string;
};

export type ModelConfigSelection = {
  model: string;
  thinkingEnabled: boolean;
  reasoningEffort: ReasoningEffort;
};

function resolveReasoningEffort(value: unknown): ReasoningEffort {
  return value === "high" || value === "max" ? value : "max";
}

function resolveThinkingEnabled(settings: DeepcodingSettings | null | undefined, model: string): boolean {
  if (typeof settings?.thinkingEnabled === "boolean") {
    return settings.thinkingEnabled;
  }

  const legacyThinking = settings?.env?.THINKING;
  if (typeof legacyThinking === "string" && legacyThinking.trim()) {
    return legacyThinking.trim().toLowerCase() === "enabled";
  }

  return defaultsToThinkingMode(model);
}

export function resolveSettings(
  settings: DeepcodingSettings | null | undefined,
  defaults: { model: string; baseURL: string }
): ResolvedDeepcodingSettings {
  const env = settings?.env ?? {};
  const topLevelModel = typeof settings?.model === "string" ? settings.model.trim() : "";
  const model = topLevelModel || env.MODEL?.trim() || defaults.model;
  const notify = typeof settings?.notify === "string" ? settings.notify.trim() : "";
  const webSearchTool = typeof settings?.webSearchTool === "string" ? settings.webSearchTool.trim() : "";

  return {
    apiKey: env.API_KEY?.trim(),
    baseURL: env.BASE_URL?.trim() || defaults.baseURL,
    model,
    thinkingEnabled: resolveThinkingEnabled(settings, model),
    reasoningEffort: resolveReasoningEffort(settings?.reasoningEffort),
    debugLogEnabled: settings?.debugLogEnabled === true,
    notify: notify || undefined,
    webSearchTool: webSearchTool || undefined,
  };
}

export function modelConfigKey(config: Pick<ModelConfigSelection, "thinkingEnabled" | "reasoningEffort">): string {
  return config.thinkingEnabled ? `thinking:${config.reasoningEffort}` : "thinking:none";
}

export function applyModelConfigSelection(
  settings: DeepcodingSettings | null | undefined,
  current: ModelConfigSelection,
  selected: ModelConfigSelection
): { settings: DeepcodingSettings; changed: boolean } {
  const changed = selected.model !== current.model || modelConfigKey(selected) !== modelConfigKey(current);
  const next: DeepcodingSettings = { ...(settings ?? {}) };

  if (!changed) {
    return { settings: next, changed: false };
  }

  if (selected.model !== current.model || Object.prototype.hasOwnProperty.call(next, "model")) {
    next.model = selected.model;
  } else {
    delete next.model;
  }

  next.thinkingEnabled = selected.thinkingEnabled;
  if (selected.thinkingEnabled) {
    next.reasoningEffort = selected.reasoningEffort;
  }

  return { settings: next, changed: true };
}
