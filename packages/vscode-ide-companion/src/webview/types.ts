// --- Message types ---

import type { MessageMeta } from "@vegamo/deepcode-core";

export interface SessionMessage {
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  meta?: MessageMeta;
  visible?: boolean;
}

// --- Editing state ---

export interface EditingMessage {
  text: string;
  images: string[];
  skills: SkillInfo[];
}

export interface AskPermissionRequest {
  toolCallId: string;
  name: string;
  command: string;
  description: string;
  scopes: string[];
}

export interface LlmStreamProgressData {
  requestId: string;
  sessionId?: string;
  phase: "start" | "streaming" | "end";
  formattedTokens?: string;
  startedAt?: string;
}

export interface TokenTelemetry {
  model: string;
  thinkingEnabled: boolean;
  reasoningEffort: string;
  activeTokens: number;
  compactPromptTokenThreshold: number;
  usage: unknown;
}

export interface ActiveEditor {
  fileName: string;
  languageId: string;
  lineCount: number;
}

export interface SkillInfo {
  name: string;
  description?: string;
  path?: string;
  isLoaded?: boolean;
}

// --- Session types ---

export interface SessionSummary {
  id: string;
  summary: string;
  createTime: string;
  updateTime: string;
  status: string;
}

// --- Permission types ---

export interface PermissionPromptState {
  requests: AskPermissionRequest[];
  prompts: Array<{ request: AskPermissionRequest; scope: string }>;
  index: number;
  decisions: Record<string, "allow" | "deny">;
  alwaysAllows: string[];
  submitting: boolean;
}

// --- App state ---

// --- AskUserQuestion types ---

export interface AskUserQuestionData {
  questions: Array<{
    question: string;
    multiSelect: boolean;
    options: Array<{
      label: string;
      description?: string;
    }>;
  }>;
}

export interface AppState {
  sessions: SessionSummary[];
  activeSessionId: string | null;
  activeSessionStatus: string | null;
  messages: SessionMessage[];
  loading: boolean;
  skills: SkillInfo[];
  selectedSkills: SkillInfo[];
  askPermissions: AskPermissionRequest[];
  processes: Record<string, { startTime: string; command: string }> | null;
  tokenTelemetry?: TokenTelemetry;
  llmStreamProgress: LlmStreamProgressData | null;
  lastMessageRole: "user" | "assistant" | "tool" | "system" | null;
  permissionPromptState: PermissionPromptState | null;
  pendingPermissionReply: {
    permissions: Array<{ toolCallId: string; permission: "allow" | "deny" }>;
    alwaysAllows: string[];
  } | null;
  activeEditor: ActiveEditor | null;
  editingMessage: EditingMessage | null;
  askUserQuestions: AskUserQuestionData | null;
}

// --- App actions ---

export type AppAction =
  | { type: "INIT_EMPTY"; sessions: SessionSummary[]; tokenTelemetry: TokenTelemetry | null }
  | {
      type: "LOAD_SESSION";
      sessionId: string;
      status: string | null;
      messages: SessionMessage[];
      sessions: SessionSummary[];
      askPermissions?: AskPermissionRequest[];
      processes?: Record<string, { startTime: string; command: string }> | null;
      tokenTelemetry?: TokenTelemetry | null;
    }
  | { type: "SET_SESSIONS"; sessions: SessionSummary[] }
  | {
      type: "SESSION_STATUS";
      status: string | null;
      askPermissions?: AskPermissionRequest[];
      processes?: Record<string, { startTime: string; command: string }> | null;
      tokenTelemetry?: TokenTelemetry | undefined;
    }
  | { type: "LLM_STREAM_PROGRESS"; progress: LlmStreamProgressData }
  | { type: "USER_MESSAGE"; content: string; meta?: Record<string, unknown> }
  | { type: "ASSISTANT_MESSAGE"; content?: string; html?: string; meta?: Record<string, unknown> }
  | { type: "APPEND_MESSAGE"; message: SessionMessage }
  | { type: "SET_LOADING"; loading: boolean }
  | { type: "SET_SKILLS"; skills: SkillInfo[] }
  | { type: "SET_SELECTED_SKILLS"; skills: SkillInfo[] }
  | { type: "SET_PERMISSION_PROMPT_STATE"; state: PermissionPromptState | null }
  | { type: "SET_PENDING_PERMISSION_REPLY"; reply: AppState["pendingPermissionReply"] }
  | { type: "CLEAR_MESSAGES" }
  | { type: "SET_ACTIVE_EDITOR"; editor: ActiveEditor | null }
  | { type: "SET_EDITING_MESSAGE"; editingMessage: EditingMessage | null }
  | { type: "SET_ASK_USER_QUESTIONS"; data: AskUserQuestionData | null };
