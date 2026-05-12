export type PromptBufferState = {
  text: string;
  cursor: number;
};

export const EMPTY_BUFFER: PromptBufferState = { text: "", cursor: 0 };

export function insertText(state: PromptBufferState, value: string): PromptBufferState {
  if (!value) {
    return state;
  }
  const text = state.text.slice(0, state.cursor) + value + state.text.slice(state.cursor);
  return { text, cursor: state.cursor + value.length };
}

export function backspace(state: PromptBufferState): PromptBufferState {
  if (state.cursor === 0) {
    return state;
  }
  const text = state.text.slice(0, state.cursor - 1) + state.text.slice(state.cursor);
  return { text, cursor: state.cursor - 1 };
}

export function deleteForward(state: PromptBufferState): PromptBufferState {
  if (state.cursor >= state.text.length) {
    return state;
  }
  const text = state.text.slice(0, state.cursor) + state.text.slice(state.cursor + 1);
  return { text, cursor: state.cursor };
}

export function moveLeft(state: PromptBufferState): PromptBufferState {
  if (state.cursor === 0) {
    return state;
  }
  return { ...state, cursor: state.cursor - 1 };
}

export function moveRight(state: PromptBufferState): PromptBufferState {
  if (state.cursor >= state.text.length) {
    return state;
  }
  return { ...state, cursor: state.cursor + 1 };
}

export function moveWordLeft(state: PromptBufferState): PromptBufferState {
  let cursor = state.cursor;
  while (cursor > 0 && /\s/.test(state.text[cursor - 1] ?? "")) {
    cursor--;
  }
  while (cursor > 0 && !/\s/.test(state.text[cursor - 1] ?? "")) {
    cursor--;
  }
  return { ...state, cursor };
}

export function moveWordRight(state: PromptBufferState): PromptBufferState {
  let cursor = state.cursor;
  while (cursor < state.text.length && /\s/.test(state.text[cursor] ?? "")) {
    cursor++;
  }
  while (cursor < state.text.length && !/\s/.test(state.text[cursor] ?? "")) {
    cursor++;
  }
  return { ...state, cursor };
}

export function moveUp(state: PromptBufferState): PromptBufferState {
  const { line, column, lineStart } = locate(state);
  if (line === 0) {
    return { ...state, cursor: 0 };
  }
  const previousLineEnd = lineStart - 1;
  const previousLineStart = state.text.lastIndexOf("\n", previousLineEnd - 1) + 1;
  const previousLineLength = previousLineEnd - previousLineStart;
  const targetColumn = Math.min(column, previousLineLength);
  return { ...state, cursor: previousLineStart + targetColumn };
}

export function moveDown(state: PromptBufferState): PromptBufferState {
  const { column, lineEnd } = locate(state);
  if (lineEnd >= state.text.length) {
    return { ...state, cursor: state.text.length };
  }
  const nextLineStart = lineEnd + 1;
  const nextLineNewline = state.text.indexOf("\n", nextLineStart);
  const nextLineEnd = nextLineNewline === -1 ? state.text.length : nextLineNewline;
  const nextLineLength = nextLineEnd - nextLineStart;
  const targetColumn = Math.min(column, nextLineLength);
  return { ...state, cursor: nextLineStart + targetColumn };
}

export function moveLineStart(state: PromptBufferState): PromptBufferState {
  const { lineStart } = locate(state);
  return { ...state, cursor: lineStart };
}

export function moveLineEnd(state: PromptBufferState): PromptBufferState {
  const { lineEnd } = locate(state);
  return { ...state, cursor: lineEnd };
}

export function killLine(state: PromptBufferState): PromptBufferState {
  const { lineEnd } = locate(state);
  if (state.cursor >= lineEnd) {
    return state;
  }
  const text = state.text.slice(0, state.cursor) + state.text.slice(lineEnd);
  return { text, cursor: state.cursor };
}

export function deleteWordBefore(state: PromptBufferState): PromptBufferState {
  const end = state.cursor;
  let start = end;
  while (start > 0 && /\s/.test(state.text[start - 1] ?? "")) {
    start--;
  }
  while (start > 0 && !/\s/.test(state.text[start - 1] ?? "")) {
    start--;
  }
  if (start === end) {
    return state;
  }
  return {
    text: state.text.slice(0, start) + state.text.slice(end),
    cursor: start,
  };
}

export function deleteWordAfter(state: PromptBufferState): PromptBufferState {
  const start = state.cursor;
  let end = start;
  while (end < state.text.length && /\s/.test(state.text[end] ?? "")) {
    end++;
  }
  while (end < state.text.length && !/\s/.test(state.text[end] ?? "")) {
    end++;
  }
  if (start === end) {
    return state;
  }
  return {
    text: state.text.slice(0, start) + state.text.slice(end),
    cursor: start,
  };
}

export function reset(): PromptBufferState {
  return { ...EMPTY_BUFFER };
}

export function isEmpty(state: PromptBufferState): boolean {
  return state.text.length === 0;
}

export function getCurrentSlashToken(state: PromptBufferState): string | null {
  const text = state.text;
  if (text.length === 0) {
    return null;
  }
  const beforeCursor = text.slice(0, state.cursor);
  const lastNewline = beforeCursor.lastIndexOf("\n");
  const lineStart = lastNewline + 1;
  const line = beforeCursor.slice(lineStart);
  if (!line.startsWith("/")) {
    return null;
  }
  if (/\s/.test(line)) {
    return null;
  }
  return line;
}

function locate(state: PromptBufferState): {
  line: number;
  column: number;
  lineStart: number;
  lineEnd: number;
} {
  const before = state.text.slice(0, state.cursor);
  const lineStart = before.lastIndexOf("\n") + 1;
  const lineNumber = before.split("\n").length - 1;
  const after = state.text.slice(state.cursor);
  const nextNewline = after.indexOf("\n");
  const lineEnd = nextNewline === -1 ? state.text.length : state.cursor + nextNewline;
  return {
    line: lineNumber,
    column: state.cursor - lineStart,
    lineStart,
    lineEnd,
  };
}
