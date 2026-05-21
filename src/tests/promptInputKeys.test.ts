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
  getPromptReturnKeyAction,
  isClearImageAttachmentsShortcut,
  parseTerminalInput,
  removeCurrentSlashToken,
  toggleSkillSelection,
  renderBufferWithCursor,
  buildInitPromptSubmission,
  buildPromptDraftFromSessionMessage,
  dispatchTerminalInput,
  disableTerminalExtendedKeys,
  enableTerminalExtendedKeys,
  EMPTY_BUFFER,
  insertText,
  backspace,
} from "../ui";
import type { SessionMessage, SkillInfo } from "../session";

function collectDispatchedInput(data: string) {
  const events: ReturnType<typeof parseTerminalInput>[] = [];
  dispatchTerminalInput(data, (input, key) => {
    events.push({ input, key });
  });
  return events;
}

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

test("parseTerminalInput keeps DEL payload for meta+backspace", () => {
  const { input, key } = parseTerminalInput("\u001B\u007F");
  assert.equal(input, "\u007F");
  assert.equal(key.meta, true);
  assert.equal(key.backspace, false);
});

test("dispatchTerminalInput splits iOS CJK composition packets", () => {
  const events = collectDispatchedInput("가\u007F나");
  assert.equal(events.length, 3);
  assert.equal(events[0]?.input, "가");
  assert.equal(events[1]?.input, "");
  assert.equal(events[1]?.key.backspace, true);
  assert.equal(events[2]?.input, "나");
});

test("dispatchTerminalInput applies multi-step CJK composition to the prompt buffer", () => {
  let state = EMPTY_BUFFER;
  dispatchTerminalInput("ㄱ\u007F가\u007F각", (input, key) => {
    if (key.backspace) {
      state = backspace(state);
      return;
    }
    state = insertText(state, input);
  });

  assert.equal(state.text, "각");
  assert.equal(state.cursor, 1);
});

test("dispatchTerminalInput preserves meta+backspace as one event", () => {
  const events = collectDispatchedInput("\u001B\u007F");
  assert.equal(events.length, 1);
  assert.equal(events[0]?.input, "\u007F");
  assert.equal(events[0]?.key.meta, true);
  assert.equal(events[0]?.key.backspace, false);
  assert.equal(events[0]?.key.escape, false);
});

test("dispatchTerminalInput emits consecutive backspaces from one packet", () => {
  const events = collectDispatchedInput("\u007F\u007F");
  assert.equal(events.length, 2);
  assert.equal(events[0]?.key.backspace, true);
  assert.equal(events[1]?.key.backspace, true);
});

test("parseTerminalInput keeps BS payload for meta+backspace", () => {
  const { input, key } = parseTerminalInput("\u001B\b");
  assert.equal(input, "\b");
  assert.equal(key.meta, true);
  assert.equal(key.backspace, false);
});

test("parseTerminalInput recognizes shifted return sequences", () => {
  const { input, key } = parseTerminalInput("\u001B\r");
  assert.equal(input, "\r");
  assert.equal(key.return, true);
  assert.equal(key.shift, true);
  assert.equal(key.meta, false);
});

test("prompt return key action submits on plain enter", () => {
  const { key } = parseTerminalInput("\r");
  assert.equal(getPromptReturnKeyAction(key), "submit");
});

test("prompt return key action inserts newline on shift+enter", () => {
  const { key } = parseTerminalInput("\u001B[13;2u");
  assert.equal(key.return, true);
  assert.equal(key.shift, true);
  assert.equal(getPromptReturnKeyAction(key), "newline");
});

test("parseTerminalInput recognizes alternate shifted return sequences", () => {
  for (const sequence of ["\u001B[13;2~", "\u001B[27;2;13~"]) {
    const { key } = parseTerminalInput(sequence);
    assert.equal(key.return, true);
    assert.equal(key.shift, true);
    assert.equal(getPromptReturnKeyAction(key), "newline");
  }
});

test("terminal extended key helpers request and restore modifyOtherKeys mode", () => {
  assert.equal(enableTerminalExtendedKeys(), "\u001B[>4;1m");
  assert.equal(disableTerminalExtendedKeys(), "\u001B[>4;0m");
});

test("buildPromptDraftFromSessionMessage restores text and image urls", () => {
  const message: SessionMessage = {
    id: "user-with-images",
    sessionId: "session-1",
    role: "user",
    content: "revise this prompt",
    contentParams: [
      { type: "image_url", image_url: { url: "data:image/png;base64,abc" } },
      { type: "text", text: "ignored" },
      { type: "image_url", image_url: { url: "data:image/jpeg;base64,def" } },
    ],
    messageParams: null,
    compacted: false,
    visible: true,
    createTime: "2026-01-01T00:00:00.000Z",
    updateTime: "2026-01-01T00:00:00.000Z",
  };

  assert.deepEqual(buildPromptDraftFromSessionMessage(message, 7), {
    nonce: 7,
    text: "revise this prompt",
    imageUrls: ["data:image/png;base64,abc", "data:image/jpeg;base64,def"],
  });
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

test("parseTerminalInput recognizes ctrl+- modifyOtherKeys sequence (standard)", () => {
  const { input, key } = parseTerminalInput("\u001B[45;5u");
  assert.equal(input, "-");
  assert.equal(key.ctrl, true);
  assert.equal(key.meta, false);
});

test("parseTerminalInput recognizes ctrl+- modifyOtherKeys sequence (extended)", () => {
  const { input, key } = parseTerminalInput("\u001B[27;5;45~");
  assert.equal(input, "-");
  assert.equal(key.ctrl, true);
  assert.equal(key.meta, false);
});

test("parseTerminalInput recognizes raw 0x1F as ctrl+shift+- (redo)", () => {
  const { input, key } = parseTerminalInput("\u001F");
  assert.equal(input, "-");
  assert.equal(key.ctrl, true);
  assert.equal(key.shift, true);
  assert.equal(key.meta, false);
});

test("parseTerminalInput recognizes ctrl+shift+- modifyOtherKeys sequence (standard)", () => {
  const { input, key } = parseTerminalInput("\u001B[45;6u");
  assert.equal(input, "-");
  assert.equal(key.ctrl, true);
  assert.equal(key.shift, true);
  assert.equal(key.meta, false);
});

test("parseTerminalInput recognizes ctrl+shift+- modifyOtherKeys sequence (extended)", () => {
  const { input, key } = parseTerminalInput("\u001B[27;6;45~");
  assert.equal(input, "-");
  assert.equal(key.ctrl, true);
  assert.equal(key.shift, true);
  assert.equal(key.meta, false);
});

test("formatImageAttachmentStatus formats the image count label", () => {
  assert.equal(formatImageAttachmentStatus(0), "");
  assert.equal(formatImageAttachmentStatus(1), "📎 1 image attached");
  assert.equal(formatImageAttachmentStatus(2), "📎 2 images attached");
  assert.equal(IMAGE_ATTACHMENT_CLEAR_HINT, "ctrl+x clear images");
});

test("buildInitPromptSubmission preserves manually selected skills", () => {
  const skill: SkillInfo = { name: "skill-writer", path: "/skills/skill-writer/SKILL.md", description: "Write skills" };

  assert.deepEqual(buildInitPromptSubmission([skill]), {
    text: "/init",
    imageUrls: [],
    selectedSkills: [skill],
  });
  assert.deepEqual(buildInitPromptSubmission([]), { text: "/init", imageUrls: [], selectedSkills: undefined });
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
  assert.equal(stripAnsi(renderBufferWithCursor({ text: "", cursor: 0 }, true, "Ask anything")), "  Ask anything");
  assert.equal(stripAnsi(renderBufferWithCursor({ text: "hello", cursor: 5 }, true)), "hello ");
  assert.equal(stripAnsi(renderBufferWithCursor({ text: "hello", cursor: 1 }, true)), "hello");
  assert.equal(stripAnsi(renderBufferWithCursor({ text: "hello\n", cursor: 6 }, true)), "hello\n ");
  assert.equal(stripAnsi(renderBufferWithCursor({ text: "\n", cursor: 1 }, true)), "\n ");
});

test("renderBufferWithCursor styles exactly one simulated cursor", () => {
  assert.equal((renderBufferWithCursor({ text: "", cursor: 0 }, true).match(ANSI_RE) ?? []).length, 2);
  assert.ok(renderBufferWithCursor({ text: "", cursor: 0 }, true, "Ask anything").includes("\u001B[7m \u001B[27m"));
  assert.equal((renderBufferWithCursor({ text: "hello", cursor: 1 }, true).match(ANSI_RE) ?? []).length, 2);
  assert.equal((renderBufferWithCursor({ text: "hello\nworld", cursor: 6 }, true).match(ANSI_RE) ?? []).length, 2);
});

test("getPromptCursorPlacement targets the prompt row above divider and footer", () => {
  const placement = getPromptCursorPlacement({ text: "hello", cursor: 5 }, 80, 2, "Enter send");
  assert.deepEqual(placement, { rowsUp: 3, column: 7 });
});

test("getPromptCursorPlacement targets the reserved row after a trailing newline", () => {
  const placement = getPromptCursorPlacement({ text: "hello\n", cursor: 6 }, 80, 2, "Enter send");
  assert.deepEqual(placement, { rowsUp: 3, column: 2 });
});

test("getPromptCursorPlacement accounts for CJK character width", () => {
  const placement = getPromptCursorPlacement({ text: "你好", cursor: 2 }, 80, 2, "Enter send");
  assert.equal(placement.column, 6);
});

test("getPromptCursorPlacement accounts for multiline buffer rows", () => {
  const placement = getPromptCursorPlacement({ text: "hello\nworld", cursor: 11 }, 80, 2, "Enter send");
  assert.deepEqual(placement, { rowsUp: 3, column: 7 });
  const middle = getPromptCursorPlacement({ text: "hello\nworld", cursor: 2 }, 80, 2, "Enter send");
  assert.deepEqual(middle, { rowsUp: 4, column: 4 });
});
