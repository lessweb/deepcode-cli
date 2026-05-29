import { test } from "node:test";
import assert from "node:assert/strict";
import { findPendingAskUserQuestion, formatAskUserQuestionAnswers, formatAskUserQuestionDecline } from "../ui";
import type { SessionMessage } from "../session";

function message(content: unknown): SessionMessage {
  const now = "2026-04-29T00:00:00.000Z";
  return {
    id: "tool-message",
    sessionId: "session-id",
    role: "tool",
    content: JSON.stringify(content),
    contentParams: null,
    messageParams: { tool_call_id: "call-id" },
    compacted: false,
    visible: true,
    createTime: now,
    updateTime: now,
  };
}

test("findPendingAskUserQuestion returns latest pending AskUserQuestion tool message", () => {
  const pending = findPendingAskUserQuestion(
    [
      message({ ok: true, name: "read" }),
      message({
        ok: true,
        name: "AskUserQuestion",
        awaitUserResponse: true,
        metadata: {
          kind: "ask_user_question",
          questions: [
            {
              question: "Which package manager should we use?",
              options: [{ label: "npm", description: "Use package-lock.json." }, { label: "yarn" }],
            },
          ],
        },
      }),
    ],
    "waiting_for_user"
  );

  assert.equal(pending?.messageId, "tool-message");
  assert.equal(pending?.questions[0]?.question, "Which package manager should we use?");
  assert.equal(pending?.questions[0]?.options[0]?.description, "Use package-lock.json.");
});

test("findPendingAskUserQuestion preserves multiple pending questions in order", () => {
  const pending = findPendingAskUserQuestion(
    [
      message({
        ok: true,
        name: "AskUserQuestion",
        awaitUserResponse: true,
        metadata: {
          kind: "ask_user_question",
          questions: [
            {
              question: "Use default description?",
              options: [{ label: "Yes" }, { label: "Custom" }],
            },
            {
              question: "Where should the project be created?",
              options: [{ label: "Current directory" }, { label: "Custom path" }],
            },
          ],
        },
      }),
    ],
    "waiting_for_user"
  );

  assert.deepEqual(
    pending?.questions.map((question) => question.question),
    ["Use default description?", "Where should the project be created?"]
  );
});

test("findPendingAskUserQuestion ignores questions unless session waits for user", () => {
  const pending = findPendingAskUserQuestion(
    [
      message({
        ok: true,
        name: "AskUserQuestion",
        awaitUserResponse: true,
        metadata: {
          kind: "ask_user_question",
          questions: [{ question: "Continue?", options: [{ label: "Yes" }] }],
        },
      }),
    ],
    "processing"
  );

  assert.equal(pending, null);
});

test("formatAskUserQuestionAnswers creates model-readable answer text", () => {
  assert.equal(
    formatAskUserQuestionAnswers({
      "Which package manager?": "yarn",
      "Any notes?": "Use the existing lockfile",
    }),
    'User has answered your questions: "Which package manager?"="yarn", "Any notes?"="Use the existing lockfile". You can now continue with the user\'s answers in mind.'
  );
});

test("formatAskUserQuestionDecline creates decline text", () => {
  assert.match(formatAskUserQuestionDecline(), /declined to answer/);
});
