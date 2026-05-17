import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

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
  parsePromptFileReferenceTokens,
  resolvePromptFileReferences,
  removeCurrentSlashToken,
  toggleSkillSelection,
  renderBufferWithCursor,
  buildInitPromptSubmission,
  disableTerminalExtendedKeys,
  enableTerminalExtendedKeys,
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

test("parseTerminalInput keeps DEL payload for meta+backspace", () => {
  const { input, key } = parseTerminalInput("\u001B\u007F");
  assert.equal(input, "\u007F");
  assert.equal(key.meta, true);
  assert.equal(key.backspace, false);
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

test("parsePromptFileReferenceTokens supports unquoted and quoted @file paths", () => {
  assert.deepEqual(parsePromptFileReferenceTokens('review @src/index.ts and @"docs/file with spaces.md"'), [
    { raw: "@src/index.ts", path: "src/index.ts", start: 7, end: 20 },
    { raw: '@"docs/file with spaces.md"', path: "docs/file with spaces.md", start: 25, end: 52 },
  ]);
});

test("parsePromptFileReferenceTokens ignores email-like mentions and trims punctuation", () => {
  assert.deepEqual(parsePromptFileReferenceTokens("mail a@b.com, then inspect @src/app.ts."), [
    { raw: "@src/app.ts", path: "src/app.ts", start: 27, end: 38 },
  ]);
});

test("resolvePromptFileReferences resolves text files relative to the project root", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "deepcode-file-ref-"));
  try {
    fs.mkdirSync(path.join(workspace, "src"), { recursive: true });
    fs.writeFileSync(path.join(workspace, "src", "app.ts"), "export const value = 1;\r\n", "utf8");

    const result = resolvePromptFileReferences("review @src/app.ts", workspace);

    assert.deepEqual(result.errors, []);
    assert.equal(result.references.length, 1);
    assert.equal(result.references[0]?.displayPath, "src/app.ts");
    assert.equal(result.references[0]?.path, path.join(workspace, "src", "app.ts"));
    assert.equal(result.references[0]?.content, undefined);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("resolvePromptFileReferences reports missing, directory, binary, and oversized files", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "deepcode-file-ref-errors-"));
  try {
    fs.mkdirSync(path.join(workspace, "src"), { recursive: true });
    fs.writeFileSync(path.join(workspace, "binary.dat"), Buffer.from([0, 1, 2]));
    fs.writeFileSync(path.join(workspace, "large.txt"), "abcd", "utf8");

    const result = resolvePromptFileReferences("check @missing.ts @src @binary.dat @large.txt", workspace, {
      maxFileBytes: 3,
      maxTotalBytes: 256,
    });

    assert.deepEqual(
      result.errors.map((error) => error.raw),
      ["@missing.ts", "@src", "@binary.dat", "@large.txt"]
    );
    assert.equal(result.references.length, 0);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
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
