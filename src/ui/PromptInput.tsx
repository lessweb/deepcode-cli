import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useApp, useStdin, useStdout } from "ink";
import chalk from "chalk";
import {
  EMPTY_BUFFER,
  PromptBufferState,
  backspace,
  deleteForward,
  getCurrentSlashToken,
  insertText,
  isEmpty,
  killLine,
  moveDown,
  moveLeft,
  moveLineEnd,
  moveLineStart,
  moveRight,
  moveUp
} from "./promptBuffer";
import {
  SlashCommandItem,
  buildSlashCommands,
  filterSlashCommands,
  findExactSlashCommand
} from "./slashCommands";
import { readClipboardImage } from "./clipboard";
import type { SkillInfo } from "../session";

export type PromptSubmission = {
  text: string;
  imageUrls: string[];
  selectedSkill?: SkillInfo;
  command?: "new" | "resume" | "exit";
};

type Props = {
  skills: SkillInfo[];
  promptHistory: string[];
  busy: boolean;
  loadingText?: string | null;
  disabled?: boolean;
  onSubmit: (submission: PromptSubmission) => void;
  onInterrupt: () => void;
};

const BACKSPACE_BYTES = new Set(["", ""]);
const FORWARD_DELETE_SEQUENCES = new Set(["[3~", "[P"]);

export type InputKey = {
  upArrow: boolean;
  downArrow: boolean;
  leftArrow: boolean;
  rightArrow: boolean;
  pageDown: boolean;
  pageUp: boolean;
  return: boolean;
  escape: boolean;
  ctrl: boolean;
  shift: boolean;
  tab: boolean;
  backspace: boolean;
  delete: boolean;
  meta: boolean;
};

export function PromptInput({
  skills,
  promptHistory,
  busy,
  loadingText,
  disabled,
  onSubmit,
  onInterrupt
}: Props): React.ReactElement {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const screenWidth = Math.max(20, stdout?.columns ?? 80);
  const [buffer, setBuffer] = useState<PromptBufferState>(EMPTY_BUFFER);
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [pendingExit, setPendingExit] = useState(false);
  const [menuIndex, setMenuIndex] = useState(0);
  const [historyCursor, setHistoryCursor] = useState(-1);
  const [draftBeforeHistory, setDraftBeforeHistory] = useState<string | null>(null);
  const lastCtrlDAt = useRef<number>(0);

  const slashItems = useMemo(() => buildSlashCommands(skills), [skills]);
  const slashToken = getCurrentSlashToken(buffer);
  const slashMenu = slashToken ? filterSlashCommands(slashItems, slashToken) : [];
  const showMenu = slashMenu.length > 0;
  const promptHistoryKey = useMemo(() => promptHistory.join("\0"), [promptHistory]);

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

  useTerminalInput((input, key) => {
    if (disabled) {
      return;
    }

    if (key.escape) {
      if (busy) {
        onInterrupt();
        setStatusMessage("Interrupting…");
      }
      return;
    }

    if (key.ctrl && (input === "d" || input === "D")) {
      if (!isEmpty(buffer)) {
        return;
      }
      const now = Date.now();
      if (pendingExit && now - lastCtrlDAt.current < 2000) {
        exit();
        process.exit(0);
        return;
      }
      lastCtrlDAt.current = now;
      setPendingExit(true);
      setStatusMessage("Press Ctrl+D again to exit");
      return;
    }

    if (key.ctrl && (input === "c" || input === "C")) {
      if (busy) {
        onInterrupt();
        setStatusMessage("Interrupting…");
      } else if (!isEmpty(buffer)) {
        setBuffer(EMPTY_BUFFER);
      } else {
        setStatusMessage("Press Ctrl+D to exit");
      }
      return;
    }

    if (pendingExit && (!key.ctrl || (input !== "d" && input !== "D"))) {
      setPendingExit(false);
    }

    if (historyCursor !== -1 && !key.upArrow && !key.downArrow) {
      exitHistoryBrowsing();
    }

    if (key.ctrl && (input === "v" || input === "V")) {
      const image = readClipboardImage();
      if (image) {
        setImageUrls((prev) => [...prev, image.dataUrl]);
        setStatusMessage("Attached image from clipboard");
      } else {
        setStatusMessage("No image found in clipboard");
      }
      return;
    }

    const noModifier = !key.shift && !key.ctrl && !key.meta;
    const isPlainReturn = key.return && !key.shift && !key.meta;

    if (busy && (isPlainReturn || (showMenu && key.tab))) {
      setStatusMessage("Wait for the current response or press Esc to interrupt");
      return;
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
      if (key.tab || (key.return && !key.shift && !key.meta)) {
        const selected = slashMenu[menuIndex];
        if (selected) {
          handleSlashSelection(selected);
          return;
        }
      }
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

    if (key.leftArrow) {
      updateBuffer((s) => moveLeft(s));
      return;
    }

    if (key.rightArrow) {
      updateBuffer((s) => moveRight(s));
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

    if (key.ctrl && (input === "a" || input === "A")) {
      updateBuffer((s) => moveLineStart(s));
      return;
    }
    if (key.ctrl && (input === "e" || input === "E")) {
      updateBuffer((s) => moveLineEnd(s));
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
    if (key.ctrl && (input === "j" || input === "J")) {
      updateBuffer((s) => insertText(s, "\n"));
      return;
    }

    if (input.startsWith("")) {
      // Unhandled escape sequence (e.g. function keys); ignore to avoid inserting garbage.
      return;
    }

    if (input && !key.ctrl && !key.meta) {
      const sanitized = input.replace(/\r/g, "");
      updateBuffer((s) => insertText(s, sanitized));
    }
  });

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
    setBuffer({ text, cursor: direction < 0 ? 0 : text.length });
    setHistoryCursor(nextCursor);
  }

  function handleSlashSelection(item: SlashCommandItem): void {
    if (busy && item.kind !== "exit") {
      setStatusMessage("Wait for the current response or press Esc to interrupt");
      return;
    }

    if (item.kind === "skill" && item.skill) {
      onSubmit({ text: "", imageUrls: [], selectedSkill: item.skill });
      setBuffer(EMPTY_BUFFER);
      setImageUrls([]);
      return;
    }
    if (item.kind === "new") {
      onSubmit({ text: "", imageUrls: [], command: "new" });
      setBuffer(EMPTY_BUFFER);
      setImageUrls([]);
      return;
    }
    if (item.kind === "resume") {
      onSubmit({ text: "", imageUrls: [], command: "resume" });
      setBuffer(EMPTY_BUFFER);
      setImageUrls([]);
      return;
    }
    if (item.kind === "exit") {
      onSubmit({ text: "", imageUrls: [], command: "exit" });
      return;
    }
  }

  function submitCurrentBuffer(): void {
    if (busy) {
      setStatusMessage("Wait for the current response or press Esc to interrupt");
      return;
    }

    const trimmed = buffer.text.trim();
    if (!trimmed && imageUrls.length === 0) {
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
      imageUrls
    });
    setBuffer(EMPTY_BUFFER);
    setImageUrls([]);
  }

  const divider = "─".repeat(screenWidth);

  return (
    <Box flexDirection="column">
      {imageUrls.length > 0 ? (
        <Box>
          <Text color="magenta">{`📎 ${imageUrls.length} image${imageUrls.length === 1 ? "" : "s"} attached`}</Text>
        </Box>
      ) : null}
      {showMenu ? (
        <Box flexDirection="column" marginBottom={1}>
          {slashMenu.slice(0, 8).map((item, idx) => (
            <Text key={item.label} color={idx === menuIndex ? "cyanBright" : undefined}>
              {idx === menuIndex ? "› " : "  "}
              <Text bold>{item.label}</Text>
              <Text dimColor>  {item.description}</Text>
            </Text>
          ))}
          {slashMenu.length > 8 ? <Text dimColor>… {slashMenu.length - 8} more</Text> : null}
        </Box>
      ) : null}
      <Text dimColor>{divider}</Text>
      <Box>
        <Text color={busy ? "yellow" : "green"}>{busy ? "⠋ " : "❯ "}</Text>
        <Text>{renderBufferWithCursor(buffer)}</Text>
      </Box>
      <Text dimColor>{divider}</Text>
      <Box>
        <Text dimColor>
          {statusMessage
            ? statusMessage
            : busy
              ? loadingText && loadingText.trim()
                ? loadingText
                : "Esc to interrupt · Ctrl+C to cancel input"
              : "Enter to send · Shift+Enter for newline · Ctrl+V paste image · / for skills · Ctrl+D to exit"}
        </Text>
      </Box>
    </Box>
  );
}

function renderBufferWithCursor(state: PromptBufferState): string {
  const text = state.text || "";
  const cursor = Math.max(0, Math.min(state.cursor, text.length));
  const before = text.slice(0, cursor);
  const at = text[cursor];
  const after = text.slice(cursor + 1);
  if (typeof at === "undefined") {
    return before + chalk.inverse(" ");
  }
  if (at === "\n") {
    return before + chalk.inverse(" ") + "\n" + after;
  }
  return before + chalk.inverse(at) + after;
}

export function useTerminalInput(inputHandler: (input: string, key: InputKey) => void): void {
  const { stdin, setRawMode, internal_exitOnCtrlC } = useStdin();

  useEffect(() => {
    setRawMode(true);
    return () => {
      setRawMode(false);
    };
  }, [setRawMode]);

  useEffect(() => {
    const handleData = (data: Buffer | string) => {
      const { input, key } = parseTerminalInput(data);

      if (!(input === "c" && key.ctrl) || !internal_exitOnCtrlC) {
        inputHandler(input, key);
      }
    };

    stdin?.on("data", handleData);
    return () => {
      stdin?.off("data", handleData);
    };
  }, [stdin, internal_exitOnCtrlC, inputHandler]);
}

export function parseTerminalInput(data: Buffer | string): { input: string; key: InputKey } {
  const raw = String(data);
  let input = raw;
  const key: InputKey = {
    upArrow: raw === "\u001B[A",
    downArrow: raw === "\u001B[B",
    leftArrow: raw === "\u001B[D",
    rightArrow: raw === "\u001B[C",
    pageDown: raw === "\u001B[6~",
    pageUp: raw === "\u001B[5~",
    return: raw === "\r",
    escape: raw === "\u001B",
    ctrl: false,
    shift: false,
    tab: raw === "\t" || raw === "\u001B[Z",
    backspace: BACKSPACE_BYTES.has(raw),
    delete: FORWARD_DELETE_SEQUENCES.has(raw),
    meta: false
  };

  if (input <= "\u001A" && !key.return) {
    input = String.fromCharCode(input.charCodeAt(0) + "a".charCodeAt(0) - 1);
    key.ctrl = true;
  }

  const isKnownEscapeSequence =
    key.upArrow ||
    key.downArrow ||
    key.leftArrow ||
    key.rightArrow ||
    key.pageDown ||
    key.pageUp ||
    key.tab ||
    key.delete;

  if (raw.startsWith("\u001B")) {
    input = raw.slice(1);
    key.meta = !isKnownEscapeSequence;
  }

  const isLatinUppercase = input >= "A" && input <= "Z";
  const isCyrillicUppercase = input >= "А" && input <= "Я";
  if (input.length === 1 && (isLatinUppercase || isCyrillicUppercase)) {
    key.shift = true;
  }

  if (key.tab && input === "[Z") {
    key.shift = true;
  }

  if (key.tab || key.backspace || key.delete) {
    input = "";
  }

  return { input, key };
}
