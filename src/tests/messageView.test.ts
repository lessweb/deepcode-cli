import { test } from "node:test";
import assert from "node:assert/strict";
import { MessageView, parseDiffPreview } from "../ui";
import type { SessionMessage } from "../session";

test("parseDiffPreview removes headers and classifies lines", () => {
  const lines = parseDiffPreview([
    "--- a/file.txt",
    "+++ b/file.txt",
    "@@ -1,1 +1,1 @@",
    " context",
    "-old",
    "+new"
  ].join("\n"));

  assert.deepEqual(lines, [
    { marker: " ", content: "context", kind: "context" },
    { marker: "-", content: "old", kind: "removed" },
    { marker: "+", content: "new", kind: "added" }
  ]);
});

test("parseDiffPreview keeps nonstandard context lines", () => {
  const lines = parseDiffPreview("...\n+added");
  assert.deepEqual(lines, [
    { marker: " ", content: "...", kind: "context" },
    { marker: "+", content: "added", kind: "added" }
  ]);
});

test("MessageView summarizes thinking content across lines", () => {
  assert.equal(
    getThinkingParams({
      content: "Plan:\n\nInspect the code   and update tests"
    }),
    "Plan: Inspect the code and update tests"
  );
});

test("MessageView removes a trailing colon from thinking summaries", () => {
  assert.equal(getThinkingParams({ content: "Planning:" }), "Planning");
});

test("MessageView falls back to a reasoning placeholder for hidden reasoning content", () => {
  assert.equal(
    getThinkingParams({
      content: "",
      messageParams: { reasoning_content: "hidden chain of thought" }
    }),
    "(reasoning...)"
  );
});

function getThinkingParams(overrides: Partial<SessionMessage>): string {
  const view = MessageView({ message: buildAssistantMessage(overrides) }) as any;
  return view.props.children.props.params;
}

function buildAssistantMessage(overrides: Partial<SessionMessage>): SessionMessage {
  return {
    id: "message-1",
    sessionId: "session-1",
    role: "assistant",
    content: "",
    contentParams: null,
    messageParams: null,
    compacted: false,
    visible: true,
    createTime: "2026-01-01T00:00:00.000Z",
    updateTime: "2026-01-01T00:00:00.000Z",
    meta: { asThinking: true },
    ...overrides
  };
}
