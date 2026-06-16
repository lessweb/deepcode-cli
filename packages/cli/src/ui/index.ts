import {
  getThinkingOptionIndex,
  MODEL_COMMAND_MODELS,
  MODEL_COMMAND_THINKING_OPTIONS,
} from "./components/ModelsDropdown";

export { getThinkingOptionIndex, MODEL_COMMAND_MODELS, MODEL_COMMAND_THINKING_OPTIONS };
export { buildPromptDraftFromSessionMessage } from "./utils";
export {
  disableTerminalExtendedKeys,
  enableTerminalExtendedKeys,
  getPromptCursorPlacement,
  isPromptCursorAtWrapBoundary,
  resolvePromptTerminalCursorPosition,
} from "./hooks/cursor";
export { default as AppContainer } from "./views/AppContainer";
export { AskUserQuestionPrompt } from "./views/AskUserQuestionPrompt";
export { MessageView } from "./components";
export { parseDiffPreview } from "./components/MessageView/utils";
export {
  PromptInput,
  IMAGE_ATTACHMENT_CLEAR_HINT,
  formatImageAttachmentStatus,
  formatSelectedSkillsStatus,
  addUniqueSkill,
  toggleSkillSelection,
  removeCurrentSlashToken,
  isClearImageAttachmentsShortcut,
  isRawModeShortcut,
  getPromptReturnKeyAction,
  renderBufferWithCursor,
  buildInitPromptSubmission,
  type PromptSubmission,
  type PromptDraft,
} from "./views/PromptInput";
export { SessionList, formatSessionTitle, filterSessions, formatSessionStatus } from "./views/SessionList";
export { ThemedGradient } from "./views/ThemedGradient";
export { UpdatePrompt, type UpdatePromptChoice } from "./views/UpdatePrompt";
export { WelcomeScreen, formatHomeRelativePath, buildWelcomeTips } from "./views/WelcomeScreen";
export {
  findPendingAskUserQuestion,
  formatAskUserQuestionAnswers,
  formatAskUserQuestionDecline,
  type AskUserQuestionOption,
  type AskUserQuestionItem,
  type PendingAskUserQuestion,
  type AskUserQuestionAnswers,
} from "./core/ask-user-question";
export { readClipboardImage, type ClipboardImage } from "./core/clipboard";
export { buildLoadingText, type LoadingTextInput } from "./core/loading-text";
export { renderMarkdown, renderMarkdownSegments, type MarkdownSegment } from "./components/MessageView/markdown";
export {
  EMPTY_BUFFER,
  insertText,
  backspace,
  deleteForward,
  moveLeft,
  moveRight,
  moveWordLeft,
  moveWordRight,
  moveUp,
  moveDown,
  moveLineStart,
  moveLineEnd,
  killLine,
  deleteWordBefore,
  deleteWordAfter,
  reset,
  isEmpty,
  getCurrentSlashToken,
  type PromptBufferState,
} from "./core/prompt-buffer";
export {
  BUILTIN_SLASH_COMMANDS,
  buildSlashCommands,
  filterSlashCommands,
  findExactSlashCommand,
  formatSlashCommandDescription,
  formatSlashCommandLabel,
  type SlashCommandKind,
  type SlashCommandItem,
} from "./core/slash-commands";
export {
  filterFileMentionItems,
  formatFileMentionPath,
  getCurrentFileMentionToken,
  replaceCurrentFileMentionToken,
  scanFileMentionItems,
  type FileMentionItem,
  type FileMentionToken,
} from "./core/file-mentions";
export { findExpandedThinkingId, isCollapsedThinking } from "./core/thinking-state";
export { buildExitSummaryText } from "./exit-summary";
