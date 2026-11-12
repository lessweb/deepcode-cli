import assert from "node:assert/strict";
import { test } from "node:test";
import { buildFileDiff } from "../common/file-utils";
import { getDiffDetails, parseLegacyDiffPreview } from "../common/diff-preview";

test("diff line numbers use old positions for deletions and new positions for context", () => {
  const diff = buildFileDiff("file", "before\nold\nafter\n", "before\nnew\nextra\nafter\n");
  assert.deepEqual(diff.details, {
    added: 2,
    removed: 1,
    lines: [
      { kind: "context", content: "before", lineNumber: 1 },
      { kind: "removed", content: "old", lineNumber: 2 },
      { kind: "added", content: "new", lineNumber: 2 },
      { kind: "added", content: "extra", lineNumber: 3 },
      { kind: "context", content: "after", lineNumber: 4 },
    ],
  });
  assert.deepEqual(parseLegacyDiffPreview(diff.preview!), diff.details);
});

test("diff counts survive truncation even when no added lines are visible", () => {
  const old = Array.from({ length: 60 }, (_, i) => `old ${i}`).join("\n");
  const updated = Array.from({ length: 50 }, (_, i) => `new ${i}`).join("\n");
  const diff = buildFileDiff("file", old, updated);
  assert.equal(diff.details?.added, 50);
  assert.equal(diff.details?.removed, 60);
  assert.equal(diff.details?.lines.length, 38);
  assert.deepEqual(diff.details?.lines.at(-1), { kind: "context", content: "...", lineNumber: null });
  assert.deepEqual(parseLegacyDiffPreview(diff.preview!), diff.details);
});

test("creation, insertion, deletion, empty lines and diff-like code retain positions", () => {
  for (const [before, after] of [
    [null, "one\n\n++ code\n-- code\n"],
    ["one\nend\n", "one\nnew\nend\n"],
    ["one\nold\nend\n", "one\nend\n"],
    ["old\n", ""],
    ["", "new\n"],
  ]) {
    const diff = buildFileDiff("file", before, after!);
    assert.deepEqual(parseLegacyDiffPreview(diff.preview!), diff.details);
    assert.ok(diff.details?.lines.every((line) => line.lineNumber !== null && line.lineNumber > 0));
  }
});

test("metadata falls back safely and unchanged files have no diff", () => {
  const diff = buildFileDiff("file", "same\n", "same\n");
  assert.deepEqual(diff, { preview: null, details: null });
  assert.equal(getDiffDetails(null), null);
  assert.equal(getDiffDetails({ diff_details: { lines: [] } }), null);
  assert.deepEqual(getDiffDetails({ diff_details: { lines: null }, diff_preview: "+hello\n..." }), {
    added: 1,
    removed: 0,
    lines: [
      { kind: "added", content: "hello", lineNumber: null },
      { kind: "context", content: "...", lineNumber: null },
    ],
  });
});
