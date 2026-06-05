import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useApp, useStdout } from "ink";
import chalk from "chalk";
import { useTheme } from "../theme";
import { useAppContext } from "../contexts";
import { ARGS_SEPARATOR } from "../constants";
import {
  EMPTY_BUFFER,
  PASTE_MARKER_REGEX,
  backspace,
  deleteForward,
  deletePasteMarkerBackward,
  deletePasteMarkerForward,
  deleteWordBefore,
  deleteWordAfter,
  expandPasteMarkers,
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
} from "../core/prompt-buffer";
import type { PromptBufferState } from "../core/prompt-buffer";
import {
  clearPromptUndoRedoState,
  createPromptUndoRedoState,
  recordPromptEdit,
  redoPromptEdit,
  undoPromptEdit,
} from "../core/prompt-undo-redo";
import { buildSlashCommands, filterSlashCommands, findExactSlashCommand } from "../core/slash-commands";
import type { SlashCommandItem } from "../core/slash-commands";
import {
  filterFileMentionItems,
  getCurrentFileMentionToken,
  replaceCurrentFileMentionToken,
  scanFileMentionItems,
} from "../core/file-mentions";
import type { FileMentionItem } from "../core/file-mentions";
import { readClipboardImageAsync } from "../core/clipboard";
import {
  useTerminalInput,
  usePasteHandling,
  useHistoryNavigation,
  getPromptCursorPlacement,
  usePromptTerminalCursor,
} from "../hooks";
import type { InputKey } from "../hooks";
import {
  useHiddenTerminalCursor,
  useTerminalExtendedKeys,
  useBracketedPaste,
  useTerminalFocusReporting,
} from "../hooks";
import SlashCommandMenu, { isSkillSelected } from "./SlashCommandMenu";
import type { ModelConfigSelection, PermissionScope } from "../../settings";
import { FileMentionMenu, ModelsDropdown, RawModelDropdown, SkillsDropdown, ThemeDropdown } from "../components";
import type { SessionEntry, SkillInfo } from "../../session";
import type { UserToolPermission } from "../../common/permissions";
import type { ThemePreset } from "../theme";

export type PromptSubmission = {
  text: string;
  imageUrls: string[];
  selectedSkills?: SkillInfo[];
  permissions?: UserToolPermission[];
  alwaysAllows?: PermissionScope[];
  command?: "new" | "resume" | "continue" | "undo" | "mcp" | "exit";
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
  currentPreset: ThemePreset;
  onSubmit: (submission: PromptSubmission) => void;
  onModelConfigChange: (selection: ModelConfigSelection) => string | Promise<string>;
  onRawModeChange?: (mode: string) => void;
  onInterrupt: () => void;
  onToggleProcessStdout?: () => void;
  onThemePreview?: (preset: ThemePreset) => void;
  onThemeRevert?: () => void;
  onThemeChange?: (preset: ThemePreset) => void;
};

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

const PromptPrefixLine = React.memo(function PromptPrefixLine({ busy }: { busy: boolean }): React.ReactElement {
  const [spinnerIndex, setSpinnerIndex] = useState(0);
  const theme = useTheme();

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
  return (
    <Box width={2}>
      <Text color={busy ? theme.status.warning : theme.brand.accent}>{prefix}</Text>
    </Box>
  );
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
  currentPreset,
  onSubmit,
  onModelConfigChange,
  onInterrupt,
  onToggleProcessStdout,
  onRawModeChange,
  onThemePreview,
  onThemeRevert,
  onThemeChange,
}: Props): React.ReactElement {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const theme = useTheme();
  const { switchTheme, hasCustomThemeConfig } = useAppContext();
  const [buffer, setBuffer] = useState<PromptBufferState>(EMPTY_BUFFER);
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [selectedSkills, setSelectedSkills] = useState<SkillInfo[]>([]);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [pendingExit, setPendingExit] = useState(false);
  const [menuIndex, setMenuIndex] = useState(0);
  const [showSkillsDropdown, setShowSkillsDropdown] = useState(false);
  const [openRawModelDropdown, setOpenRawModelDropdown] = useState(false);
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [showThemeDropdown, setShowThemeDropdown] = useState(false);
  const [fileMentionItems, setFileMentionItems] = useState<FileMentionItem[]>(() => scanFileMentionItems(projectRoot));
  const [dismissedFileMentionKey, setDismissedFileMentionKey] = useState<string | null>(null);
  const [hasTerminalFocus, setHasTerminalFocus] = useState(true);
  const lastCtrlDAt = React.useRef<number>(0);
  const undoRedoRef = React.useRef(createPromptUndoRedoState());
  const wasBusyRef = React.useRef(busy);
  const hadFileMentionTokenRef = React.useRef(false);
  const appliedDraftNonceRef = React.useRef<number | null>(null);

  const { historyCursor, navigateHistory, exitHistoryBrowsing } = useHistoryNavigation(
    buffer,
    setBuffer,
    promptHistory
  );

  const { pastesRef, handlePaste, expandPasteMarkerAtCursor, resetPastes, hasCollapsedMarkers, hasExpandedRegions } =
    usePasteHandling(buffer, updateBuffer, setStatusMessage);

  const fileMentionToken = getCurrentFileMentionToken(buffer);
  const hasFileMentionToken = fileMentionToken !== null;
  const fileMentionKey = fileMentionToken ? `${fileMentionToken.start}:${fileMentionToken.query}` : null;
  const fileMentionMatches = React.useMemo(
    () => (fileMentionToken ? filterFileMentionItems(fileMentionItems, fileMentionToken.query) : []),
    [fileMentionItems, fileMentionToken]
  );
  const showFileMentionMenu =
    !showSkillsDropdown &&
    !showModelDropdown &&
    !showThemeDropdown &&
    fileMentionToken !== null &&
    fileMentionKey !== dismissedFileMentionKey;
  const slashItems = React.useMemo(() => buildSlashCommands(skills), [skills]);
  const slashToken = getCurrentSlashToken(buffer);
  const slashMenu = React.useMemo(
    () =>
      showSkillsDropdown || showModelDropdown || showThemeDropdown || showFileMentionMenu
        ? []
        : slashToken
          ? filterSlashCommands(slashItems, slashToken)
          : [],
    [showSkillsDropdown, showModelDropdown, showThemeDropdown, showFileMentionMenu, slashToken, slashItems]
  );
  const showMenu = slashMenu.length > 0;
  const promptHistoryKey = React.useMemo(() => promptHistory.join("\0"), [promptHistory]);
  const hasRunningProcess = runningProcesses && runningProcesses.size > 0;
  const processOrPasteHint = hasRunningProcess
    ? " · ctrl+o view output"
    : hasCollapsedMarkers
      ? " · ctrl+o expand"
      : hasExpandedRegions
        ? " · ctrl+o collapse"
        : "";
  const footerText = statusMessage
    ? statusMessage
    : busy
      ? loadingText && loadingText.trim()
        ? `${loadingText}${processOrPasteHint}`
        : `esc to interrupt · ctrl+c to cancel input${processOrPasteHint}`
      : `enter send · shift+enter newline · @ files · ctrl+v image · / commands · ctrl+d exit${processOrPasteHint}`;

  const showFooterText = useMemo(
    () =>
      showMenu ||
      showSkillsDropdown ||
      openRawModelDropdown ||
      showModelDropdown ||
      showThemeDropdown ||
      showFileMentionMenu,
    [showMenu, showSkillsDropdown, showModelDropdown, openRawModelDropdown, showThemeDropdown, showFileMentionMenu]
  );

  const cursorPlacement = useMemo(
    () => getPromptCursorPlacement(buffer, screenWidth, 2, footerText),
    [buffer, footerText, screenWidth]
  );
  const usePositionedCursor = !disabled && hasTerminalFocus && !showFooterText;
  useTerminalFocusReporting(stdout, !disabled);
  useTerminalExtendedKeys(stdout, !disabled);
  useBracketedPaste(stdout, !disabled);
  usePromptTerminalCursor(stdout, cursorPlacement, usePositionedCursor);
  useHiddenTerminalCursor(stdout, !disabled && !usePositionedCursor);

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
    exitHistoryBrowsing();
    clearPromptUndoRedoState(undoRedoRef.current);
    resetPastes();
  }, [promptDraft, exitHistoryBrowsing, resetPastes]);

  useEffect(() => {
    exitHistoryBrowsing();
  }, [promptHistoryKey, exitHistoryBrowsing]);

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
        if (showFileMentionMenu) {
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
          expandPasteMarkerAtCursor();
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
          resetPastes();
        } else {
          setStatusMessage("press ctrl+d to exit");
        }
        return;
      }

      if (pendingExit && (!key.ctrl || (input !== "d" && input !== "D"))) {
        setPendingExit(false);
      }

      if (openRawModelDropdown || showSkillsDropdown || showModelDropdown || showThemeDropdown) {
        return;
      }

      if (historyCursor !== -1 && !key.upArrow && !key.downArrow) {
        exitHistoryBrowsing();
      }

      if (key.paste) {
        handlePaste(input);
        return;
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
        if (key.upArrow || key.downArrow || key.tab || returnAction === "submit") {
          return;
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
        updateBuffer((s) => deletePasteMarkerForward(s, pastesRef.current) ?? deleteForward(s));
        return;
      }

      if (key.backspace) {
        updateBuffer((s) => deletePasteMarkerBackward(s, pastesRef.current) ?? backspace(s));
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
        resetPastes();
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

  function updateBuffer(updater: (state: PromptBufferState) => PromptBufferState): void {
    exitHistoryBrowsing();
    setBuffer((current) => {
      const next = updater(current);
      recordPromptEdit(undoRedoRef.current, current, next);
      return next;
    });
  }

  function insertFileMentionSelection(item: FileMentionItem): void {
    if (!fileMentionToken) {
      return;
    }
    updateBuffer((state) => replaceCurrentFileMentionToken(state, fileMentionToken, item.path));
    setDismissedFileMentionKey(null);
  }

  function resetPromptInput(): void {
    setBuffer(EMPTY_BUFFER);
    clearUndoRedoStacks();
    setImageUrls([]);
    setSelectedSkills([]);
    setShowSkillsDropdown(false);
    exitHistoryBrowsing();
    resetPastes();
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
      setShowSkillsDropdown(false);
      setShowModelDropdown(true);
      return;
    }
    if (item.kind === "raw") {
      clearSlashToken();
      setOpenRawModelDropdown(true);
      return;
    }
    if (item.kind === "theme") {
      clearSlashToken();
      setShowSkillsDropdown(false);
      setShowThemeDropdown(true);
      return;
    }
    if (item.kind === "new") {
      onSubmit({ text: "", imageUrls: [], command: "new" });
      resetPromptInput();
      return;
    }
    if (item.kind === "init") {
      onSubmit(buildInitPromptSubmission(selectedSkills));
      resetPromptInput();
      return;
    }
    if (item.kind === "resume") {
      onSubmit({ text: "", imageUrls: [], command: "resume" });
      resetPromptInput();
      return;
    }
    if (item.kind === "continue") {
      onSubmit({ text: "/continue", imageUrls: [], command: "continue" });
      resetPromptInput();
      return;
    }
    if (item.kind === "undo") {
      onSubmit({ text: "/undo", imageUrls: [], command: "undo" });
      resetPromptInput();
      return;
    }
    if (item.kind === "mcp") {
      onSubmit({ text: "/mcp", imageUrls: [], command: "mcp" });
      resetPromptInput();
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
      text: expandPasteMarkers(buffer.text, pastesRef.current),
      imageUrls,
      selectedSkills,
    });
    resetPromptInput();
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

  const isFocused = useMemo(() => !disabled && hasTerminalFocus, [disabled, hasTerminalFocus]);

  const matchedCommand = slashToken ? findExactSlashCommand(slashItems, slashToken) : null;
  const inlineHint = matchedCommand?.args ? ` ${matchedCommand.args.join(ARGS_SEPARATOR)}` : "";

  return (
    <Box flexDirection="column" width={screenWidth}>
      {imageUrls.length > 0 ? (
        <Box marginLeft={2}>
          <Text color={theme.status.info}>{formatImageAttachmentStatus(imageUrls.length)}</Text>
          <Text dimColor>{` (${IMAGE_ATTACHMENT_CLEAR_HINT})`}</Text>
        </Box>
      ) : null}
      {selectedSkills.length > 0 ? (
        <Box marginLeft={2}>
          <Text color={theme.status.info} wrap="truncate-end">
            {formatSelectedSkillsStatus(selectedSkills)}
          </Text>
          <Text dimColor> (use /skills to edit)</Text>
        </Box>
      ) : null}
      {/* Input */}
      <Box
        width={screenWidth}
        borderStyle="single"
        borderTop={true}
        borderBottom={true}
        borderLeft={false}
        borderRight={false}
        borderColor={isFocused ? theme.brand.accent : theme.border.default}
      >
        <PromptPrefixLine busy={busy} />
        <Box flexGrow={1} flexShrink={1} width={screenWidth - 2}>
          <Text>{renderBufferWithCursor(buffer, isFocused, placeholder, pastesRef.current, theme.status.warning)}</Text>
          {inlineHint ? <Text dimColor>{inlineHint}</Text> : null}
        </Box>
      </Box>
      <RawModelDropdown
        open={openRawModelDropdown}
        onClose={setOpenRawModelDropdown}
        onSelect={(mode) => onRawModeChange?.(mode)}
        screenWidth={screenWidth}
      />
      <SkillsDropdown
        width={screenWidth}
        open={showSkillsDropdown}
        onClose={setShowSkillsDropdown}
        skills={skills}
        selectedSkills={selectedSkills}
        onSelect={toggleSelectedSkill}
      />
      <ModelsDropdown
        open={showModelDropdown}
        modelConfig={modelConfig}
        width={screenWidth}
        onClose={() => setShowModelDropdown(false)}
        onModelConfigChange={onModelConfigChange}
        onStatusMessage={setStatusMessage}
      />
      <ThemeDropdown
        open={showThemeDropdown}
        width={screenWidth}
        hasCustomConfig={hasCustomThemeConfig}
        currentPreset={currentPreset}
        onClose={() => setShowThemeDropdown(false)}
        onThemeChange={(preset: ThemePreset) => {
          onThemeChange?.(preset);
          switchTheme?.(preset);
        }}
        onThemePreview={onThemePreview}
        onThemeRevert={onThemeRevert}
        onStatusMessage={setStatusMessage}
      />
      <FileMentionMenu
        open={showFileMentionMenu}
        width={screenWidth}
        token={fileMentionToken}
        items={fileMentionMatches}
        onClose={() => {
          if (fileMentionKey) {
            setDismissedFileMentionKey(fileMentionKey);
          }
        }}
        onSelect={insertFileMentionSelection}
      />
      <SlashCommandMenu width={screenWidth} items={slashMenu} activeIndex={menuIndex} />
      {!showFooterText && (
        <Box marginLeft={2}>
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

export function renderBufferWithCursor(
  state: PromptBufferState,
  isFocused: boolean,
  placeholder?: string,
  validPastes?: Map<number, string>,
  highlightColor?: string
): string {
  const text = state.text || "";
  const cursor = Math.max(0, Math.min(state.cursor, text.length));
  const validIds = validPastes ?? new Map<number, string>();
  const h = highlightColor ?? "#faad14";

  if (text.length === 0 && placeholder) {
    if (!isFocused) {
      return chalk.dim(`  ${placeholder}`);
    }
    return renderCursorCell(" ") + chalk.dim(` ${placeholder}`);
  }

  if (text.length === 0) {
    return isFocused ? renderCursorCell(" ") : "";
  }

  if (!isFocused) {
    return highlightPasteMarkersInText(text, validIds, h);
  }

  return renderFocusedText(text, cursor, validIds, h);
}

function highlightPasteMarkersInText(s: string, validIds: Map<number, string>, highlightColor: string): string {
  if (!s.includes("[paste #")) return s;
  PASTE_MARKER_REGEX.lastIndex = 0;
  let result = "";
  let pos = 0;
  let match: RegExpExecArray | null;
  while ((match = PASTE_MARKER_REGEX.exec(s)) !== null) {
    result += s.slice(pos, match.index);
    const id = Number.parseInt(match[1]!, 10);
    result += validIds.has(id) ? chalk.hex(highlightColor)(match[0]) : match[0];
    pos = match.index + match[0].length;
  }
  result += s.slice(pos);
  return result.endsWith("\n") ? `${result} ` : result;
}

/**
 * Render focused text with paste-marker highlighting and cursor insertion.
 * Scans through the entire string in one pass, so the cursor can land
 * anywhere (including inside or at the boundary of a paste marker) and the
 * marker will still be highlighted correctly.
 */
function renderFocusedText(
  text: string,
  cursor: number,
  validIds: Map<number, string>,
  highlightColor: string
): string {
  let result = "";
  let pos = 0;
  PASTE_MARKER_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = PASTE_MARKER_REGEX.exec(text)) !== null) {
    const markerStart = match.index;
    const markerEnd = match.index + match[0].length;
    const id = Number.parseInt(match[1]!, 10);
    const isReal = validIds.has(id);

    // 1. Non-marker segment before this marker.
    result += renderTextSegmentWithCursor(text, pos, markerStart, cursor, false, highlightColor);
    pos = markerStart;

    // 2. Marker segment — highlighted only if it corresponds to a real paste.
    result += renderTextSegmentWithCursor(text, pos, markerEnd, cursor, isReal, highlightColor);
    pos = markerEnd;
  }

  // 3. Remainder after the last marker.
  result += renderTextSegmentWithCursor(text, pos, text.length, cursor, false, highlightColor);

  return result;
}

/**
 * Render a segment of `text` from `start` to `end`.
 * The cursor (if it falls inside this segment) is rendered as an inverse-video cell.
 */
function renderTextSegmentWithCursor(
  text: string,
  start: number,
  end: number,
  cursor: number,
  highlighted: boolean,
  highlightColor: string
): string {
  if (start >= end) return "";

  const segText = text.slice(start, end);
  const cursorRel = cursor - start; // relative cursor position inside this segment

  // Cursor not in this segment – just return the text.
  if (cursorRel < 0 || cursorRel > segText.length) {
    return highlighted ? chalk.hex(highlightColor)(segText) : segText;
  }

  // Cursor is exactly at `end` (which equals `segText.length`).
  if (cursorRel === segText.length) {
    return highlighted ? chalk.hex(highlightColor)(segText) + renderCursorCell(" ") : segText + renderCursorCell(" ");
  }

  // Cursor is somewhere inside the segment.
  const at = segText[cursorRel];

  if (at === "\n") {
    // Render newline as a space in the cursor cell, then output the actual newline.
    const before = segText.slice(0, cursorRel);
    const after = segText.slice(cursorRel + 1);
    return before + renderCursorCell(" ") + "\n" + after;
  }

  const before = segText.slice(0, cursorRel);
  const after = segText.slice(cursorRel + 1);
  if (highlighted) {
    return chalk.hex(highlightColor)(before) + renderCursorCell(at) + chalk.hex(highlightColor)(after);
  }
  return before + renderCursorCell(at) + after;
}

// Use explicit ANSI instead of chalk.inverse so cursor rendering stays enabled
// in non-TTY environments such as tests, where Chalk may strip styling.
function renderCursorCell(value: string): string {
  return `\u001B[7m${value}\u001B[27m`;
}
