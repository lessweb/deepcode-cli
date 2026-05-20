import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useApp, useStdout } from "ink";
import chalk from "chalk";
import { ARGS_SEPARATOR } from "./constants";
import {
  EMPTY_BUFFER,
  backspace,
  deleteForward,
  deleteWordBefore,
  deleteWordAfter,
  getCurrentSlashToken,
  insertText,
  isEmpty,
  killLine,
  moveDown,
  moveLeft,
  moveLineEnd,
  moveLineStart,
  moveRight,
  moveWordLeft,
  moveWordRight,
  moveUp,
} from "./promptBuffer";
import type { PromptBufferState } from "./promptBuffer";
import {
  clearPromptUndoRedoState,
  createPromptUndoRedoState,
  recordPromptEdit,
  redoPromptEdit,
  undoPromptEdit,
} from "./promptUndoRedo";
import { buildSlashCommands, filterSlashCommands, findExactSlashCommand } from "./slashCommands";
import type { SlashCommandItem } from "./slashCommands";
import {
  filterFileMentionItems,
  getCurrentFileMentionToken,
  replaceCurrentFileMentionToken,
  scanFileMentionItems,
} from "./fileMentions";
import type { FileMentionItem } from "./fileMentions";
import { readClipboardImageAsync } from "./clipboard";
import type { SessionEntry, SkillInfo } from "../session";

// Re-exported from prompt modules for backward compatibility
export { useTerminalInput, parseTerminalInput, dispatchTerminalInput } from "./prompt";
export type { InputKey } from "./prompt";

import { useTerminalInput } from "./prompt";
import type { InputKey } from "./prompt";
import { useHiddenTerminalCursor, useTerminalExtendedKeys, useTerminalFocusReporting } from "./prompt";
import SlashCommandMenu from "./SlashCommandMenu";
import type { ModelConfigSelection, ReasoningEffort } from "../settings";
import DropdownMenu from "./DropdownMenu";
import { RawModelDropdown } from "./components";

export type PromptSubmission = {
  text: string;
  imageUrls: string[];
  selectedSkills?: SkillInfo[];
  command?: "new" | "resume" | "continue" | "undo" | "mcp" | "exit" | "plan";
};

export type PromptDraft = {
  nonce: number;
  text: string;
  imageUrls: string[];
};

type Props = {
  projectRoot: string;
  skills: SkillInfo[];
  modelConfig: ModelConfigSelection;
  screenWidth: number;
  promptHistory: string[];
  busy: boolean;
  loadingText?: string | null;
  disabled?: boolean;
  placeholder?: string;
  runningProcesses?: SessionEntry["processes"];
  promptDraft?: PromptDraft | null;
  onSubmit: (submission: PromptSubmission) => void;
  onModelConfigChange: (selection: ModelConfigSelection) => string | Promise<string>;
  onRawModeChange?: (mode: string) => void;
  onInterrupt: () => void;
  onToggleProcessStdout?: () => void;
};

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
export const MODEL_COMMAND_MODELS = ["deepseek-v4-pro", "deepseek-v4-flash"] as const;

type ThinkingModeOption = {
  label: string;
  thinkingEnabled: boolean;
  reasoningEffort?: ReasoningEffort;
};

export const MODEL_COMMAND_THINKING_OPTIONS: ThinkingModeOption[] = [
  { label: "Thinking mode [max]", thinkingEnabled: true, reasoningEffort: "max" },
  { label: "Thinking mode [high]", thinkingEnabled: true, reasoningEffort: "high" },
  { label: "No thinking", thinkingEnabled: false },
];

type ModelDropdownStep = "model" | "thinking";

const PromptPrefixLine = React.memo(function PromptPrefixLine({ busy }: { busy: boolean }): React.ReactElement {
  const [spinnerIndex, setSpinnerIndex] = useState(0);

  useEffect(() => {
    if (!busy) {
      setSpinnerIndex(0);
      return;
    }
    const timer = setInterval(() => {
      setSpinnerIndex((index) => (index + 1) % SPINNER_FRAMES.length);
    }, 80);
    return () => clearInterval(timer);
  }, [busy]);

  const prefix = busy ? `${SPINNER_FRAMES[spinnerIndex]} ` : "> ";
  return <Text color={busy ? "yellow" : "#229ac3"}>{prefix}</Text>;
});

export const PromptInput = React.memo(function PromptInput({
  projectRoot,
  skills,
  modelConfig,
  screenWidth,
  promptHistory,
  busy,
  loadingText,
  disabled,
  placeholder,
  runningProcesses,
  promptDraft,
  onSubmit,
  onModelConfigChange,
  onInterrupt,
  onToggleProcessStdout,
  onRawModeChange,
}: Props): React.ReactElement {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [buffer, setBuffer] = useState<PromptBufferState>(EMPTY_BUFFER);
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [selectedSkills, setSelectedSkills] = useState<SkillInfo[]>([]);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [pendingExit, setPendingExit] = useState(false);
  const [menuIndex, setMenuIndex] = useState(0);
  const [showSkillsDropdown, setShowSkillsDropdown] = useState(false);
  const [openRawModelDropdown, setOpenRawModelDropdown] = useState(false);
  const [skillsDropdownIndex, setSkillsDropdownIndex] = useState(0);
  const [modelDropdownStep, setModelDropdownStep] = useState<ModelDropdownStep | null>(null);
  const [modelDropdownIndex, setModelDropdownIndex] = useState(0);
  const [pendingModel, setPendingModel] = useState<string | null>(null);
  const [fileMentionItems, setFileMentionItems] = useState<FileMentionItem[]>(() => scanFileMentionItems(projectRoot));
  const [fileMentionIndex, setFileMentionIndex] = useState(0);
  const [dismissedFileMentionKey, setDismissedFileMentionKey] = useState<string | null>(null);
  const [historyCursor, setHistoryCursor] = useState(-1);
  const [draftBeforeHistory, setDraftBeforeHistory] = useState<string | null>(null);
  const [hasTerminalFocus, setHasTerminalFocus] = useState(true);
  const lastCtrlDAt = React.useRef<number>(0);
  const undoRedoRef = React.useRef(createPromptUndoRedoState());
  const wasBusyRef = React.useRef(busy);
  const hadFileMentionTokenRef = React.useRef(false);
  const appliedDraftNonceRef = React.useRef<number | null>(null);

  const fileMentionToken = getCurrentFileMentionToken(buffer);
  const hasFileMentionToken = fileMentionToken !== null;
  const fileMentionKey = fileMentionToken ? `${fileMentionToken.start}:${fileMentionToken.query}` : null;
  const fileMentionMatches = React.useMemo(
    () => (fileMentionToken ? filterFileMentionItems(fileMentionItems, fileMentionToken.query) : []),
    [fileMentionItems, fileMentionToken]
  );
  const showFileMentionMenu =
    !showSkillsDropdown &&
    !modelDropdownStep &&
    fileMentionToken !== null &&
    fileMentionKey !== dismissedFileMentionKey;
  const slashItems = React.useMemo(() => buildSlashCommands(skills), [skills]);
  const slashToken = getCurrentSlashToken(buffer);
  const slashMenu = React.useMemo(
    () =>
      showSkillsDropdown || modelDropdownStep || showFileMentionMenu
        ? []
        : slashToken
          ? filterSlashCommands(slashItems, slashToken)
          : [],
    [showSkillsDropdown, modelDropdownStep, showFileMentionMenu, slashToken, slashItems]
  );
  const showMenu = slashMenu.length > 0;
  const promptHistoryKey = React.useMemo(() => promptHistory.join("\0"), [promptHistory]);
  const hasRunningProcess = runningProcesses && runningProcesses.size > 0;
  const processHint = hasRunningProcess ? " · ctrl+o view output" : "";
  const footerText = statusMessage
    ? statusMessage
    : busy
      ? loadingText && loadingText.trim()
        ? `${loadingText}${processHint}`
        : `esc to interrupt · ctrl+c to cancel input${processHint}`
      : `enter send · shift+enter newline · @ files · ctrl+v image · / commands · ctrl+d exit${processHint}`;
  useTerminalFocusReporting(stdout, !disabled);
  useTerminalExtendedKeys(stdout, !disabled);
  useHiddenTerminalCursor(stdout, !disabled);

  const refreshFileMentionItems = React.useCallback(() => {
    setFileMentionItems(scanFileMentionItems(projectRoot));
  }, [projectRoot]);

  useEffect(() => {
    refreshFileMentionItems();
  }, [refreshFileMentionItems]);

  useEffect(() => {
    if (wasBusyRef.current && !busy) {
      refreshFileMentionItems();
    }
    wasBusyRef.current = busy;
  }, [busy, refreshFileMentionItems]);

  useEffect(() => {
    if (hasFileMentionToken && !hadFileMentionTokenRef.current) {
      refreshFileMentionItems();
    }
    hadFileMentionTokenRef.current = hasFileMentionToken;
  }, [hasFileMentionToken, refreshFileMentionItems]);

  useEffect(() => {
    if (!showMenu) {
      setMenuIndex(0);
      return;
    }
    if (menuIndex >= slashMenu.length) {
      setMenuIndex(slashMenu.length - 1);
    }
  }, [slashMenu, showMenu, menuIndex]);

  useEffect(() => {
    if (!fileMentionKey) {
      setDismissedFileMentionKey(null);
    }
  }, [fileMentionKey]);

  useEffect(() => {
    if (!showFileMentionMenu) {
      setFileMentionIndex(0);
      return;
    }
    if (fileMentionIndex >= fileMentionMatches.length) {
      setFileMentionIndex(Math.max(0, fileMentionMatches.length - 1));
    }
  }, [fileMentionMatches.length, fileMentionIndex, showFileMentionMenu]);

  useEffect(() => {
    if (skillsDropdownIndex >= skills.length) {
      setSkillsDropdownIndex(Math.max(0, skills.length - 1));
    }
  }, [skills.length, skillsDropdownIndex]);

  useEffect(() => {
    if (!modelDropdownStep) {
      return;
    }
    const optionCount =
      modelDropdownStep === "model" ? MODEL_COMMAND_MODELS.length : MODEL_COMMAND_THINKING_OPTIONS.length;
    if (modelDropdownIndex >= optionCount) {
      setModelDropdownIndex(Math.max(0, optionCount - 1));
    }
  }, [modelDropdownIndex, modelDropdownStep]);

  useEffect(() => {
    if (!statusMessage) {
      return;
    }
    const timer = setTimeout(() => setStatusMessage(null), 2500);
    return () => clearTimeout(timer);
  }, [statusMessage]);

  useEffect(() => {
    if (!promptDraft || appliedDraftNonceRef.current === promptDraft.nonce) {
      return;
    }
    appliedDraftNonceRef.current = promptDraft.nonce;
    setBuffer({ text: promptDraft.text, cursor: promptDraft.text.length });
    setImageUrls(promptDraft.imageUrls);
    setSelectedSkills([]);
    setShowSkillsDropdown(false);
    setOpenRawModelDropdown(false);
    setModelDropdownStep(null);
    setHistoryCursor(-1);
    setDraftBeforeHistory(null);
    clearPromptUndoRedoState(undoRedoRef.current);
  }, [promptDraft]);

  useEffect(() => {
    setHistoryCursor(-1);
    setDraftBeforeHistory(null);
  }, [promptHistoryKey]);

  useTerminalInput(
    (input, key) => {
      if (key.focusIn) {
        setHasTerminalFocus(true);
        return;
      }
      if (key.focusOut) {
        setHasTerminalFocus(false);
        return;
      }

      if (disabled) {
        return;
      }

      if (key.escape) {
        if (modelDropdownStep) {
          closeModelDropdown();
          return;
        }
        if (showSkillsDropdown) {
          setShowSkillsDropdown(false);
          return;
        }
        if (showFileMentionMenu && fileMentionKey) {
          setDismissedFileMentionKey(fileMentionKey);
          return;
        }
        if (busy) {
          onInterrupt();
          setStatusMessage("Interrupting…");
        }
        return;
      }

      if (key.ctrl && (input === "o" || input === "O")) {
        if (runningProcesses && runningProcesses.size > 0 && onToggleProcessStdout) {
          onToggleProcessStdout();
        } else {
          setStatusMessage("No running process to inspect");
        }
        return;
      }

      if (key.ctrl && (input === "d" || input === "D")) {
        if (!isEmpty(buffer)) {
          updateBuffer((s) => deleteForward(s));
          return;
        }
        const now = Date.now();
        if (pendingExit && now - lastCtrlDAt.current < 2000) {
          exit();
          return;
        }
        lastCtrlDAt.current = now;
        setPendingExit(true);
        setStatusMessage("press ctrl+d again to exit");
        return;
      }

      if (key.ctrl && (input === "c" || input === "C")) {
        if (busy) {
          onInterrupt();
          setStatusMessage("Interrupting…");
        } else if (!isEmpty(buffer)) {
          setBuffer(EMPTY_BUFFER);
          clearUndoRedoStacks();
        } else {
          setStatusMessage("press ctrl+d to exit");
        }
        return;
      }

      if (pendingExit && (!key.ctrl || (input !== "d" && input !== "D"))) {
        setPendingExit(false);
      }

      if (openRawModelDropdown) {
        return;
      }

      if (historyCursor !== -1 && !key.upArrow && !key.downArrow) {
        exitHistoryBrowsing();
      }

      if (showSkillsDropdown) {
        if (skills.length === 0) {
          setShowSkillsDropdown(false);
        } else {
          if (key.upArrow) {
            setSkillsDropdownIndex((idx) => (idx - 1 + skills.length) % skills.length);
            return;
          }
          if (key.downArrow) {
            setSkillsDropdownIndex((idx) => (idx + 1) % skills.length);
            return;
          }
          if ((input === " " && !key.ctrl && !key.meta) || (key.return && !key.shift && !key.meta)) {
            const skill = skills[skillsDropdownIndex];
            if (skill) {
              toggleSelectedSkill(skill);
            }
            return;
          }
          if (key.tab) {
            setShowSkillsDropdown(false);
            return;
          }
        }
      }

      if (modelDropdownStep) {
        const optionCount =
          modelDropdownStep === "model" ? MODEL_COMMAND_MODELS.length : MODEL_COMMAND_THINKING_OPTIONS.length;
        if (key.upArrow) {
          setModelDropdownIndex((idx) => (idx - 1 + optionCount) % optionCount);
          return;
        }
        if (key.downArrow) {
          setModelDropdownIndex((idx) => (idx + 1) % optionCount);
          return;
        }
        if ((input === " " && !key.ctrl && !key.meta) || (key.return && !key.shift && !key.meta)) {
          selectModelDropdownItem();
          return;
        }
        if (key.tab) {
          closeModelDropdown();
          return;
        }
      }

      if (key.ctrl && (input === "v" || input === "V")) {
        setStatusMessage("Reading clipboard...");
        readClipboardImageAsync()
          .then((image) => {
            if (image) {
              setImageUrls((prev) => [...prev, image.dataUrl]);
              setStatusMessage("Attached image from clipboard");
            } else {
              setStatusMessage("No image found in clipboard");
            }
          })
          .catch(() => {
            setStatusMessage("Failed to read clipboard");
          });
        return;
      }

      if (isClearImageAttachmentsShortcut(input, key)) {
        if (imageUrls.length > 0) {
          setImageUrls([]);
          setStatusMessage("Cleared attached images");
        } else {
          setStatusMessage("No attached images to clear");
        }
        return;
      }

      const noModifier = !key.shift && !key.ctrl && !key.meta;
      const returnAction = getPromptReturnKeyAction(key);
      const isPlainReturn = returnAction === "submit";

      if (showFileMentionMenu) {
        if (key.upArrow) {
          if (fileMentionMatches.length > 0) {
            setFileMentionIndex((idx) => (idx - 1 + fileMentionMatches.length) % fileMentionMatches.length);
          }
          return;
        }
        if (key.downArrow) {
          if (fileMentionMatches.length > 0) {
            setFileMentionIndex((idx) => (idx + 1) % fileMentionMatches.length);
          }
          return;
        }
        if (key.tab || returnAction === "submit") {
          const selected = fileMentionMatches[fileMentionIndex];
          if (selected && fileMentionToken) {
            insertFileMentionSelection(selected);
            return;
          }
          if (key.tab) {
            setDismissedFileMentionKey(fileMentionKey);
            return;
          }
          if (fileMentionKey) {
            setDismissedFileMentionKey(fileMentionKey);
          }
        }
      }

      if (showMenu) {
        if (key.upArrow) {
          setMenuIndex((idx) => (idx - 1 + slashMenu.length) % slashMenu.length);
          return;
        }
        if (key.downArrow) {
          setMenuIndex((idx) => (idx + 1) % slashMenu.length);
          return;
        }
        if (key.tab || returnAction === "submit") {
          const selected = slashMenu[menuIndex];
          if (selected) {
            handleSlashSelection(selected);
            return;
          }
        }
      }

      if (busy && isPlainReturn) {
        setStatusMessage("wait for the current response or press esc to interrupt");
        return;
      }

      if (returnAction === "newline") {
        updateBuffer((s) => insertText(s, "\n"));
        return;
      }

      if (returnAction === "submit") {
        submitCurrentBuffer();
        return;
      }

      if (key.delete) {
        updateBuffer((s) => deleteForward(s));
        return;
      }

      if (key.backspace) {
        updateBuffer((s) => backspace(s));
        return;
      }

      if ((key.ctrl || key.meta) && key.leftArrow) {
        updateBuffer((s) => moveWordLeft(s));
        return;
      }

      if ((key.ctrl || key.meta) && key.rightArrow) {
        updateBuffer((s) => moveWordRight(s));
        return;
      }

      if (key.leftArrow) {
        updateBuffer((s) => moveLeft(s));
        return;
      }

      if (key.rightArrow) {
        updateBuffer((s) => moveRight(s));
        return;
      }

      if (key.home) {
        updateBuffer((s) => moveLineStart(s));
        return;
      }

      if (key.end) {
        updateBuffer((s) => moveLineEnd(s));
        return;
      }

      if (key.upArrow) {
        if (noModifier && (historyCursor !== -1 || buffer.cursor === 0) && promptHistory.length > 0) {
          navigateHistory(-1);
          return;
        }
        updateBuffer((s) => moveUp(s));
        return;
      }

      if (key.downArrow) {
        if (noModifier && (historyCursor !== -1 || buffer.cursor === buffer.text.length)) {
          navigateHistory(1);
          return;
        }
        updateBuffer((s) => moveDown(s));
        return;
      }

      if (key.ctrl && (input === "p" || input === "P")) {
        navigateHistory(-1);
        return;
      }
      if (key.ctrl && (input === "n" || input === "N")) {
        navigateHistory(1);
        return;
      }
      if (key.ctrl && (input === "a" || input === "A")) {
        updateBuffer((s) => moveLineStart(s));
        return;
      }
      if (key.ctrl && (input === "e" || input === "E")) {
        updateBuffer((s) => moveLineEnd(s));
        return;
      }
      if (key.ctrl && (input === "b" || input === "B")) {
        updateBuffer((s) => moveLeft(s));
        return;
      }
      if (key.ctrl && (input === "f" || input === "F")) {
        updateBuffer((s) => moveRight(s));
        return;
      }
      if (key.meta && (input === "b" || input === "B")) {
        updateBuffer((s) => moveWordLeft(s));
        return;
      }
      if (key.meta && (input === "f" || input === "F")) {
        updateBuffer((s) => moveWordRight(s));
        return;
      }
      if (key.ctrl && (input === "k" || input === "K")) {
        updateBuffer((s) => killLine(s));
        return;
      }
      if (key.ctrl && (input === "u" || input === "U")) {
        updateBuffer(() => EMPTY_BUFFER);
        return;
      }
      if (key.ctrl && (input === "w" || input === "W")) {
        updateBuffer((s) => deleteWordBefore(s));
        return;
      }
      if (key.meta && (input === "d" || input === "D")) {
        updateBuffer((s) => deleteWordAfter(s));
        return;
      }
      if (key.meta && (input === "\u007F" || input === "\b")) {
        updateBuffer((s) => deleteWordBefore(s));
        return;
      }
      if (key.ctrl && (input === "j" || input === "J")) {
        updateBuffer((s) => insertText(s, "\n"));
        return;
      }
      if (key.ctrl && key.shift && input === "-") {
        redo();
        return;
      }
      if (key.ctrl && input === "-") {
        undo();
        return;
      }
      if (input.startsWith("\u001B")) {
        // Unhandled escape sequence (e.g. function keys); ignore to avoid inserting garbage.
        return;
      }

      if (input && !key.ctrl && !key.meta) {
        // Normalize line endings from paste: \r\n (Windows) → \n, \r (old macOS/Enter) → \n.
        // This preserves multi-line formatting when the user pastes content.
        const sanitized = input.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
        updateBuffer((s) => insertText(s, sanitized));
      }
    },
    { isActive: !disabled }
  );

  function undo(): void {
    const previous = undoPromptEdit(undoRedoRef.current, buffer);
    if (!previous) {
      return;
    }
    exitHistoryBrowsing();
    setBuffer(previous);
  }

  function redo(): void {
    const next = redoPromptEdit(undoRedoRef.current, buffer);
    if (!next) {
      return;
    }
    exitHistoryBrowsing();
    setBuffer(next);
  }

  function clearUndoRedoStacks(): void {
    clearPromptUndoRedoState(undoRedoRef.current);
  }

  function exitHistoryBrowsing(): void {
    setHistoryCursor(-1);
    setDraftBeforeHistory(null);
  }

  function updateBuffer(updater: (state: PromptBufferState) => PromptBufferState): void {
    exitHistoryBrowsing();
    setBuffer((current) => {
      const next = updater(current);
      recordPromptEdit(undoRedoRef.current, current, next);
      return next;
    });
  }

  function navigateHistory(direction: -1 | 1): void {
    if (promptHistory.length === 0) {
      return;
    }

    const previousCursor = historyCursor === -1 ? promptHistory.length : historyCursor;
    const nextCursor = Math.max(0, Math.min(promptHistory.length, previousCursor + direction));
    const draft = historyCursor === -1 ? buffer.text : draftBeforeHistory;

    if (historyCursor === -1) {
      setDraftBeforeHistory(buffer.text);
    }

    if (nextCursor === promptHistory.length) {
      const text = draft ?? "";
      setBuffer({ text, cursor: text.length });
      setHistoryCursor(-1);
      setDraftBeforeHistory(null);
      return;
    }

    const text = promptHistory[nextCursor] ?? "";
    setBuffer({ text, cursor: text.length });
    setHistoryCursor(nextCursor);
  }

  function insertFileMentionSelection(item: FileMentionItem): void {
    if (!fileMentionToken) {
      return;
    }
    updateBuffer((state) => replaceCurrentFileMentionToken(state, fileMentionToken, item.path));
    setDismissedFileMentionKey(null);
  }

  function handleSlashSelection(item: SlashCommandItem): void {
    if (busy && item.kind !== "exit") {
      setStatusMessage("wait for the current response or press esc to interrupt");
      return;
    }

    if (item.kind === "skill" && item.skill) {
      addSelectedSkill(item.skill);
      clearSlashToken();
      setShowSkillsDropdown(false);
      return;
    }
    if (item.kind === "skills") {
      clearSlashToken();
      setShowSkillsDropdown(true);
      return;
    }
    if (item.kind === "model") {
      clearSlashToken();
      openModelDropdown();
      return;
    }
    if (item.kind === "raw") {
      clearSlashToken();
      setOpenRawModelDropdown(true);
      return;
    }
    if (item.kind === "new") {
      onSubmit({ text: "", imageUrls: [], command: "new" });
      setBuffer(EMPTY_BUFFER);
      clearUndoRedoStacks();
      setImageUrls([]);
      setSelectedSkills([]);
      setShowSkillsDropdown(false);
      return;
    }
    if (item.kind === "init") {
      onSubmit(buildInitPromptSubmission(selectedSkills));
      setBuffer(EMPTY_BUFFER);
      clearUndoRedoStacks();
      setImageUrls([]);
      setSelectedSkills([]);
      setShowSkillsDropdown(false);
      return;
    }
    if (item.kind === "resume") {
      onSubmit({ text: "", imageUrls: [], command: "resume" });
      setBuffer(EMPTY_BUFFER);
      clearUndoRedoStacks();
      setImageUrls([]);
      setSelectedSkills([]);
      setShowSkillsDropdown(false);
      return;
    }
    if (item.kind === "continue") {
      onSubmit({ text: "/continue", imageUrls: [], command: "continue" });
      setBuffer(EMPTY_BUFFER);
      clearUndoRedoStacks();
      setImageUrls([]);
      setSelectedSkills([]);
      setShowSkillsDropdown(false);
      return;
    }
    if (item.kind === "undo") {
      onSubmit({ text: "/undo", imageUrls: [], command: "undo" });
      setBuffer(EMPTY_BUFFER);
      clearUndoRedoStacks();
      setImageUrls([]);
      setSelectedSkills([]);
      setShowSkillsDropdown(false);
      return;
    }
    if (item.kind === "mcp") {
      onSubmit({ text: "/mcp", imageUrls: [], command: "mcp" });
      setBuffer(EMPTY_BUFFER);
      clearUndoRedoStacks();
      setImageUrls([]);
      setSelectedSkills([]);
      setShowSkillsDropdown(false);
      return;
    }
    if (item.kind === "plan") {
      const planPrefix = "/plan";
      const planDescription = buffer.text.startsWith(planPrefix) ? buffer.text.slice(planPrefix.length).trim() : "";
      onSubmit({ text: planDescription, imageUrls: [], command: "plan" });
      setBuffer(EMPTY_BUFFER);
      clearUndoRedoStacks();
      setImageUrls([]);
      setSelectedSkills([]);
      setShowSkillsDropdown(false);
      return;
    }
    if (item.kind === "exit") {
      onSubmit({ text: "/exit", imageUrls: [], command: "exit" });
      setBuffer(EMPTY_BUFFER);
      clearUndoRedoStacks();
      return;
    }
  }

  function submitCurrentBuffer(): void {
    if (busy) {
      setStatusMessage("wait for the current response or press esc to interrupt");
      return;
    }

    const trimmed = buffer.text.trim();
    if (!trimmed && imageUrls.length === 0 && selectedSkills.length === 0) {
      return;
    }

    if (trimmed.startsWith("/")) {
      const exactMatch = findExactSlashCommand(slashItems, trimmed.split(/\s+/, 1)[0]);
      if (exactMatch) {
        handleSlashSelection(exactMatch);
        return;
      }
    }

    onSubmit({
      text: buffer.text,
      imageUrls,
      selectedSkills,
    });
    setBuffer(EMPTY_BUFFER);
    clearUndoRedoStacks();
    setImageUrls([]);
    setSelectedSkills([]);
    setShowSkillsDropdown(false);
  }

  function addSelectedSkill(skill: SkillInfo): void {
    setSelectedSkills((prev) => addUniqueSkill(prev, skill));
  }

  function toggleSelectedSkill(skill: SkillInfo): void {
    setSelectedSkills((prev) => toggleSkillSelection(prev, skill));
  }

  function clearSlashToken(): void {
    exitHistoryBrowsing();
    setBuffer((state) => removeCurrentSlashToken(state));
    clearUndoRedoStacks();
  }

  function openModelDropdown(): void {
    const currentModelIndex = MODEL_COMMAND_MODELS.findIndex((model) => model === modelConfig.model);
    setPendingModel(null);
    setModelDropdownStep("model");
    setModelDropdownIndex(currentModelIndex >= 0 ? currentModelIndex : 0);
    setShowSkillsDropdown(false);
  }

  function closeModelDropdown(): void {
    setModelDropdownStep(null);
    setPendingModel(null);
  }

  function selectModelDropdownItem(): void {
    if (modelDropdownStep === "model") {
      const model = MODEL_COMMAND_MODELS[modelDropdownIndex] ?? modelConfig.model;
      setPendingModel(model);
      setModelDropdownStep("thinking");
      setModelDropdownIndex(getThinkingOptionIndex(modelConfig));
      return;
    }

    const option = MODEL_COMMAND_THINKING_OPTIONS[modelDropdownIndex] ?? MODEL_COMMAND_THINKING_OPTIONS[0];
    const selection: ModelConfigSelection = {
      model: pendingModel ?? modelConfig.model,
      thinkingEnabled: option.thinkingEnabled,
      reasoningEffort: option.reasoningEffort ?? modelConfig.reasoningEffort,
    };
    closeModelDropdown();
    Promise.resolve(onModelConfigChange(selection))
      .then((message) => {
        if (message) {
          setStatusMessage(message);
        }
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        setStatusMessage(`Failed to update model settings: ${message}`);
      });
  }

  const modelDropdownItems =
    modelDropdownStep === "model"
      ? MODEL_COMMAND_MODELS.map((model) => ({
          label: model,
          selected: model === (pendingModel ?? modelConfig.model),
          description: model === modelConfig.model ? "current model" : "",
        }))
      : MODEL_COMMAND_THINKING_OPTIONS.map((option) => ({
          label: option.label,
          selected: getThinkingOptionIndex(modelConfig) === MODEL_COMMAND_THINKING_OPTIONS.indexOf(option),
          description: option.thinkingEnabled ? `reasoningEffort: ${option.reasoningEffort}` : "thinking disabled",
        }));

  const showFooterText = useMemo(
    () => showMenu || showSkillsDropdown || openRawModelDropdown || modelDropdownStep !== null || showFileMentionMenu,
    [showMenu, showSkillsDropdown, modelDropdownStep, openRawModelDropdown, showFileMentionMenu]
  );

  const matchedCommand = slashToken ? findExactSlashCommand(slashItems, slashToken) : null;
  const inlineHint = matchedCommand?.args ? ` ${matchedCommand.args.join(ARGS_SEPARATOR)}` : "";

  return (
    <Box flexDirection="column" width={screenWidth}>
      {imageUrls.length > 0 ? (
        <Box>
          <Text color="magenta">{formatImageAttachmentStatus(imageUrls.length)}</Text>
          <Text dimColor>{` (${IMAGE_ATTACHMENT_CLEAR_HINT})`}</Text>
        </Box>
      ) : null}
      {selectedSkills.length > 0 ? (
        <Box>
          <Text color="magenta" wrap="truncate-end">
            {formatSelectedSkillsStatus(selectedSkills)}
          </Text>
          <Text dimColor> (use /skills to edit)</Text>
        </Box>
      ) : null}
      {/* Input */}
      <Box
        borderStyle="single"
        borderTop={true}
        borderBottom={true}
        borderLeft={false}
        borderRight={false}
        borderDimColor
      >
        <PromptPrefixLine busy={busy} />
        <Text>{renderBufferWithCursor(buffer, !disabled && hasTerminalFocus, placeholder)}</Text>
        {inlineHint ? <Text dimColor>{inlineHint}</Text> : null}
      </Box>
      <RawModelDropdown
        open={openRawModelDropdown}
        onClose={setOpenRawModelDropdown}
        onSelect={(mode) => onRawModeChange?.(mode)}
        screenWidth={screenWidth}
      />
      {showSkillsDropdown ? (
        <DropdownMenu
          width={screenWidth}
          title="Select Skills"
          helpText="Space toggle · Enter toggle · Esc to close"
          emptyText="No skills found"
          items={skills.map((skill) => ({
            key: skill.path || skill.name,
            label: skill.name,
            description: skill.path,
            selected: isSkillSelected(selectedSkills, skill),
            statusIndicator: skill.isLoaded ? { symbol: "✓", color: "green" } : undefined,
          }))}
          activeIndex={skillsDropdownIndex}
          activeColor="#229ac3"
          maxVisible={6}
        />
      ) : null}
      {modelDropdownStep ? (
        <DropdownMenu
          width={screenWidth}
          title={modelDropdownStep === "model" ? "Select Model" : "Select Thinking Mode"}
          helpText={
            modelDropdownStep === "model"
              ? "Space/Enter select model · Esc to cancel"
              : "Space/Enter apply · Esc to cancel"
          }
          items={modelDropdownItems.map((item) => ({
            key: item.label,
            label: item.label,
            description: item.description,
            selected: item.selected,
          }))}
          activeIndex={modelDropdownIndex}
          activeColor="#229ac3"
          maxVisible={6}
        />
      ) : null}
      {showFileMentionMenu ? (
        <DropdownMenu
          width={screenWidth}
          title="Mention File"
          helpText="Enter/Tab insert · Esc close"
          emptyText={fileMentionToken?.query ? "No matching files" : "Type after @ to search files"}
          items={fileMentionMatches.map((item) => ({
            key: item.path,
            label: item.path,
            description: item.type === "directory" ? "directory" : "file",
          }))}
          activeIndex={fileMentionIndex}
          activeColor="#229ac3"
          maxVisible={8}
          renderItem={(item, isActive) => (
            <Box flexDirection="row" paddingX={1} gap={1}>
              <Text color={isActive ? "#229ac3" : undefined}>{isActive ? "> " : "  "}</Text>
              <Box flexGrow={1}>
                <Text color={isActive ? "#229ac3" : undefined} wrap="truncate-end" bold={isActive}>
                  {item.label}
                </Text>
              </Box>
              {item.description ? (
                <Box width={10} flexShrink={0}>
                  <Text dimColor>{item.description}</Text>
                </Box>
              ) : null}
            </Box>
          )}
        />
      ) : null}
      <SlashCommandMenu width={screenWidth} items={slashMenu} activeIndex={menuIndex} />
      {!showFooterText && (
        <Box>
          <Text dimColor>{footerText}</Text>
        </Box>
      )}
    </Box>
  );
});

export const IMAGE_ATTACHMENT_CLEAR_HINT = "ctrl+x clear images";

export function formatImageAttachmentStatus(count: number): string {
  if (count <= 0) {
    return "";
  }
  return `📎 ${count} image${count === 1 ? "" : "s"} attached`;
}

export function formatSelectedSkillsStatus(skills: SkillInfo[]): string {
  const names = skills.map((skill) => skill.name).filter(Boolean);
  if (names.length === 0) {
    return "";
  }
  return `⚡ ${names.join(", ")}`;
}

export function isSkillSelected(skills: SkillInfo[], skill: SkillInfo): boolean {
  return skills.some((item) => item.name === skill.name);
}

export function addUniqueSkill(skills: SkillInfo[], skill: SkillInfo): SkillInfo[] {
  if (isSkillSelected(skills, skill)) {
    return skills;
  }
  return [...skills, skill];
}

export function toggleSkillSelection(skills: SkillInfo[], skill: SkillInfo): SkillInfo[] {
  return isSkillSelected(skills, skill) ? skills.filter((item) => item.name !== skill.name) : [...skills, skill];
}

export function buildInitPromptSubmission(selectedSkills: SkillInfo[]): PromptSubmission {
  return {
    text: "/init",
    imageUrls: [],
    selectedSkills: selectedSkills.length > 0 ? selectedSkills : undefined,
  };
}

export function getThinkingOptionIndex(
  config: Pick<ModelConfigSelection, "thinkingEnabled" | "reasoningEffort">
): number {
  const index = MODEL_COMMAND_THINKING_OPTIONS.findIndex((option) => {
    if (!config.thinkingEnabled) {
      return !option.thinkingEnabled;
    }
    return option.thinkingEnabled && option.reasoningEffort === config.reasoningEffort;
  });
  return index >= 0 ? index : 0;
}

export function removeCurrentSlashToken(state: PromptBufferState): PromptBufferState {
  let start = state.cursor;
  while (start > 0 && !/\s/.test(state.text[start - 1] ?? "")) {
    start -= 1;
  }

  const token = state.text.slice(start, state.cursor);
  if (!token.startsWith("/")) {
    return state;
  }

  const text = `${state.text.slice(0, start)}${state.text.slice(state.cursor)}`;
  return { text, cursor: start };
}

export function isClearImageAttachmentsShortcut(input: string, key: Pick<InputKey, "ctrl">): boolean {
  return key.ctrl && (input === "x" || input === "X");
}

export type PromptReturnKeyAction = "submit" | "newline" | null;

export function getPromptReturnKeyAction(key: Pick<InputKey, "return" | "shift" | "meta">): PromptReturnKeyAction {
  if (!key.return) {
    return null;
  }
  if (key.shift || key.meta) {
    return "newline";
  }
  return "submit";
}

export function renderBufferWithCursor(state: PromptBufferState, isFocused: boolean, placeholder?: string): string {
  const text = state.text || "";
  const cursor = Math.max(0, Math.min(state.cursor, text.length));
  const before = text.slice(0, cursor);
  const at = text[cursor];
  const after = text.slice(cursor + 1);

  if (text.length === 0 && placeholder) {
    if (!isFocused) {
      return chalk.dim(`  ${placeholder}`);
    }
    return renderCursorCell(" ") + chalk.dim(` ${placeholder}`);
  }

  if (!isFocused) {
    return text.endsWith("\n") ? `${text} ` : text;
  }

  if (typeof at === "undefined") {
    return before + renderCursorCell(" ");
  }
  if (at === "\n") {
    return before + renderCursorCell(" ") + "\n" + after;
  }
  return before + renderCursorCell(at) + after;
}

// Use explicit ANSI instead of chalk.inverse so cursor rendering stays enabled
// in non-TTY environments such as tests, where Chalk may strip styling.
function renderCursorCell(value: string): string {
  return `\u001B[7m${value}\u001B[27m`;
}
