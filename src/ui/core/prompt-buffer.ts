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
  if (text.length === 0 || !text.startsWith("/")) {
    return null;
  }
  return text;
}

/**
 * Regex matching paste markers like `[paste #1 +123 lines]` or `[paste #2 1234 chars]`.
 * When the user pastes a large block of text (>10 lines or >1000 chars), a compact
 * marker is inserted instead of the full content. The actual content is stored in a
 * Map and expanded back before submission.
 */
export const PASTE_MARKER_REGEX = /\[paste #(\d+) (\+?\d+ lines|\d+ chars)\]/g;

/**
 * Find the paste marker that ends exactly at `state.cursor`, if any.
 * Returns the marker's start and end positions, or `null`.
 */
export function findPasteMarkerBefore(state: PromptBufferState): { start: number; end: number } | null {
  // Walk backwards through all markers and return the one that ends at the cursor.
  let match: RegExpExecArray | null;
  PASTE_MARKER_REGEX.lastIndex = 0;
  while ((match = PASTE_MARKER_REGEX.exec(state.text)) !== null) {
    if (match.index + match[0].length === state.cursor) {
      return { start: match.index, end: match.index + match[0].length };
    }
  }
  return null;
}

/**
 * Find the paste marker that starts exactly at `state.cursor`, if any.
 * Returns the marker's start and end positions, or `null`.
 */
export function findPasteMarkerAt(state: PromptBufferState): { start: number; end: number } | null {
  let match: RegExpExecArray | null;
  PASTE_MARKER_REGEX.lastIndex = 0;
  while ((match = PASTE_MARKER_REGEX.exec(state.text)) !== null) {
    if (match.index === state.cursor) {
      return { start: match.index, end: match.index + match[0].length };
    }
  }
  return null;
}

/**
 * If the cursor is immediately after a paste marker, delete the entire marker
 * (atomic backspace). Returns the new state, or `state` unchanged if no marker.
 */
export function deletePasteMarkerBackward(
  state: PromptBufferState,
  validIds: Map<number, unknown>
): PromptBufferState | null {
  const marker = findPasteMarkerBefore(state);
  if (!marker) return null;
  // Only delete if this is a real paste marker (ID in validIds).
  PASTE_MARKER_REGEX.lastIndex = 0;
  const m = PASTE_MARKER_REGEX.exec(state.text.slice(marker.start, marker.end));
  if (!m || !validIds.has(Number.parseInt(m[1]!, 10))) return null;
  const text = state.text.slice(0, marker.start) + state.text.slice(marker.end);
  return { text, cursor: marker.start };
}

/**
 * If the cursor is at the start of a paste marker, delete the entire marker
 * (atomic forward delete). Returns the new state, or `state` unchanged if no marker.
 */
export function deletePasteMarkerForward(
  state: PromptBufferState,
  validIds: Map<number, unknown>
): PromptBufferState | null {
  const marker = findPasteMarkerAt(state);
  if (!marker) return null;
  // Only delete if this is a real paste marker (ID in validIds).
  PASTE_MARKER_REGEX.lastIndex = 0;
  const m = PASTE_MARKER_REGEX.exec(state.text.slice(marker.start, marker.end));
  if (!m || !validIds.has(Number.parseInt(m[1]!, 10))) return null;
  const text = state.text.slice(0, marker.start) + state.text.slice(marker.end);
  return { text, cursor: marker.start };
}

/**
 * Sanitize stored paste content (filter control chars, expand tabs).
 * Called lazily on expand/submit, not during paste to keep paste instant.
 */
export function cleanPasteContent(text: string): string {
  return text
    .replace(/\r\n|\r/g, "\n")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
    .replace(/\t/g, "    ");
}

/**
 * Expand paste markers in the text back to their original (cleaned) content.
 * @param text - Text potentially containing paste markers.
 * @param pastes - Map of paste ID → original content.
 */
export function expandPasteMarkers(text: string, pastes: Map<number, string>): string {
  if (pastes.size === 0) return text;
  let result = text;
  for (const [pasteId, pasteContent] of pastes) {
    const markerRegex = new RegExp(`\\[paste #${pasteId} (\\+?\\d+ lines|\\d+ chars)\\]`, "g");
    result = result.replace(markerRegex, () => cleanPasteContent(pasteContent));
  }
  return result;
}

/**
 * Find the paste marker that contains `state.cursor`, if any.
 * Returns the marker's start, end, and numeric paste ID, or `null`.
 */
export function findPasteMarkerContaining(state: PromptBufferState): { start: number; end: number; id: number } | null {
  let match: RegExpExecArray | null;
  PASTE_MARKER_REGEX.lastIndex = 0;
  while ((match = PASTE_MARKER_REGEX.exec(state.text)) !== null) {
    if (match.index <= state.cursor && match.index + match[0].length >= state.cursor) {
      return {
        start: match.index,
        end: match.index + match[0].length,
        id: Number.parseInt(match[1]!, 10),
      };
    }
  }
  return null;
}

/**
 * Check whether the text contains real paste markers (IDs present in validIds).
 */
export function hasActivePasteMarkers(text: string, validIds: Map<number, unknown>): boolean {
  if (!text.includes("[paste #")) return false;
  PASTE_MARKER_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PASTE_MARKER_REGEX.exec(text)) !== null) {
    if (validIds.has(Number.parseInt(match[1]!, 10))) {
      return true;
    }
  }
  return false;
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
