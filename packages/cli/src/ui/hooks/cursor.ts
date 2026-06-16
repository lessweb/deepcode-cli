import { useCursor, useBoxMetrics } from "ink";
import { useLayoutEffect, useState } from "react";
import type { RefObject } from "react";
import type { DOMElement } from "ink";
import type { PromptBufferState } from "../core/prompt-buffer";

export type CursorPlacement = {
  row: number;
  column: number;
};

export type PromptCursorOrigin = {
  layoutKey: string;
  left: number;
  top: number;
};

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

function enableBracketedPaste(): string {
  return "\u001B[?2004h";
}

function disableBracketedPaste(): string {
  return "\u001B[?2004l";
}

export function enableTerminalExtendedKeys(): string {
  return "\u001B[>4;1m";
}

export function disableTerminalExtendedKeys(): string {
  return "\u001B[>4;0m";
}

export function getPromptCursorPlacement(
  state: PromptBufferState,
  screenWidth: number,
  initialColumn = 0
): CursorPlacement {
  const width = Math.max(1, screenWidth);
  const cursor = Math.max(0, Math.min(state.cursor, state.text.length));
  const beforeCursor = state.text.slice(0, cursor);
  const cursorPosition = measureTextPosition(beforeCursor, width, initialColumn);
  return { row: cursorPosition.row, column: cursorPosition.column };
}

export function isPromptCursorAtWrapBoundary(state: PromptBufferState, screenWidth: number): boolean {
  const width = Math.max(1, screenWidth);
  const cursor = Math.max(0, Math.min(state.cursor, state.text.length));
  const currentLineStart = state.text.lastIndexOf("\n", Math.max(0, cursor - 1)) + 1;
  const currentLineBeforeCursor = state.text.slice(currentLineStart, cursor);
  return measureTextPosition(currentLineBeforeCursor, width, 0).row > 0;
}

function measureTextPosition(text: string, width: number, initialColumn: number): { row: number; column: number } {
  let row = 0;
  let column = Math.min(initialColumn, width - 1);
  let pendingWrap = false;

  for (const char of Array.from(text)) {
    if (char === "\n") {
      row++;
      column = Math.min(initialColumn, width - 1);
      pendingWrap = false;
      continue;
    }

    if (pendingWrap) {
      row++;
      column = Math.min(initialColumn, width - 1);
      pendingWrap = false;
    }

    const charColumns = textWidth(char);
    if (column + charColumns > width) {
      row++;
      column = Math.min(initialColumn, width - 1);
    }
    column += charColumns;
    if (column >= width) {
      column = width;
      pendingWrap = true;
    }
  }

  if (pendingWrap) {
    return { row: row + 1, column: Math.min(initialColumn, width - 1) };
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
  targetRef: RefObject<DOMElement | null>,
  placement: CursorPlacement,
  isActive: boolean,
  layoutKey = "default"
): boolean {
  const { setCursorPosition } = useCursor();
  const metrics = useBoxMetrics(targetRef as RefObject<DOMElement>);
  const [origin, setOrigin] = useState<PromptCursorOrigin | null>(null);

  useLayoutEffect(() => {
    if (!isActive || !metrics.hasMeasured) {
      return;
    }

    const absolutePosition = getAbsoluteElementPosition(targetRef.current);
    setOrigin((previous) => {
      if (!absolutePosition) {
        return previous === null ? previous : null;
      }

      if (
        previous?.layoutKey === layoutKey &&
        previous.left === absolutePosition.left &&
        previous.top === absolutePosition.top
      ) {
        return previous;
      }

      return {
        layoutKey,
        left: absolutePosition.left,
        top: absolutePosition.top,
      };
    });
  }, [isActive, layoutKey, metrics.hasMeasured, metrics.height, metrics.left, metrics.top, metrics.width, targetRef]);

  const cursorPosition = resolvePromptTerminalCursorPosition(placement, isActive, layoutKey, origin);
  setCursorPosition(cursorPosition);
  return cursorPosition !== undefined;
}

export function resolvePromptTerminalCursorPosition(
  placement: CursorPlacement,
  isActive: boolean,
  layoutKey: string,
  origin: PromptCursorOrigin | null
): { x: number; y: number } | undefined {
  if (!isActive || origin?.layoutKey !== layoutKey) {
    return undefined;
  }

  return {
    x: Math.max(0, Math.round(origin.left + placement.column)),
    y: Math.max(0, Math.round(origin.top + placement.row)),
  };
}

function getAbsoluteElementPosition(element: DOMElement | null): { left: number; top: number } | null {
  let current: DOMElement | undefined = element ?? undefined;
  let left = 0;
  let top = 0;

  while (current) {
    const layout = current.yogaNode?.getComputedLayout();
    if (!layout) {
      return null;
    }
    left += layout.left;
    top += layout.top;
    current = current.parentNode;
  }

  return { left, top };
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

export function useTerminalExtendedKeys(stdout: NodeJS.WriteStream | undefined, isActive: boolean): void {
  useLayoutEffect(() => {
    if (!isActive || !stdout?.isTTY) {
      return;
    }

    stdout.write(enableTerminalExtendedKeys());
    return () => {
      stdout.write(disableTerminalExtendedKeys());
    };
  }, [isActive, stdout]);
}

export function useBracketedPaste(stdout: NodeJS.WriteStream | undefined, isActive: boolean): void {
  useLayoutEffect(() => {
    if (!isActive || !stdout?.isTTY) {
      return;
    }

    stdout.write(enableBracketedPaste());
    return () => {
      stdout.write(disableBracketedPaste());
    };
  }, [isActive, stdout]);
}
