// Core library public API — used by both CLI and VSCode companion.

// Settings
export {
  resolveCurrentSettings,
  resolveSettings,
  resolveSettingsSources,
  readSettings,
  readProjectSettings,
  writeSettings,
  writeProjectSettings,
  writeModelConfigSelection,
  applyModelConfigSelection,
  modelConfigKey,
  getUserSettingsPath,
  getProjectSettingsPath,
  getDefaultContextWindow,
  getDefaultAutoCompactWindow,
  DEFAULT_MODEL,
  DEFAULT_BASE_URL,
} from "./settings";
export type {
  DeepcodingSettings,
  ResolvedDeepcodingSettings,
  ModelConfigSelection,
  PermissionScope,
  PermissionSettings,
  PermissionDefaultMode,
  McpServerConfig,
  ReasoningEffort,
  StatusLineSettings,
  ResolvedStatusLineSettings,
  StatusLineProviderConfig,
  HooksConfig,
} from "./settings";

// Session
export { SessionManager, getProjectCode, getCompactPromptTokenThreshold } from "./session";
export type {
  SessionMessage,
  SessionEntry,
  SessionStatus,
  SessionsIndex,
  SessionMessageRole,
  MessageMeta,
  UndoTarget,
  UserPromptContent,
  SkillInfo,
  ModelUsage,
  SessionProcessEntry,
  BashTimeoutAdjustment,
  LlmStreamProgress,
  SessionManagerOptions,
} from "./session";

// Prompt utilities
export {
  getSystemPrompt,
  getCompactPrompt,
  getRuntimeContext,
  getDefaultSkillPrompt,
  getPlanModePrompt,
  getExtensionRoot,
  getTools,
  buildSkillDocumentsPrompt,
} from "./prompt";
export type { ToolDefinition, SkillPromptDocument, PromptToolOptions } from "./prompt";

// Tools
export { ToolExecutor } from "./tools/executor";
export type {
  CreateOpenAIClient,
  ToolCall,
  ToolExecutionContext,
  ToolExecutionHooks,
  ToolExecutionResult,
  ToolHandler,
  ToolCallExecution,
  ProcessTimeoutInfo,
  ProcessTimeoutControl,
  BackgroundProcessCompletion,
  ToolExecutionFollowUpMessage,
} from "./common/tool-types";

// Tool handlers
export { handleBashTool, clearSessionWorkingDir } from "./tools/bash-handler";
export { handleReadTool } from "./tools/read-handler";
export { handleWriteTool } from "./tools/write-handler";
export { handleEditTool } from "./tools/edit-handler";
export { handleUpdatePlanTool } from "./tools/update-plan-handler";
export { handleWebSearchTool } from "./tools/web-search-handler";
export { handleAskUserQuestionTool } from "./tools/ask-user-question-handler";

// MCP
export { McpManager } from "./mcp/mcp-manager";
export { McpClient } from "./mcp/mcp-client";
export type { McpServerStatus } from "./mcp/mcp-manager";

// Common utilities
export { createOpenAIClient } from "./common/openai-client";
export { buildThinkingRequestOptions } from "./common/openai-thinking";
export { readTextFileWithMetadata, writeTextFile, buildDiffPreview, ensureParentDirectory } from "./common/file-utils";
export { normalizeFilePath, getSnippet, clearSessionState, recordFileState, getFileState } from "./common/state";
export { GitFileHistory } from "./common/file-history";
export { killProcessTree } from "./common/process-tree";
export { launchNotifyScript } from "./common/notify";
export {
  reportNewPrompt,
  recordPermissionDecision,
  recordToolUsage,
  getSessionPermissionDecisions,
  getSessionToolUsage,
  resetSessionMetrics,
  type PermissionDecisionMetrics,
  type ToolUsageMetrics,
} from "./common/telemetry";
export { DEEPSEEK_V4_MODELS, supportsMultimodal, defaultsToThinkingMode } from "./common/model-capabilities";
export { findGitBashPath, resolveShellPath, setShellIfWindows } from "./common/shell-utils";
export { logApiError } from "./common/error-logger";
export { logOpenAIChatCompletionDebug } from "./common/debug-logger";
export { describeLlmError, getLlmErrorDetails } from "./common/llm-error";
export type { LlmErrorDetails } from "./common/llm-error";
export {
  clampBashTimeoutMs,
  DEFAULT_BASH_TIMEOUT_MS,
  BASH_TIMEOUT_INCREMENT_MS,
  BASH_TIMEOUT_DECREMENT_MS,
} from "./common/bash-timeout";
export { executeValidatedTool, semanticBoolean } from "./common/validate";
export { OpenAIMessageConverter } from "./common/openai-message-converter";
export {
  computeToolCallPermissions,
  buildPermissionToolExecution,
  hasUserPermissionReplies,
  appendProjectPermissionAllows,
  normalizeAskPermissions,
  parseToolCallForPermissions,
  auditPermissionPlan,
} from "./common/permissions";
export type {
  AskPermissionRequest,
  AskPermissionScope,
  BashPermissionScope,
  MessageToolPermission,
  PermissionDecision,
  PermissionToolCall,
  UserToolPermission,
} from "./common/permissions";

// Compression
export { compressContent, compressMessageHistory } from "./context/compact";
export type { CompressOptions, CompressHistoryOptions, CompressableMessage } from "./context/compact";

// State types
export type { FileState, FileSnippet, FileLineEnding } from "./common/state";
export type { FileReadMetadata } from "./common/file-utils";

// Permission Profile（Codex 风格结构化权限）
export {
  STRICT_SANDBOX_PROFILE,
  DEFAULT_DEV_PROFILE,
  UNRESTRICTED_PROFILE,
  legacyProfileFromScopes,
  checkFileSystemAccess,
  checkNetworkAccess,
  checkGitAccess,
  parsePermissionProfile,
} from "./common/permission-profile";
export type {
  PermissionProfile,
  FileSystemAccessLevel,
  FileSystemPathKind,
  FileSystemSandboxEntry,
  NetworkPermissions,
  GitPermissions,
  ManagedPermissionConfig,
} from "./common/permission-profile";

// SQLite 会话日志
export {
  logAgentMessage,
  logToolCall,
  logPermissionDecision,
  logTokenUsage,
  saveCheckpoint,
  queryRecentLogs,
  queryLogsByJsonPath,
  queryTokenStats,
  queryPermissionHistory,
  closeSession,
  deleteSession,
  closeAll,
} from "./common/session-log";

// Job 队列
export { JobQueue, getGlobalJobQueue, createSpawnRequest } from "./common/job-queue";
export type { JobStatus, SpawnRequest, SpawnReady, ExitPayload, JobState, JobEventCallbacks } from "./common/job-queue";

// Skill 解析器（Codex 兼容 frontmatter）
export { parseSkillFile, parseSkillContent, skillPolicyToProfile, validateSkillName } from "./common/skill-parser";
export type { SkillMeta, SkillDependency, SkillInterface, SkillPolicy } from "./common/skill-parser";
