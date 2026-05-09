import { useLayoutEffect, useRef } from "react";
import type { PromptBufferState } from "../promptBuffer";

type CursorPlacement = {
  rowsUp: number;
  column: number;
};

type WriteFn = (
  chunk: string | Uint8Array,
  encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void),
  callback?: (error?: Error | null) => void
) => boolean;

function cursorUp(rows: number): string {
  return rows > 0 ? `\u001B[${rows}A` : "";
}

function cursorDown(rows: number): string {
  return rows > 0 ? `\u001B[${rows}B` : "";
}

function cursorForward(columns: number): string {
  return columns > 0 ? `\u001B[${columns}C` : "";
}

function showCursor(): string {
  return "\u001B[?25h";
}

function hideCursor(): string {
  return "\u001B[?25l";
}

function enableTerminalFocusReporting(): string {
  return "\u001B[?1004h";
}

function disableTerminalFocusReporting(): string {
  return "\u001B[?1004l";
}

export function getPromptCursorPlacement(
  state: PromptBufferState,
  screenWidth: number,
  prefixWidth: number,
  belowRows: number
): CursorPlacement {
  const width = Math.max(1, screenWidth);
  const cursor = Math.max(0, Math.min(state.cursor, state.text.length));
  const beforeCursor = state.text.slice(0, cursor);
  const at = state.text[cursor];
  const displayText = beforeCursor + (typeof at === "undefined" || at === "\n" ? " " : at) +
    (at === "\n" ? "\n" : "") + (typeof at === "undefined" ? "" : state.text.slice(cursor + 1));

  const cursorPosition = measureTextPosition(beforeCursor, width, prefixWidth);
  const promptRows = measureTextRows(displayText, width, prefixWidth);

  return {
    rowsUp: (promptRows - 1 - cursorPosition.row) + belowRows + 1,
    column: cursorPosition.column
  };
}

export function measureTextRows(text: string, width: number, initialColumn: number): number {
  return measureTextPosition(text, width, initialColumn).row + 1;
}

function measureTextPosition(text: string, width: number, initialColumn: number): { row: number; column: number } {
  let row = 0;
  let column = Math.min(initialColumn, width - 1);

  for (const char of Array.from(text)) {
    if (char === "\n") {
      row++;
      column = Math.min(initialColumn, width - 1);
      continue;
    }

    const charColumns = textWidth(char);
    if (column + charColumns > width) {
      row++;
      column = Math.min(initialColumn, width - 1);
    }
    column += charColumns;
    if (column >= width) {
      row++;
      column = Math.min(initialColumn, width - 1);
    }
  }

  return { row, column };
}

function textWidth(value: string): number {
  let width = 0;
  for (const char of Array.from(value.normalize())) {
    width += characterWidth(char);
  }
  return width;
}

function characterWidth(char: string): number {
  const codePoint = char.codePointAt(0) ?? 0;
  if (codePoint === 0 || codePoint < 32 || (codePoint >= 0x7f && codePoint < 0xa0)) {
    return 0;
  }
  if (codePoint >= 0x300 && codePoint <= 0x36f) {
    return 0;
  }
  if (
    (codePoint >= 0x1100 && codePoint <= 0x115f) ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6)
  ) {
    return 2;
  }
  return 1;
}

export function usePromptTerminalCursor(
  stdout: NodeJS.WriteStream | undefined,
  placement: CursorPlacement,
  isActive: boolean
): void {
  const directWriteRef = useRef<((data: string) => void) | null>(null);
  const activePlacementRef = useRef<CursorPlacement | null>(null);
  const unmountingRef = useRef(false);

  // Patch stdout.write to hide the cursor before every write. This prevents
  // the terminal cursor from appearing mid-render at the wrong position.
  useLayoutEffect(() => {
    if (!isActive || !stdout?.isTTY) {
      return;
    }

    const stream = stdout as NodeJS.WriteStream & { write: WriteFn };
    const originalWrite = stream.write;
    const directWrite = (data: string) => {
      originalWrite.call(stdout, data);
    };

    directWriteRef.current = directWrite;

    const patchedWrite: WriteFn = (...args) => {
      // Before each write, move the cursor back to the bottom and hide it.
      if (!unmountingRef.current && activePlacementRef.current) {
        directWrite("\r" + cursorDown(activePlacementRef.current.rowsUp) + hideCursor());
        activePlacementRef.current = null;
      }
      return originalWrite.apply(stdout, args);
    };

    stream.write = patchedWrite;
    return () => {
      unmountingRef.current = true;
      stream.write = originalWrite;
      directWriteRef.current = null;
    };
  }, [isActive, stdout]);

  // Show and position the terminal cursor after each render.
  useLayoutEffect(() => {
    if (!isActive || !stdout?.isTTY) {
      return;
    }

    unmountingRef.current = false;
    const directWrite = directWriteRef.current;
    if (!directWrite) {
      return;
    }

    directWrite(showCursor() + cursorUp(placement.rowsUp) + "\r" + cursorForward(placement.column));
    activePlacementRef.current = placement;

    return () => {
      unmountingRef.current = true;
      const p = activePlacementRef.current;
      if (!p) {
        return;
      }
      directWrite("\r" + cursorDown(p.rowsUp) + hideCursor());
      activePlacementRef.current = null;
    };
  }, [isActive, placement.rowsUp, placement.column, stdout]);
}

export function useHiddenTerminalCursor(stdout: NodeJS.WriteStream | undefined, isActive: boolean): void {
  useLayoutEffect(() => {
    if (!isActive || !stdout?.isTTY) {
      return;
    }

    stdout.write(hideCursor());
    return () => {
      stdout.write(showCursor());
    };
  }, [isActive, stdout]);
}

export function useTerminalFocusReporting(stdout: NodeJS.WriteStream | undefined, isActive: boolean): void {
  useLayoutEffect(() => {
    if (!isActive || !stdout?.isTTY) {
      return;
    }

    stdout.write(enableTerminalFocusReporting());
    return () => {
      stdout.write(disableTerminalFocusReporting());
    };
  }, [isActive, stdout]);
}
