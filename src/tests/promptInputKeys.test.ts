import { test } from "node:test";
import assert from "node:assert/strict";

const ANSI_RE = /\u001b\[[0-9;]*m/g;
function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

import {
  IMAGE_ATTACHMENT_CLEAR_HINT,
  addUniqueSkill,
  formatImageAttachmentStatus,
  formatSelectedSkillsStatus,
  getPromptCursorPlacement,
  isClearImageAttachmentsShortcut,
  parseTerminalInput,
  removeCurrentSlashToken,
  toggleSkillSelection,
  renderBufferWithCursor
} from "../ui";
import type { SkillInfo } from "../session";

test("parseTerminalInput treats DEL bytes as backspace", () => {
  const { input, key } = parseTerminalInput("\u007F");
  assert.equal(input, "");
  assert.equal(key.backspace, true);
  assert.equal(key.delete, false);
});

test("parseTerminalInput treats CSI 3 tilde as forward delete", () => {
  const { input, key } = parseTerminalInput("\u001B[3~");
  assert.equal(input, "");
  assert.equal(key.delete, true);
  assert.equal(key.backspace, false);
});

test("parseTerminalInput does not mark plain arrow keys as meta", () => {
  const { key } = parseTerminalInput("\u001B[A");
  assert.equal(key.upArrow, true);
  assert.equal(key.meta, false);
});

test("parseTerminalInput recognizes home and end keys", () => {
  const home = parseTerminalInput("\u001B[H");
  const end = parseTerminalInput("\u001B[F");
  assert.equal(home.key.home, true);
  assert.equal(home.key.meta, false);
  assert.equal(end.key.end, true);
  assert.equal(end.key.meta, false);
});

test("parseTerminalInput recognizes word navigation modifiers", () => {
  const ctrlLeft = parseTerminalInput("\u001B[1;5D");
  const metaRight = parseTerminalInput("\u001Bf");
  assert.equal(ctrlLeft.key.leftArrow, true);
  assert.equal(ctrlLeft.key.ctrl, true);
  assert.equal(ctrlLeft.key.meta, false);
  assert.equal(metaRight.input, "f");
  assert.equal(metaRight.key.rightArrow, true);
  assert.equal(metaRight.key.meta, true);
});

test("parseTerminalInput recognizes shifted return sequences", () => {
  const { input, key } = parseTerminalInput("\u001B\r");
  assert.equal(input, "\r");
  assert.equal(key.return, true);
  assert.equal(key.shift, true);
  assert.equal(key.meta, false);
});

test("parseTerminalInput recognizes terminal focus events", () => {
  const focusIn = parseTerminalInput("\u001B[I");
  const focusOut = parseTerminalInput("\u001B[O");
  assert.equal(focusIn.key.focusIn, true);
  assert.equal(focusIn.key.meta, false);
  assert.equal(focusOut.key.focusOut, true);
  assert.equal(focusOut.key.meta, false);
});

test("parseTerminalInput recognizes ctrl+x as the image attachment clear shortcut", () => {
  const { input, key } = parseTerminalInput("\u0018");
  assert.equal(input, "x");
  assert.equal(key.ctrl, true);
  assert.equal(isClearImageAttachmentsShortcut(input, key), true);
});

test("formatImageAttachmentStatus formats the image count label", () => {
  assert.equal(formatImageAttachmentStatus(0), "");
  assert.equal(formatImageAttachmentStatus(1), "📎 1 image attached");
  assert.equal(formatImageAttachmentStatus(2), "📎 2 images attached");
  assert.equal(IMAGE_ATTACHMENT_CLEAR_HINT, "ctrl+x clear images");
});

test("selected skill helpers format, dedupe, toggle, and clear slash tokens", () => {
  const skill: SkillInfo = { name: "skill-writer", path: "/skills/skill-writer/SKILL.md", description: "Write skills" };
  const other: SkillInfo = { name: "code-review", path: "/skills/code-review/SKILL.md", description: "Review code" };

  assert.equal(formatSelectedSkillsStatus([]), "");
  assert.equal(formatSelectedSkillsStatus([skill, other]), "⚡ skill-writer, code-review");
  assert.deepEqual(addUniqueSkill([skill], skill), [skill]);
  assert.deepEqual(addUniqueSkill([skill], other), [skill, other]);
  assert.deepEqual(toggleSkillSelection([skill], skill), []);
  assert.deepEqual(toggleSkillSelection([skill], other), [skill, other]);
  assert.deepEqual(removeCurrentSlashToken({ text: "use /skill-writer", cursor: 17 }), { text: "use ", cursor: 4 });
});

test("renderBufferWithCursor hides the simulated cursor when unfocused", () => {
  assert.equal(renderBufferWithCursor({ text: "hello", cursor: 5 }, false), "hello");
  assert.equal(renderBufferWithCursor({ text: "hello", cursor: 1 }, false), "hello");
});

test("renderBufferWithCursor draws the simulated cursor when focused", () => {
  assert.equal(stripAnsi(renderBufferWithCursor({ text: "", cursor: 0 }, true)), " ");
  assert.equal(stripAnsi(renderBufferWithCursor({ text: "hello", cursor: 5 }, true)), "hello ");
  assert.equal(stripAnsi(renderBufferWithCursor({ text: "hello", cursor: 1 }, true)), "hello");
  assert.equal(stripAnsi(renderBufferWithCursor({ text: "hello\n", cursor: 6 }, true)), "hello\n ");
  assert.equal(stripAnsi(renderBufferWithCursor({ text: "\n", cursor: 1 }, true)), "\n ");
});

test("renderBufferWithCursor styles exactly one simulated cursor", () => {
  assert.equal((renderBufferWithCursor({ text: "", cursor: 0 }, true).match(ANSI_RE) ?? []).length, 2);
  assert.equal((renderBufferWithCursor({ text: "hello", cursor: 1 }, true).match(ANSI_RE) ?? []).length, 2);
  assert.equal((renderBufferWithCursor({ text: "hello\nworld", cursor: 6 }, true).match(ANSI_RE) ?? []).length, 2);
});

test("getPromptCursorPlacement targets the prompt row above divider and footer", () => {
  const placement = getPromptCursorPlacement({ text: "hello", cursor: 5 }, 80, 2, 2);
  assert.deepEqual(placement, { rowsUp: 3, column: 7 });
});

test("getPromptCursorPlacement targets the reserved row after a trailing newline", () => {
  const placement = getPromptCursorPlacement({ text: "hello\n", cursor: 6 }, 80, 2, 2);
  assert.deepEqual(placement, { rowsUp: 3, column: 2 });
});

test("getPromptCursorPlacement accounts for CJK character width", () => {
  const placement = getPromptCursorPlacement({ text: "你好", cursor: 2 }, 80, 2, 2);
  assert.equal(placement.column, 6);
});

test("getPromptCursorPlacement accounts for multiline buffer rows", () => {
  const placement = getPromptCursorPlacement({ text: "hello\nworld", cursor: 11 }, 80, 2, 2);
  assert.deepEqual(placement, { rowsUp: 3, column: 7 });
  const middle = getPromptCursorPlacement({ text: "hello\nworld", cursor: 2 }, 80, 2, 2);
  assert.deepEqual(middle, { rowsUp: 4, column: 4 });
});
