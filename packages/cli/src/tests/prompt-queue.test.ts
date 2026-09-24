import { test } from "node:test";
import assert from "node:assert/strict";

import { formatQueueHint, formatQueuedPromptPreview } from "../ui";

test("formatQueuedPromptPreview collapses whitespace and truncates long prompts", () => {
  assert.equal(formatQueuedPromptPreview("  fix   the\n\nfailing test  "), "fix the failing test");
  assert.equal(formatQueuedPromptPreview("a".repeat(80), 0, 20), `${"a".repeat(19)}…`);
  assert.equal(formatQueuedPromptPreview("", 0), "");
});

test("formatQueuedPromptPreview falls back to the image count for image-only prompts", () => {
  assert.equal(formatQueuedPromptPreview("", 1), "[1 image]");
  assert.equal(formatQueuedPromptPreview("   ", 2), "[2 images]");
});

test("formatQueueHint describes how many prompts wait for the next step", () => {
  assert.equal(formatQueueHint(0), "");
  assert.equal(formatQueueHint(1), "1 guidance queued · backspace to remove");
  assert.equal(formatQueueHint(3), "3 guidance queued · backspace to remove");
});
