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
const TERMINAL_FOCUS_IN = "\u001B[I";
const TERMINAL_FOCUS_OUT = "\u001B[O";

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
    };
    return { input, key };
  }

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

  // Fix CJK composition bug on iOS terminals (Moshi, Blink, etc.).
  // iOS keyboards can send composed characters as a single packet like:
  //   "가\x7f나"  (character + backspace + replacement character)
  // Do not split escape-prefixed sequences such as Alt+Backspace.
  if (!raw.startsWith("\u001B") && raw.includes("\x7f") && raw.length > 1) {
    const parts = raw.split("\x7f");
    if (parts[0]) {
      const { input, key } = parseTerminalInput(parts[0]);
      inputHandler(input, key);
    }
    for (let i = 1; i < parts.length; i++) {
      const bs = parseTerminalInput("\x7f");
      inputHandler(bs.input, bs.key);
      if (parts[i]) {
        const { input, key } = parseTerminalInput(parts[i]);
        inputHandler(input, key);
      }
    }
    return;
  }

  const { input, key } = parseTerminalInput(data);
  inputHandler(input, key);
}

export function useTerminalInput(
  inputHandler: (input: string, key: InputKey) => void,
  options: { isActive?: boolean } = {}
): void {
  const { stdin, setRawMode } = useStdin();
  const isActive = options.isActive ?? true;
  const handlerRef = useRef(inputHandler);
  handlerRef.current = inputHandler;

  useEffect(() => {
    if (!isActive) {
      return;
    }
    setRawMode(true);
    return () => {
      setRawMode(false);
    };
  }, [isActive, setRawMode]);

  useEffect(() => {
    if (!isActive) {
      return;
    }
    const handleData = (data: Buffer | string) => {
      dispatchTerminalInput(data, handlerRef.current);
    };

    stdin?.on("data", handleData);
    return () => {
      stdin?.off("data", handleData);
    };
  }, [isActive, stdin]);
}
