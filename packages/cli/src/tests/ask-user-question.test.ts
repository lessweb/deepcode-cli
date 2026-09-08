import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyOtherAnswerEdit,
  findPendingAskUserQuestion,
  formatAskUserQuestionAnswers,
  formatAskUserQuestionDecline,
} from "../ui";
import type { PromptBufferState } from "../ui";
import { parseTerminalInput } from "../ui/hooks";
import type { SessionMessage } from "@vegamo/deepcode-core";

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
    [
      "Questions 2/2 answered",
      " - Which package manager?",
      "   answer: yarn",
      " - Any notes?",
      "   answer: Use the existing lockfile",
    ].join("\n")
  );
});

test("formatAskUserQuestionAnswers normalizes multiline questions and answers", () => {
  assert.equal(
    formatAskUserQuestionAnswers({ "Which\nmode?": "Use fast\nmode" }),
    ["Questions 1/1 answered", " - Which mode?", "   answer: Use fast mode"].join("\n")
  );
});

test("formatAskUserQuestionDecline creates decline text", () => {
  assert.match(formatAskUserQuestionDecline(), /declined to answer/);
});

function editWith(state: PromptBufferState, sequence: string): PromptBufferState | null {
  const { input, key } = parseTerminalInput(sequence);
  return applyOtherAnswerEdit(state, input, key);
}

function state(text: string, cursor: number): PromptBufferState {
  return { text, cursor };
}

test("applyOtherAnswerEdit inserts typed text at the cursor", () => {
  assert.deepEqual(editWith(state("ac", 1), "b"), { text: "abc", cursor: 2 });
});

test("applyOtherAnswerEdit moves the cursor with plain arrow keys and never inserts residue", () => {
  const { input, key } = parseTerminalInput("\u001B[D");
  assert.equal(input, "[D"); // escape-sequence residue that used to be typed
  assert.deepEqual(applyOtherAnswerEdit(state("abc", 2), input, key), { text: "abc", cursor: 1 });
  assert.deepEqual(editWith(state("abc", 1), "\u001B[C"), { text: "abc", cursor: 2 });
  assert.deepEqual(editWith(state("abc", 2), "\u001B[C"), { text: "abc", cursor: 3 });
});

test("applyOtherAnswerEdit moves by word with ctrl/meta arrows", () => {
  const text = state("one two three", 7);
  assert.deepEqual(editWith(text, "\u001B[1;5D"), { text: "one two three", cursor: 4 });
  assert.deepEqual(editWith(text, "\u001Bb"), { text: "one two three", cursor: 4 });
  assert.deepEqual(editWith(state("one two", 0), "\u001B[1;5C"), { text: "one two", cursor: 3 });
  assert.deepEqual(editWith(state("one two", 0), "\u001Bf"), { text: "one two", cursor: 3 });
});

test("applyOtherAnswerEdit moves to line start/end with home/end and ctrl+a/e", () => {
  assert.deepEqual(editWith(state("abc", 1), "\u001B[H"), { text: "abc", cursor: 0 });
  assert.deepEqual(editWith(state("abc", 1), "\u001B[F"), { text: "abc", cursor: 3 });
  assert.deepEqual(editWith(state("abc", 1), "\u0001"), { text: "abc", cursor: 0 });
  assert.deepEqual(editWith(state("abc", 1), "\u0005"), { text: "abc", cursor: 3 });
  assert.deepEqual(editWith(state("abc", 1), "\u001B[1;5H"), { text: "abc", cursor: 0 });
  assert.deepEqual(editWith(state("abc", 1), "\u001B[1;5F"), { text: "abc", cursor: 3 });
});

test("applyOtherAnswerEdit deletes around the cursor", () => {
  assert.deepEqual(editWith(state("abcd", 2), "\u007F"), { text: "acd", cursor: 1 });
  assert.deepEqual(editWith(state("abcd", 2), "\u001B[3~"), { text: "abd", cursor: 2 });
  assert.deepEqual(editWith(state("one two", 7), "\u0017"), { text: "one ", cursor: 4 });
  assert.deepEqual(editWith(state("abc", 1), "\u0015"), { text: "", cursor: 0 });
  assert.deepEqual(editWith(state("ab\ncd", 1), "\u000B"), { text: "a\ncd", cursor: 1 });
  assert.deepEqual(editWith(state("one two", 3), "\u001Bd"), { text: "one", cursor: 3 });
  assert.deepEqual(editWith(state("one two", 4), "\u001B\u007F"), { text: "two", cursor: 0 });
});

test("applyOtherAnswerEdit ignores unhandled escape sequences instead of typing them", () => {
  for (const sequence of ["\u001B[A", "\u001B[B", "\u001B[1;2D", "\u001B[11~", "\u001B[Z"]) {
    assert.equal(editWith(state("abc", 1), sequence), null, `sequence ${JSON.stringify(sequence)}`);
  }
});
