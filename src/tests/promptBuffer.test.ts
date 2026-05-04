import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_BUFFER,
  backspace,
  deleteForward,
  deleteWordBefore,
  getCurrentSlashToken,
  insertText,
  killLine,
  moveDown,
  moveLeft,
  moveLineEnd,
  moveLineStart,
  moveRight,
  moveWordLeft,
  moveWordRight,
  moveUp
} from "../ui";

test("insertText appends text and advances the cursor", () => {
  const next = insertText(EMPTY_BUFFER, "hello");
  assert.equal(next.text, "hello");
  assert.equal(next.cursor, 5);
});

test("backspace removes the character before the cursor", () => {
  const a = insertText(EMPTY_BUFFER, "abc");
  const b = backspace(a);
  assert.equal(b.text, "ab");
  assert.equal(b.cursor, 2);
});

test("backspace at start is a no-op", () => {
  const result = backspace({ text: "hi", cursor: 0 });
  assert.equal(result.text, "hi");
  assert.equal(result.cursor, 0);
});

test("deleteForward removes the character after the cursor", () => {
  const result = deleteForward({ text: "hello", cursor: 1 });
  assert.equal(result.text, "hllo");
  assert.equal(result.cursor, 1);
});

test("moveLeft and moveRight clamp at boundaries", () => {
  const left = moveLeft({ text: "hi", cursor: 0 });
  assert.equal(left.cursor, 0);
  const right = moveRight({ text: "hi", cursor: 2 });
  assert.equal(right.cursor, 2);
});

test("word movement skips whitespace and preserves buffer text", () => {
  const buffer = { text: "hello  brave world", cursor: 18 };
  assert.deepEqual(moveWordLeft(buffer), { text: buffer.text, cursor: 13 });
  assert.deepEqual(moveWordRight({ text: buffer.text, cursor: 5 }), { text: buffer.text, cursor: 12 });
});

test("moveUp navigates to the previous line preserving column", () => {
  const buffer = { text: "hello\nworld", cursor: 9 };
  const result = moveUp(buffer);
  assert.equal(result.cursor, 3);
});

test("moveUp from first line moves to start of buffer", () => {
  const buffer = { text: "hello", cursor: 3 };
  const result = moveUp(buffer);
  assert.equal(result.cursor, 0);
});

test("moveDown moves to next line preserving column", () => {
  const buffer = { text: "hello\nworld", cursor: 3 };
  const result = moveDown(buffer);
  assert.equal(result.cursor, 9);
});

test("moveLineStart and moveLineEnd respect line boundaries", () => {
  const buffer = { text: "first\nsecond line", cursor: 9 };
  const start = moveLineStart(buffer);
  assert.equal(start.cursor, 6);
  const end = moveLineEnd(buffer);
  assert.equal(end.cursor, "first\nsecond line".length);
});

test("killLine removes from the cursor to end of line only", () => {
  const buffer = { text: "abc\nxyz", cursor: 1 };
  const result = killLine(buffer);
  assert.equal(result.text, "a\nxyz");
});

test("deleteWordBefore removes the previous word and any adjacent whitespace", () => {
  const result = deleteWordBefore({ text: "ask the model", cursor: 8 });
  assert.equal(result.text, "ask model");
  assert.equal(result.cursor, 4);
});

test("getCurrentSlashToken returns the slash word at the cursor", () => {
  const buffer = { text: "/skill", cursor: 6 };
  assert.equal(getCurrentSlashToken(buffer), "/skill");
});

test("getCurrentSlashToken returns null when token contains whitespace", () => {
  const buffer = { text: "/skill foo", cursor: 10 };
  assert.equal(getCurrentSlashToken(buffer), null);
});

test("getCurrentSlashToken supports slash on a new line", () => {
  const buffer = { text: "do this\n/n", cursor: 10 };
  assert.equal(getCurrentSlashToken(buffer), "/n");
});

test("getCurrentSlashToken returns null when no slash prefix", () => {
  const buffer = { text: "hello", cursor: 5 };
  assert.equal(getCurrentSlashToken(buffer), null);
});

test("inserting newlines builds a multi-line buffer", () => {
  let buf = EMPTY_BUFFER;
  buf = insertText(buf, "abc");
  buf = insertText(buf, "\n");
  buf = insertText(buf, "def");
  assert.equal(buf.text, "abc\ndef");
  assert.equal(buf.cursor, 7);
});
