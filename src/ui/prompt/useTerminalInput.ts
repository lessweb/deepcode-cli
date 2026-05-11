import { useEffect, useRef } from "react";
import { useStdin } from "ink";

export type InputKey = {
  upArrow: boolean;
  downArrow: boolean;
  leftArrow: boolean;
  rightArrow: boolean;
  home: boolean;
  end: boolean;
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
  focusIn: boolean;
  focusOut: boolean;
  /** The input was received as part of a bracketed paste (sent by the terminal). */
  paste: boolean;
};

const BACKSPACE_BYTES = new Set(["\u007F", "\b"]);
const FORWARD_DELETE_SEQUENCES = new Set(["\u001B[3~", "\u001B[P"]);
const HOME_SEQUENCES = new Set(["\u001B[H", "\u001B[1~", "\u001B[7~", "\u001BOH"]);
const END_SEQUENCES = new Set(["\u001B[F", "\u001B[4~", "\u001B[8~", "\u001BOF"]);
const SHIFT_RETURN_SEQUENCES = new Set(["\u001B\r", "\u001B[13;2u"]);
const META_RETURN_SEQUENCES = new Set(["\u001B[13;3u", "\u001B[13;4u"]);
const CTRL_LEFT_SEQUENCES = new Set(["\u001B[1;5D", "\u001B[5D"]);
const CTRL_RIGHT_SEQUENCES = new Set(["\u001B[1;5C", "\u001B[5C"]);
const META_LEFT_SEQUENCES = new Set(["\u001B[1;3D", "\u001B[3D", "\u001Bb"]);
const META_RIGHT_SEQUENCES = new Set(["\u001B[1;3C", "\u001B[3C", "\u001Bf"]);
const TERMINAL_FOCUS_IN = "\u001B[I";
const TERMINAL_FOCUS_OUT = "\u001B[O";
/** Bracketed paste mode markers: start and end delimiters sent by terminals. */
const BRACKETED_PASTE_START = "\u001B[200~";
const BRACKETED_PASTE_END = "\u001B[201~";

export function parseTerminalInput(data: Buffer | string): { input: string; key: InputKey } {
  const raw = String(data);
  let input = raw;
  const key: InputKey = {
    upArrow: raw === "\u001B[A",
    downArrow: raw === "\u001B[B",
    leftArrow: raw === "\u001B[D" || CTRL_LEFT_SEQUENCES.has(raw) || META_LEFT_SEQUENCES.has(raw),
    rightArrow: raw === "\u001B[C" || CTRL_RIGHT_SEQUENCES.has(raw) || META_RIGHT_SEQUENCES.has(raw),
    home: HOME_SEQUENCES.has(raw),
    end: END_SEQUENCES.has(raw),
    pageDown: raw === "\u001B[6~",
    pageUp: raw === "\u001B[5~",
    return: raw === "\r" || SHIFT_RETURN_SEQUENCES.has(raw) || META_RETURN_SEQUENCES.has(raw),
    escape: raw === "\u001B",
    ctrl: CTRL_LEFT_SEQUENCES.has(raw) || CTRL_RIGHT_SEQUENCES.has(raw),
    shift: SHIFT_RETURN_SEQUENCES.has(raw),
    tab: raw === "\t" || raw === "\u001B[Z",
    backspace: BACKSPACE_BYTES.has(raw),
    delete: FORWARD_DELETE_SEQUENCES.has(raw),
    meta: META_LEFT_SEQUENCES.has(raw) || META_RIGHT_SEQUENCES.has(raw) || META_RETURN_SEQUENCES.has(raw),
    focusIn: raw === TERMINAL_FOCUS_IN,
    focusOut: raw === TERMINAL_FOCUS_OUT,
    paste: false,
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
    key.home ||
    key.end ||
    key.pageDown ||
    key.pageUp ||
    key.tab ||
    key.delete ||
    key.return ||
    key.ctrl ||
    key.meta ||
    key.focusIn ||
    key.focusOut;

  if (raw.startsWith("\u001B")) {
    input = raw.slice(1);
    key.meta = key.meta || !isKnownEscapeSequence;
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

export function useTerminalInput(
  inputHandler: (input: string, key: InputKey) => void,
  options: { isActive?: boolean } = {}
): void {
  const { stdin, setRawMode } = useStdin();
  const isActive = options.isActive ?? true;
  const handlerRef = useRef(inputHandler);
  handlerRef.current = inputHandler;

  // Accumulates text between bracketed paste start and end markers.
  // Non-null means a paste is in progress.
  const pasteRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isActive) {
      return;
    }
    setRawMode(true);
    // Enable bracketed paste mode so the terminal wraps pasted text in
    // \u001B[200~ / \u001B[201~ markers, allowing us to deliver the full
    // paste as a single atomic input instead of fragmented key events.
    process.stdout.write("\u001B[?2004h");
    return () => {
      setRawMode(false);
      process.stdout.write("\u001B[?2004l");
    };
  }, [isActive, setRawMode]);

  useEffect(() => {
    if (!isActive) {
      return;
    }
    const handleData = (data: Buffer | string) => {
      const raw = String(data);

      // Bracketed paste mode: the terminal wraps pasted content in
      // \u001B[200~ (start) and \u001B[201~ (end).  Accumulate everything
      // between them and deliver as a single input chunk with
      // normalized line endings.
      if (raw === BRACKETED_PASTE_START) {
        pasteRef.current = "";
        return;
      }
      if (raw === BRACKETED_PASTE_END) {
        const pasted = pasteRef.current;
        pasteRef.current = null;
        if (pasted != null && pasted.length > 0) {
          // Normalize any line-ending variant to \n.
          const normalized = pasted.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
          handlerRef.current(normalized, {
            upArrow: false,
            downArrow: false,
            leftArrow: false,
            rightArrow: false,
            home: false,
            end: false,
            pageDown: false,
            pageUp: false,
            return: false,
            escape: false,
            ctrl: false,
            shift: false,
            tab: false,
            backspace: false,
            delete: false,
            meta: false,
            focusIn: false,
            focusOut: false,
            paste: true,
          });
        }
        return;
      }
      if (typeof pasteRef.current === "string") {
        pasteRef.current += raw;
        return;
      }

      const { input, key } = parseTerminalInput(data);
      handlerRef.current(input, key);
    };

    stdin?.on("data", handleData);
    return () => {
      stdin?.off("data", handleData);
    };
  }, [isActive, stdin]);
}
