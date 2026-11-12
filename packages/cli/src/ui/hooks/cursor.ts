import { useCursor, useBoxMetrics } from "ink";
import stringWidth from "string-width";
import { useLayoutEffect, useState } from "react";
import type { RefObject } from "react";
import type { DOMElement } from "ink";
import type { PromptBufferState } from "../core/prompt-buffer";
import { wrapPromptText } from "../core/prompt-wrap";

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
  const { row, column } = measurePromptCursor(state, screenWidth, initialColumn);
  return { row, column };
}

export function isPromptCursorAtWrapBoundary(state: PromptBufferState, screenWidth: number): boolean {
  return measurePromptCursor(state, screenWidth).softWrapped;
}

const graphemes = new Intl.Segmenter();

function measurePromptCursor(state: PromptBufferState, screenWidth: number, initialColumn = 0) {
  const width = Math.max(1, screenWidth);
  const indent = Math.max(0, Math.min(initialColumn, width - 1));
  const contentWidth = width - indent;
  const cursor = Math.max(0, Math.min(state.cursor, state.text.length));
  let sourceStart = 0;
  let row = 0;

  for (const line of state.text.split("\n")) {
    // wrap-ansi normalizes Unicode and expands tabs. Keep the cursor's source
    // offset while applying those transformations, snapping inside a grapheme
    // to its first cell rather than measuring partial emoji or accents.
    let normalized = "";
    let offset = 0;
    for (const { segment, index } of graphemes.segment(line)) {
      const value = segment === "\t" ? " ".repeat(8 - (stringWidth(normalized) % 8)) : segment.normalize();
      normalized += value;
      if (sourceStart + index + segment.length <= cursor) {
        offset = normalized.length;
      }
    }

    // Use the same CJK-aware wrapping as PromptText. The suffix matters even before the cursor:
    // it can move the entire word containing that cursor onto the next row.
    const rows = wrapPromptText(normalized, contentWidth).split("\n");
    if (cursor > sourceStart + line.length) {
      row += rows.length;
      sourceStart += line.length + 1;
      continue;
    }

    let wrappedRow = 0;
    for (; wrappedRow < rows.length - 1; wrappedRow++) {
      const length = rows[wrappedRow]!.length;
      if (offset < length) break;
      offset -= length;
    }
    const column = stringWidth(rows[wrappedRow]!.slice(0, offset));
    // An inline cursor reserves the next row at an exact-width line end.
    const pendingWrap = column >= contentWidth;
    return {
      row: row + wrappedRow + (pendingWrap ? 1 : 0),
      column: indent + (pendingWrap ? 0 : column),
      softWrapped: wrappedRow > 0 || pendingWrap,
    };
  }

  return { row, column: indent, softWrapped: false };
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
