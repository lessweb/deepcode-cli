import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { PromptInput, type PromptSubmission } from "../ui/views/PromptInput";
import { terminal } from "./terminal-helper";

function inputProps(submissions: PromptSubmission[]) {
  return {
    projectRoot: process.cwd(),
    screenWidth: 12,
    skills: [],
    reasoningSummary: "off" as const,
    onReasoningSummaryChange: () => "",
    modelConfig: { model: "test", thinkingEnabled: false, reasoningEffort: "high" as const },
    promptHistory: [],
    busy: false,
    planMode: false,
    onSubmit: (submission: PromptSubmission) => void submissions.push(submission),
    onPromptDraftApplied() {},
    onModelConfigChange: () => "",
    onPermissionSettingsChange: () => "",
    onPlanModeChange() {},
    onInterrupt() {},
  };
}

test("PromptInput wraps words, switches cursor modes and submits the original buffer", async (t) => {
  const submissions: PromptSubmission[] = [];
  const props = inputProps(submissions);
  const h = await terminal(t, React.createElement(PromptInput, props), 24);
  await h.send("hello");
  assert.match(h.frame(), /> hello/);
  assert.doesNotMatch(h.rawFrame(), /\u001B\[7m/);

  await h.send(" world");
  assert.match(h.frame(), /> hello\s*\n {2}world/);
  assert.equal((h.rawFrame().match(/\u001B\[7m/g) ?? []).length, 1);
  for (const letter of ["d", "l", "r", "o", "w"]) {
    await h.send("\x1b[D");
    assert.match(h.frame(), /> hello\s*\n {2}world/);
    assert.ok(h.rawFrame().includes(`\x1b[7m${letter}\x1b[27m`));
  }
  await h.send("\x1b[D");
  assert.doesNotMatch(h.rawFrame(), /\u001B\[7m/);
  await h.send("\x1b[C");
  assert.ok(h.rawFrame().includes("\x1b[7mw\x1b[27m"));
  await h.send("\x1b[C");
  assert.ok(h.rawFrame().includes("\x1b[7mo\x1b[27m"));

  h.rerender(React.createElement(PromptInput, { ...props, screenWidth: 24 }));
  await h.send("\x1b[C");
  assert.match(h.frame(), /> hello world/);
  assert.doesNotMatch(h.rawFrame(), /\u001B\[7m/);
  await h.send("\r");
  assert.equal(submissions[0]?.text, "hello world");
});

test("PromptInput wraps Chinese by character and edits across the wrap without changing submitted whitespace", async (t) => {
  const submissions: PromptSubmission[] = [];
  const h = await terminal(t, React.createElement(PromptInput, inputProps(submissions)), 12);
  const text = "aaaaaa 君不见高堂明镜悲白发\nhello  world";
  await h.send(`\x1b[200~${text}\x1b[201~`);
  assert.match(h.frame(), /> aaaaaa 君\s*\n {2}不见高堂明\s*\n {2}镜悲白发/);

  await h.send("\x1b[A");
  await h.send("\x01");
  for (let i = 0; i < 8; i++) await h.send("\x1b[C");
  assert.ok(h.rawFrame().includes("\x1b[7m不\x1b[27m"));
  await h.send("天");
  assert.match(h.frame(), /> aaaaaa 君\s*\n {2}天不见高堂/);
  await h.send("\x7f");
  await h.send("\x1b[3~");
  await h.send("不");
  await h.send("\r");
  assert.equal(submissions[0]?.text, text);
});

test("PromptInput reflows mixed Chinese and English when resized and preserves the cursor", async (t) => {
  const submissions: PromptSubmission[] = [];
  const props = inputProps(submissions);
  const h = await terminal(t, React.createElement(PromptInput, props), 24);
  await h.send("aaaaaa 君不见");
  await h.send("\x1b[D");
  assert.ok(h.rawFrame().includes("\x1b[7m见\x1b[27m"));

  h.rerender(React.createElement(PromptInput, { ...props, screenWidth: 24 }));
  await h.send("天");
  assert.match(h.frame(), /> aaaaaa 君不天见/);
  h.rerender(React.createElement(PromptInput, props));
  await h.send("\x7f");
  assert.match(h.frame(), /> aaaaaa 君\s*\n {2}不见/);
  await h.send("\r");
  assert.equal(submissions[0]?.text, "aaaaaa 君不见");
});

test("PromptInput uses the same Chinese wrapping in highlighted history previews", async (t) => {
  const submissions: PromptSubmission[] = [];
  const text = "aaaaaa 君不见高堂明镜悲白发";
  const props = { ...inputProps(submissions), promptHistory: [text] };
  const h = await terminal(t, React.createElement(PromptInput, props), 12);
  await h.send("\x12君不见");
  assert.match(h.frame(), /> aaaaaa 君\s*\n {2}不见高堂明/);
  await h.send("\r");
  assert.equal(submissions.length, 0);
  await h.send("\r");
  assert.equal(submissions[0]?.text, text);
});

for (const incrementalRendering of [false, true]) {
  for (const lines of [12, 21, 60]) {
    test(`PromptInput keeps the cursor on the input after expanding and clearing ${lines} lines (incremental=${incrementalRendering})`, async (t) => {
      const props = { ...inputProps([]), screenWidth: 160 };
      const h = await terminal(t, React.createElement(PromptInput, props), props.screenWidth, {
        rows: 24,
        incrementalRendering,
      });
      const screen = h.screen!;
      function assertCursorAtInput(column: number) {
        const buffer = screen.buffer.active;
        const row = Array.from({ length: screen.rows }, (_, y) =>
          buffer.getLine(buffer.viewportY + y)?.translateToString(true)
        ).findIndex((line) => line === ">" || line?.startsWith("> "));
        assert.ok(row >= 0, "prompt must be visible");
        assert.equal(buffer.cursorY, row, "cursor must stay on the prompt row");
        assert.equal(buffer.cursorX, column);
      }

      assertCursorAtInput(2);
      const text = Array.from({ length: lines }, (_, i) => `pasted line ${i + 1}`).join("\n");
      await h.send(`\x1b[200~${text}\x1b[201~`);
      await h.send("\x0f"); // Ctrl+O: expand past the terminal height.
      await h.send("\x15"); // Ctrl+U: return to an empty, single-line prompt.
      assertCursorAtInput(2);
      await h.send("hello");
      assertCursorAtInput(7);
      await h.send("\x1b[D");
      assertCursorAtInput(6);
    });
  }
}
