import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { syncBuiltinESMExports } from "node:module";
import React from "react";
import { SessionManager } from "@vegamo/deepcode-core";
import App from "../ui/views/App";
import { PromptInput, type PromptSubmission } from "../ui/views/PromptInput";
import { UndoSelector, type QueueUndoTarget } from "../ui/views/UndoSelector";
import { isBusyCommandAllowed, BUILTIN_SLASH_COMMANDS } from "../ui/core/slash-commands";
import { terminal } from "./terminal-helper";

test("submitted prompts display during preparation and appear once after consumption", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deepcode-prompt-display-"));
  const originalEnv = process.env;
  process.env = Object.fromEntries(Object.entries(originalEnv).filter(([key]) => !key.startsWith("DEEPCODE_")));
  t.mock.method(os, "homedir", () => root);
  syncBuiltinESMExports();
  fs.mkdirSync(path.join(root, ".deepcode"));
  fs.writeFileSync(path.join(root, ".deepcode", "settings.json"), JSON.stringify({ statusline: { enabled: false } }));
  let releasePreparation!: () => void;
  const preparation = new Promise<void>((resolve) => (releasePreparation = resolve));
  let releaseMatching!: () => void;
  const matching = new Promise<void>((resolve) => (releaseMatching = resolve));
  const managerRef: { current?: SessionManager } = {};
  t.mock.method(SessionManager.prototype, "initMcpServers", async function (this: SessionManager) {
    managerRef.current = this;
    Object.assign(this, {
      createOpenAIClient: Object.assign(() => ({ client: {}, model: "test", thinkingEnabled: false }), {
        prepare: () => preparation,
      }),
      getProjectStorage: () => ({
        projectCode: "test",
        projectDir: path.join(root, "storage"),
        sessionsIndexPath: path.join(root, "storage", "sessions-index.json"),
      }),
      maybeGenerateSessionTitle: () => {},
      reportNewPrompt: () => {},
      requestSessionCompletion: async () => ({ choices: [{ message: { content: "3" } }] }),
    });
  });
  t.mock.method(SessionManager.prototype, "listSkills", async () => []);
  t.mock.method(SessionManager.prototype, "identifyMatchingSkillNames", async () => {
    await matching;
    return [];
  });
  const h = await terminal(t, React.createElement(App, { projectRoot: root }), 100);
  const manager = managerRef.current!;
  t.after(async () => {
    manager?.interruptActiveSession();
    releasePreparation();
    releaseMatching();
    const id = manager?.getActiveSessionId();
    if (id) await manager.waitForSessionIdle(id).catch(() => {});
    manager?.dispose();
    await new Promise((resolve) => setImmediate(resolve));
    t.mock.restoreAll();
    syncBuiltinESMExports();
    process.env = originalEnv;
    fs.rmSync(root, { recursive: true, force: true });
  });
  await h.send("1+2=");
  await h.send("\r");
  const id = manager.getActiveSessionId()!;
  assert.equal(manager.getSession(id), null);
  assert.match(h.frame(), /> 1\+2=/);
  assert.match(h.frame(), /Type your message/);
  assert.doesNotMatch(h.frame(), /pending messages?/);

  releasePreparation();
  await h.send("");
  assert.equal(manager.getSession(id)?.status, "pending");
  assert.match(h.frame(), /> 1\+2=/);
  assert.doesNotMatch(h.frame(), /pending messages?/);
  assert.equal(manager.listSessionMessages(id).filter((message) => message.role === "user").length, 0);

  await h.send("later");
  await h.send("\r");
  assert.match(h.frame(), /> 1\+2=[\s\S]*> later/);
  assert.match(h.frame(), /1 pending message \(use \/undo to remove or edit\)/);
  const queued = manager.listQueuedMessages(id)[1];
  manager.beginQueuedMessageEdit(id, queued.id);
  manager.finishQueuedMessageEdit(id, queued.id, { text: "edited" });
  await h.send("");
  assert.match(h.frame(), /> edited/);
  assert.doesNotMatch(h.frame(), /> later/);
  manager.removeQueuedMessage(id, queued.id);
  await h.send("");
  assert.doesNotMatch(h.frame(), /> edited/);
  assert.doesNotMatch(h.frame(), /pending messages?/);

  releaseMatching();
  await manager.waitForSessionIdle(id);
  await h.send("");
  assert.equal(h.frame().match(/> 1\+2=/g)?.length, 1);
  assert.deepEqual(manager.listQueuedMessages(id), []);
  assert.doesNotMatch(h.frame(), /pending messages?/);
});

async function input(t: TestContext, editing = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deepcode-input-queue-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const submissions: PromptSubmission[] = [];
  const events: string[] = [];
  const h = await terminal(
    t,
    React.createElement(PromptInput, {
      projectRoot: root,
      skills: [],
      modelConfig: { model: "test", thinkingEnabled: false, reasoningEffort: "max" },
      reasoningSummary: "off",
      screenWidth: 100,
      promptHistory: [],
      busy: true,
      planMode: false,
      onSubmit: (submission) => {
        submissions.push(submission);
      },
      onPromptDraftApplied: () => {},
      onReasoningSummaryChange: () => "",
      onModelConfigChange: () => "",
      onPermissionSettingsChange: () => "",
      onPlanModeChange: () => {},
      onInterrupt: () => {
        events.push("interrupt");
      },
      onExitShortcut: () => {
        events.push("exit");
      },
      editingQueuedMessage: editing,
      onCancelQueueEdit: () => {
        events.push("cancel edit");
      },
    }),
    100
  );
  return { ...h, submissions, events };
}

test("busy input submits ordinary prompts and clears the input for another message", async (t) => {
  const h = await input(t);
  await h.send("first");
  await h.send("\r");
  await h.send("second");
  await h.send("\r");
  assert.deepEqual(
    h.submissions.map((s) => s.text),
    ["first", "second"]
  );
});

test("busy commands are exactly the supported whitelist; forbidden direct input never submits", async (t) => {
  assert.deepEqual(
    BUILTIN_SLASH_COMMANDS.filter((command) => isBusyCommandAllowed(command.kind))
      .map((c) => c.kind)
      .sort(),
    ["copy", "exit", "experimental", "mcp", "model", "permissions", "raw", "skills", "undo"]
  );
  const h = await input(t);
  for (const command of ["/new", "/continue", "/plan do something", "/compact"]) {
    await h.send("\x15" + command);
    await h.send("\r");
  }
  assert.equal(h.submissions.length, 0);
  await h.send("\x15/copy");
  await h.send("\r");
  assert.equal(h.submissions[0]?.command, "copy");
  await h.send("/undo");
  await h.send("\r");
  assert.equal(h.submissions[1]?.command, "undo");
  await h.send("/exit");
  await h.send("\r");
  assert.equal(h.submissions[2]?.command, "exit");
});

test("double Ctrl+D requests exit only on the second press", async (t) => {
  const h = await input(t);
  await h.send("\x04");
  assert.deepEqual(h.events, []);
  await h.send("\x04");
  assert.deepEqual(h.events, ["exit"]);
});

test("Esc cancels a queue edit without interrupting the model", async (t) => {
  const h = await input(t, true);
  await h.send("\x1b");
  assert.deepEqual(h.events, ["cancel edit"]);
});

test("pending undo targets expose remove and edit", async (t) => {
  const target: QueueUndoTarget = {
    index: 0,
    canRestoreCode: false,
    queued: { id: "queued", sessionId: "session", submittedAt: new Date().toISOString(), content: { text: "later" } },
    message: {
      id: "queued",
      sessionId: "session",
      role: "user",
      content: "later",
      contentParams: null,
      messageParams: null,
      compacted: false,
      visible: true,
      createTime: new Date().toISOString(),
      updateTime: new Date().toISOString(),
    },
  };
  const selected: string[] = [];
  const onSelect = (_target: QueueUndoTarget, mode: string) => {
    selected.push(mode);
  };
  const h = await terminal(
    t,
    React.createElement(UndoSelector, {
      targets: [target],
      busy: true,
      onCancel: () => {},
      onSelect,
    })
  );
  assert.match(h.frame(), /pending/);
  await h.send("\r");
  assert.match(h.frame(), /Remove/);
  assert.match(h.frame(), /Edit/);
  assert.doesNotMatch(h.frame(), /Restore files|Restore conversation/);
  await h.send("\x1b[B");
  await h.send("\r");
  assert.deepEqual(selected, ["edit"]);
  h.rerender(
    React.createElement(UndoSelector, {
      targets: [{ ...target, queued: undefined }],
      busy: false,
      onCancel: () => {},
      onSelect,
    })
  );
  await h.send("");
  assert.match(h.frame(), /no longer available/);
  await h.send("\r");
  assert.deepEqual(selected, ["edit"]);
});
