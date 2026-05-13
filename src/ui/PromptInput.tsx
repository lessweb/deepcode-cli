import React, { useEffect, useState } from "react";
import { Box, Text, useApp, useStdout } from "ink";
import chalk from "chalk";
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
import { buildSlashCommands, filterSlashCommands, findExactSlashCommand } from "./slashCommands";
import type { SlashCommandItem } from "./slashCommands";
import { readClipboardImageAsync } from "./clipboard";
import type { SkillInfo } from "../session";

// Re-exported from prompt modules for backward compatibility
export { useTerminalInput, parseTerminalInput } from "./prompt";
export type { InputKey } from "./prompt";

import { useTerminalInput } from "./prompt";
import type { InputKey } from "./prompt";
import { useHiddenTerminalCursor, useTerminalFocusReporting } from "./prompt";
import SlashCommandMenu from "./SlashCommandMenu";
import type { ModelConfigSelection, ReasoningEffort } from "../settings";

export type PromptSubmission = {
  text: string;
  imageUrls: string[];
  selectedSkills?: SkillInfo[];
  command?: "new" | "resume" | "mcp" | "exit";
};

type Props = {
  skills: SkillInfo[];
  modelConfig: ModelConfigSelection;
  screenWidth: number;
  promptHistory: string[];
  busy: boolean;
  loadingText?: string | null;
  disabled?: boolean;
  placeholder?: string;
  onSubmit: (submission: PromptSubmission) => void;
  onModelConfigChange: (selection: ModelConfigSelection) => string | Promise<string>;
  onInterrupt: () => void;
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
  return <Text color={busy ? "yellow" : "green"}>{prefix}</Text>;
});

export const PromptInput = React.memo(function PromptInput({
  skills,
  modelConfig,
  screenWidth,
  promptHistory,
  busy,
  loadingText,
  disabled,
  placeholder,
  onSubmit,
  onModelConfigChange,
  onInterrupt,
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
  const [skillsDropdownIndex, setSkillsDropdownIndex] = useState(0);
  const [modelDropdownStep, setModelDropdownStep] = useState<ModelDropdownStep | null>(null);
  const [modelDropdownIndex, setModelDropdownIndex] = useState(0);
  const [pendingModel, setPendingModel] = useState<string | null>(null);
  const [historyCursor, setHistoryCursor] = useState(-1);
  const [draftBeforeHistory, setDraftBeforeHistory] = useState<string | null>(null);
  const [hasTerminalFocus, setHasTerminalFocus] = useState(true);
  const lastCtrlDAt = React.useRef<number>(0);

  const slashItems = React.useMemo(() => buildSlashCommands(skills), [skills]);
  const slashToken = getCurrentSlashToken(buffer);
  const slashMenu = React.useMemo(
    () =>
      showSkillsDropdown || modelDropdownStep ? [] : slashToken ? filterSlashCommands(slashItems, slashToken) : [],
    [showSkillsDropdown, modelDropdownStep, slashToken, slashItems]
  );
  const showMenu = slashMenu.length > 0;
  const promptHistoryKey = React.useMemo(() => promptHistory.join("\0"), [promptHistory]);
  const footerText = statusMessage
    ? statusMessage
    : busy
      ? loadingText && loadingText.trim()
        ? loadingText
        : "esc to interrupt · ctrl+c to cancel input"
      : "enter send · shift+enter newline · ctrl+v image · / commands · ctrl+d exit";
  useTerminalFocusReporting(stdout, !disabled);
  useHiddenTerminalCursor(stdout, !disabled);

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
        if (busy) {
          onInterrupt();
          setStatusMessage("Interrupting…");
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
        } else {
          setStatusMessage("press ctrl+d to exit");
        }
        return;
      }

      if (pendingExit && (!key.ctrl || (input !== "d" && input !== "D"))) {
        setPendingExit(false);
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
      const isPlainReturn = key.return && !key.shift && !key.meta;

      if (showMenu) {
        if (key.upArrow) {
          setMenuIndex((idx) => (idx - 1 + slashMenu.length) % slashMenu.length);
          return;
        }
        if (key.downArrow) {
          setMenuIndex((idx) => (idx + 1) % slashMenu.length);
          return;
        }
        if (key.tab || (key.return && !key.shift && !key.meta)) {
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

      if (key.return) {
        const isShiftEnter = key.shift || key.meta;
        if (isShiftEnter) {
          updateBuffer((s) => insertText(s, "\n"));
          return;
        }
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

  function exitHistoryBrowsing(): void {
    setHistoryCursor(-1);
    setDraftBeforeHistory(null);
  }

  function updateBuffer(updater: (state: PromptBufferState) => PromptBufferState): void {
    exitHistoryBrowsing();
    setBuffer(updater);
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
    if (item.kind === "new") {
      onSubmit({ text: "", imageUrls: [], command: "new" });
      setBuffer(EMPTY_BUFFER);
      setImageUrls([]);
      setSelectedSkills([]);
      setShowSkillsDropdown(false);
      return;
    }
    if (item.kind === "init") {
      onSubmit(buildInitPromptSubmission(selectedSkills));
      setBuffer(EMPTY_BUFFER);
      setImageUrls([]);
      setSelectedSkills([]);
      setShowSkillsDropdown(false);
      return;
    }
    if (item.kind === "resume") {
      onSubmit({ text: "", imageUrls: [], command: "resume" });
      setBuffer(EMPTY_BUFFER);
      setImageUrls([]);
      setSelectedSkills([]);
      setShowSkillsDropdown(false);
      return;
    }
    if (item.kind === "mcp") {
      onSubmit({ text: "/mcp", imageUrls: [], command: "mcp" });
      setBuffer(EMPTY_BUFFER);
      setImageUrls([]);
      setSelectedSkills([]);
      setShowSkillsDropdown(false);
      return;
    }
    if (item.kind === "exit") {
      onSubmit({ text: "/exit", imageUrls: [], command: "exit" });
      setBuffer(EMPTY_BUFFER);
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

  const visibleSkillStart = Math.min(Math.max(0, skillsDropdownIndex - 7), Math.max(0, skills.length - 8));
  const visibleSkills = skills.slice(visibleSkillStart, visibleSkillStart + 8);
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
      </Box>
      {showSkillsDropdown ? (
        <Box flexDirection="column" marginBottom={1}>
          <Text color="magenta" bold>
            Select Skills
          </Text>
          {skills.length === 0 ? (
            <Text dimColor>No skills found</Text>
          ) : (
            visibleSkills.map((skill, idx) => {
              const skillIndex = visibleSkillStart + idx;
              const selected = isSkillSelected(selectedSkills, skill);
              const active = skillIndex === skillsDropdownIndex;
              return (
                <Text key={skill.path || skill.name} color={active ? "cyanBright" : undefined} wrap="truncate-end">
                  {active ? "› " : "  "}
                  {selected ? "●" : "○"} <Text bold>{skill.name}</Text>
                  {skill.isLoaded ? <Text color="green"> ✓</Text> : null}
                  <Text dimColor>{`  ${skill.path}`}</Text>
                </Text>
              );
            })
          )}
          {visibleSkillStart > 0 ? <Text dimColor>… {visibleSkillStart} above</Text> : null}
          {visibleSkillStart + visibleSkills.length < skills.length ? (
            <Text dimColor>… {skills.length - visibleSkillStart - visibleSkills.length} more</Text>
          ) : null}
          <Text dimColor>space toggle · enter toggle · esc to close</Text>
        </Box>
      ) : null}
      {modelDropdownStep ? (
        <Box flexDirection="column" marginBottom={1}>
          <Text color="magenta" bold>
            {modelDropdownStep === "model" ? "Select Model" : "Select Thinking Mode"}
          </Text>
          {modelDropdownItems.map((item, idx) => {
            const active = idx === modelDropdownIndex;
            return (
              <Text key={item.label} color={active ? "cyanBright" : undefined} wrap="truncate-end">
                {active ? "› " : "  "}
                {item.selected ? "●" : "○"} <Text bold>{item.label}</Text>
                {item.description ? <Text dimColor>{`  ${item.description}`}</Text> : null}
              </Text>
            );
          })}
          <Text dimColor>
            {modelDropdownStep === "model"
              ? "space/enter select model · esc to cancel"
              : "space/enter apply · esc to cancel"}
          </Text>
        </Box>
      ) : null}
      <SlashCommandMenu width={screenWidth} items={slashMenu} activeIndex={menuIndex} />
      {!showMenu && (
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
