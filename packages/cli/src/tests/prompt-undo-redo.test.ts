import { test } from "node:test";
import assert from "node:assert/strict";

import { removeCurrentSlashToken } from "../ui";
import {
  clearPromptUndoRedoState,
  createPromptUndoRedoState,
  recordPromptEdit,
  redoPromptEdit,
  undoPromptEdit,
} from "../ui/core/prompt-undo-redo";

test("prompt undo and redo restore edited buffer states", () => {
  const history = createPromptUndoRedoState();
  const empty = { text: "", cursor: 0 };
  const hello = { text: "hello", cursor: 5 };

  recordPromptEdit(history, empty, hello);

  assert.deepEqual(undoPromptEdit(history, hello), empty);
  assert.deepEqual(redoPromptEdit(history, empty), hello);
});

test("prompt redo history is cleared after a new edit", () => {
  const history = createPromptUndoRedoState();
  const empty = { text: "", cursor: 0 };
  const first = { text: "first", cursor: 5 };
  const second = { text: "second", cursor: 6 };

  recordPromptEdit(history, empty, first);
  assert.deepEqual(undoPromptEdit(history, first), empty);

  recordPromptEdit(history, empty, second);

  assert.equal(redoPromptEdit(history, second), null);
});

test("prompt undo ignores cursor-only movement", () => {
  const history = createPromptUndoRedoState();
  const before = { text: "hello", cursor: 5 };
  const after = { text: "hello", cursor: 0 };

  recordPromptEdit(history, before, after);

  assert.equal(undoPromptEdit(history, after), null);
});

test("clearing consumed slash token drops undo and redo history", () => {
  const history = createPromptUndoRedoState();
  const empty = { text: "", cursor: 0 };
  const slashCommand = { text: "/model", cursor: 6 };

  recordPromptEdit(history, empty, slashCommand);
  const cleared = removeCurrentSlashToken(slashCommand);
  clearPromptUndoRedoState(history);

  assert.deepEqual(cleared, { text: "", cursor: 0 });
  assert.equal(undoPromptEdit(history, cleared), null);
  assert.equal(redoPromptEdit(history, cleared), null);
});
