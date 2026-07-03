import type { StatusLineProviderConfig } from "@vegamo/deepcode-core";

export type StatusSegment = {
  id: string;
  text: string;
  color?: string;
  newLine?: boolean;
};

export type SessionInfo = {
  activeSessionId: string | null;
  messageCount: number;
  requestCount: number;
  totalTokens: number;
  activeTokens: number;
  maxContextTokens: number;
  model: string;
  thinkingEnabled: boolean;
  reasoningEffort: string;
  toolUsage: Record<string, number>;
};

export type StatusProviderContext = {
  projectRoot: string;
  signal: AbortSignal;
  getSessionInfo?: () => SessionInfo | null;
};

export type StatusProvider = {
  id: string;
  color?: string;
  maxLength?: number;
  newLine?: boolean;
  fetch: (ctx: StatusProviderContext) => Promise<string>;
  dispose?: () => void;
};

export type StatusProviderFactory = (
  config: StatusLineProviderConfig,
  projectRoot: string
) => Promise<StatusProvider | null>;
