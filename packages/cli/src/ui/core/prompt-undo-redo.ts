import type { PromptBufferState } from "./prompt-buffer";

export type PromptUndoRedoState = {
  undoStack: PromptBufferState[];
  redoStack: PromptBufferState[];
};

export function createPromptUndoRedoState(): PromptUndoRedoState {
  return { undoStack: [], redoStack: [] };
}

export function recordPromptEdit(
  history: PromptUndoRedoState,
  current: PromptBufferState,
  next: PromptBufferState,
  maxUndoEntries = 1000
): void {
  if (next.text === current.text || next.text === history.undoStack.at(-1)?.text) {
    return;
  }

  history.undoStack.push(current);
  if (history.undoStack.length > maxUndoEntries) {
    history.undoStack = history.undoStack.slice(-maxUndoEntries);
  }
  history.redoStack = [];
}

export function undoPromptEdit(history: PromptUndoRedoState, current: PromptBufferState): PromptBufferState | null {
  const previous = history.undoStack.pop();
  if (!previous) {
    return null;
  }

  history.redoStack.push(current);
  return previous;
}

export function redoPromptEdit(history: PromptUndoRedoState, current: PromptBufferState): PromptBufferState | null {
  const next = history.redoStack.pop();
  if (!next) {
    return null;
  }

  history.undoStack.push(current);
  return next;
}

export function clearPromptUndoRedoState(history: PromptUndoRedoState): void {
  history.undoStack = [];
  history.redoStack = [];
}
