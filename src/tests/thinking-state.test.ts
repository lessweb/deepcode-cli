import { test } from "node:test";
import assert from "node:assert/strict";
import { findExpandedThinkingId } from "../ui";
import type { SessionMessage } from "../session";

function buildMessage(
  id: string,
  role: SessionMessage["role"],
  options: { asThinking?: boolean } = {}
): SessionMessage {
  return {
    id,
    sessionId: "s",
    role,
    content: "",
    contentParams: null,
    messageParams: null,
    compacted: false,
    visible: true,
    createTime: "2026-04-28T00:00:00.000Z",
    updateTime: "2026-04-28T00:00:00.000Z",
    meta: options.asThinking ? { asThinking: true } : undefined,
  };
}

test("findExpandedThinkingId returns null on an empty list", () => {
  assert.equal(findExpandedThinkingId([]), null);
});

test("findExpandedThinkingId returns the only thinking id when there is no final reply", () => {
  const messages = [buildMessage("user", "user"), buildMessage("a-1", "assistant", { asThinking: true })];
  assert.equal(findExpandedThinkingId(messages), "a-1");
});

test("findExpandedThinkingId always picks the latest thinking id", () => {
  const messages = [
    buildMessage("a-1", "assistant", { asThinking: true }),
    buildMessage("tool", "tool"),
    buildMessage("a-2", "assistant", { asThinking: true }),
  ];
  assert.equal(findExpandedThinkingId(messages), "a-2");
});

test("findExpandedThinkingId returns null after a non-thinking assistant reply", () => {
  const messages = [buildMessage("a-1", "assistant", { asThinking: true }), buildMessage("a-final", "assistant")];
  assert.equal(findExpandedThinkingId(messages), null);
});

test("findExpandedThinkingId picks the thinking id that follows the last final reply", () => {
  const messages = [
    buildMessage("a-1", "assistant", { asThinking: true }),
    buildMessage("a-final", "assistant"),
    buildMessage("a-2", "assistant", { asThinking: true }),
    buildMessage("a-3", "assistant", { asThinking: true }),
  ];
  assert.equal(findExpandedThinkingId(messages), "a-3");
});
