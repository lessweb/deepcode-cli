import { useLayoutEffect, useRef } from "react";
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
  /** True when the input came from a bracketed paste (ESC[200~ ... ESC[201~). */
  paste: boolean;
};

const BACKSPACE_BYTES = new Set(["\u007F", "\b"]);
const FORWARD_DELETE_SEQUENCES = new Set(["\u001B[3~", "\u001B[P"]);
const HOME_SEQUENCES = new Set(["\u001B[H", "\u001B[1~", "\u001B[7~", "\u001BOH"]);
const END_SEQUENCES = new Set(["\u001B[F", "\u001B[4~", "\u001B[8~", "\u001BOF"]);
const SHIFT_RETURN_SEQUENCES = new Set(["\u001B\r", "\u001B[13;2u", "\u001B[13;2~", "\u001B[27;2;13~"]);
const META_RETURN_SEQUENCES = new Set(["\u001B[13;3u", "\u001B[13;4u"]);
const CTRL_LEFT_SEQUENCES = new Set(["\u001B[1;5D", "\u001B[5D"]);
const CTRL_RIGHT_SEQUENCES = new Set(["\u001B[1;5C", "\u001B[5C"]);
const META_LEFT_SEQUENCES = new Set(["\u001B[1;3D", "\u001B[3D", "\u001Bb"]);
const META_RIGHT_SEQUENCES = new Set(["\u001B[1;3C", "\u001B[3C", "\u001Bf"]);
// Application cursor keys mode (DECCKM) arrows.
const APPLICATION_LEFT = "\u001BOD";
const APPLICATION_RIGHT = "\u001BOC";
const CTRL_HOME_SEQUENCES = new Set(["\u001B[1;5H", "\u001B[5H"]);
const CTRL_END_SEQUENCES = new Set(["\u001B[1;5F", "\u001B[5F"]);
const TERMINAL_FOCUS_IN = "\u001B[I";
const TERMINAL_FOCUS_OUT = "\u001B[O";

// Bracketed paste mode markers (xterm-style).
// When the terminal supports bracketed paste, pasted text is wrapped with:
//   ESC[200~  ...pasted content...  ESC[201~
const PASTE_START = "\u001B[200~";
const PASTE_END = "\u001B[201~";
const ESCAPE_SEQUENCE_TIMEOUT_MS = 20;

/** Length of a trailing, incomplete marker that must wait for the next data event. */
function partialMarkerLength(input: string, marker: string): number {
  for (let length = Math.min(input.length, marker.length - 1); length > 0; length--) {
    if (input.endsWith(marker.slice(0, length))) return length;
  }
  return 0;
}

// Ctrl+- (minus) sequences in modifyOtherKeys mode.
// \u001B[45;5u  — standard format: keycode=45 ('-'), modifier=5 (Ctrl)
// \u001B[27;5;45~ — extended format for function-like reporting
const CTRL_MINUS_SEQUENCES = new Set(["\u001B[45;5u", "\u001B[27;5;45~"]);

// Ctrl+Shift+- (minus) sequences in modifyOtherKeys mode.
// \u001B[45;6u  — standard format: keycode=45 ('-'), modifier=6 (Ctrl+Shift)
// \u001B[27;6;45~ — extended format for function-like reporting
const CTRL_SHIFT_MINUS_SEQUENCES = new Set(["\u001B[45;6u", "\u001B[27;6;45~"]);

export function parseTerminalInput(data: Buffer | string): { input: string; key: InputKey } {
  const raw = String(data);
  let input = raw;

  // Ctrl+- undo shortcut: only via modifyOtherKeys CSI sequences.
  // Raw 0x1F is NOT included here because it represents Ctrl+_ (Ctrl+Shift+-
  // on US keyboards), which should trigger redo instead.
  if (CTRL_MINUS_SEQUENCES.has(raw)) {
    input = "-";
    const key: InputKey = {
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
      ctrl: true,
      shift: false,
      tab: false,
      backspace: false,
      delete: false,
      meta: false,
      focusIn: false,
      focusOut: false,
      paste: false,
    };
    return { input, key };
  }

  // Ctrl+Shift+- redo shortcut: modifyOtherKeys CSI sequences + raw 0x1F fallback.
  // \x1F is Ctrl+_ which on US keyboards = Ctrl+Shift+-.
  if (CTRL_SHIFT_MINUS_SEQUENCES.has(raw) || raw === "\u001F") {
    input = "-";
    const key: InputKey = {
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
      ctrl: true,
      shift: true,
      tab: false,
      backspace: false,
      delete: false,
      meta: false,
      focusIn: false,
      focusOut: false,
      paste: false,
    };
    return { input, key };
  }

  const key: InputKey = {
    upArrow: raw === "\u001B[A",
    downArrow: raw === "\u001B[B",
    leftArrow:
      raw === "\u001B[D" || raw === APPLICATION_LEFT || CTRL_LEFT_SEQUENCES.has(raw) || META_LEFT_SEQUENCES.has(raw),
    rightArrow:
      raw === "\u001B[C" || raw === APPLICATION_RIGHT || CTRL_RIGHT_SEQUENCES.has(raw) || META_RIGHT_SEQUENCES.has(raw),
    home: HOME_SEQUENCES.has(raw) || CTRL_HOME_SEQUENCES.has(raw),
    end: END_SEQUENCES.has(raw) || CTRL_END_SEQUENCES.has(raw),
    pageDown: raw === "\u001B[6~",
    pageUp: raw === "\u001B[5~",
    return: raw === "\r" || SHIFT_RETURN_SEQUENCES.has(raw) || META_RETURN_SEQUENCES.has(raw),
    escape: raw === "\u001B",
    ctrl:
      CTRL_LEFT_SEQUENCES.has(raw) ||
      CTRL_RIGHT_SEQUENCES.has(raw) ||
      CTRL_HOME_SEQUENCES.has(raw) ||
      CTRL_END_SEQUENCES.has(raw),
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

export function dispatchTerminalInput(
  data: Buffer | string,
  inputHandler: (input: string, key: InputKey) => void
): void {
  const raw = String(data);

  // Terminals may coalesce a shortcut and subsequent text into one packet.
  // Keep escape sequences intact, but dispatch standalone controls individually
  // (also handles CJK composition's character + DEL + replacement packets).
  if (!raw.startsWith("\u001B") && /[\x00-\x1a\x1c-\x1f\x7f]/.test(raw) && raw.length > 1) {
    for (const part of raw.split(/([\x00-\x1a\x1c-\x1f\x7f])/).filter(Boolean)) {
      const { input, key } = parseTerminalInput(part);
      inputHandler(input, key);
    }
    return;
  }

  const { input, key } = parseTerminalInput(data);
  inputHandler(input, key);
}

/** An InputKey with all fields false (including paste). Used when dispatching paste events. */
const EMPTY_KEY: InputKey = {
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
  paste: false,
};

export function useTerminalInput(
  inputHandler: (input: string, key: InputKey) => void,
  options: { isActive?: boolean } = {}
): void {
  const { stdin, setRawMode } = useStdin();
  const isActive = options.isActive ?? true;
  const handlerRef = useRef(inputHandler);
  handlerRef.current = inputHandler;

  useLayoutEffect(() => {
    if (!isActive) {
      return;
    }
    setRawMode(true);
    return () => {
      setRawMode(false);
    };
  }, [isActive, setRawMode]);

  useLayoutEffect(() => {
    if (!isActive) {
      return;
    }

    let pasteActive = false;
    const pasteChunks: string[] = [];
    let pending = "";
    let escapeTimer: ReturnType<typeof setTimeout> | undefined;

    const handleData = (data: Buffer | string) => {
      clearTimeout(escapeTimer);
      escapeTimer = undefined;
      let raw = pending + String(data);
      pending = "";

      while (raw.length > 0) {
        const marker = pasteActive ? PASTE_END : PASTE_START;
        const markerIndex = raw.indexOf(marker);

        if (markerIndex === -1) {
          // Only carry a possible marker prefix (at most five characters).
          // Keep the body in chunks and join once, when the paste finishes.
          const pendingLength = partialMarkerLength(raw, marker);
          const content = raw.slice(0, raw.length - pendingLength);
          pending = raw.slice(raw.length - pendingLength);
          if (content) {
            if (pasteActive) pasteChunks.push(content);
            else dispatchTerminalInput(content, handlerRef.current);
          }

          // Esc and Alt+[ are also prefixes of the paste start marker. Give
          // the next data event a short window before treating them as keys.
          // Never time out an in-progress paste or an unambiguous CSI prefix.
          if (!pasteActive && (pending === "\u001B" || pending === "\u001B[")) {
            escapeTimer = setTimeout(() => {
              escapeTimer = undefined;
              const input = pending;
              pending = "";
              dispatchTerminalInput(input, handlerRef.current);
            }, ESCAPE_SEQUENCE_TIMEOUT_MS);
          }
          return;
        }

        const content = raw.slice(0, markerIndex);
        raw = raw.slice(markerIndex + marker.length);
        if (pasteActive) {
          pasteChunks.push(content);
          const pasteContent = pasteChunks.join("");
          pasteChunks.length = 0;
          pasteActive = false;
          if (pasteContent) handlerRef.current(pasteContent, { ...EMPTY_KEY, paste: true });
        } else {
          if (content) dispatchTerminalInput(content, handlerRef.current);
          pasteActive = true;
        }
      }
    };

    stdin?.on("data", handleData);
    return () => {
      stdin?.off("data", handleData);
      clearTimeout(escapeTimer);
    };
  }, [isActive, stdin]);
}
