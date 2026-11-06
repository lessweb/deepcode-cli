import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { PromptInput, type PromptSubmission } from "../ui/views/PromptInput";
import { terminal } from "./terminal-helper";

test("PromptInput wraps words, switches cursor modes and submits the original buffer", async (t) => {
  const submissions: PromptSubmission[] = [];
  const props = {
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
