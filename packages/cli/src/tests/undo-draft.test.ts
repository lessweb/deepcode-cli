import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { syncBuiltinESMExports } from "node:module";
import { PassThrough, Writable } from "node:stream";
import { test, type TestContext } from "node:test";
import { setTimeout } from "node:timers/promises";
import { stripTerminalControls } from "./terminal-output";
import React from "react";
import { render } from "ink";
import {
  SessionManager,
  type SessionEntry,
  type SessionManagerOptions,
  type SessionMessage,
  type UserPromptContent,
} from "@vegamo/deepcode-core";
import App from "../ui/views/App";

const WEATHER_PROMPT = "用 AskUserQuestion tool 查询天气预报";
const QUESTION = "想查询哪个城市的天气预报？";

async function harness(t: TestContext, imageUrls: string[] = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deepcode-undo-draft-"));
  const originalEnv = process.env;
  process.env = Object.fromEntries(Object.entries(originalEnv).filter(([key]) => !key.startsWith("DEEPCODE_")));
  t.mock.method(os, "homedir", () => root);
  syncBuiltinESMExports();
  fs.mkdirSync(path.join(root, ".deepcode"));
  fs.writeFileSync(path.join(root, ".deepcode", "settings.json"), JSON.stringify({ statusline: { enabled: false } }));
  const entry: SessionEntry = {
    id: "undo-test",
    summary: "今天星期几",
    assistantReply: null,
    assistantThinking: null,
    assistantRefusal: null,
    toolCalls: null,
    status: "completed",
    failReason: null,
    usage: null,
    usagePerModel: null,
    activeTokens: 0,
    processes: null,
    createTime: "2026-10-27T00:00:00Z",
    updateTime: "2026-10-27T00:00:00Z",
  };
  let nextId = 0;
  function message(role: SessionMessage["role"], content: string): SessionMessage {
    return {
      id: String(++nextId),
      sessionId: entry.id,
      role,
      content,
      contentParams: null,
      messageParams: null,
      compacted: false,
      visible: true,
      createTime: entry.createTime,
      updateTime: entry.updateTime,
    };
  }
  const originalPrompt = message("user", "今天星期几");
  originalPrompt.meta = { userPrompt: { text: originalPrompt.content ?? "", imageUrls } };
  let history = [originalPrompt, message("assistant", "今天是星期二。")];
  const managerRef: { current?: SessionManager } = {};
  let busy = false;
  t.mock.method(SessionManager.prototype, "isSessionRunning", () => busy);
  t.mock.method(SessionManager.prototype, "initMcpServers", async function (this: SessionManager) {
    managerRef.current = this;
  });
  t.mock.method(SessionManager.prototype, "listSkills", async () => []);
  t.mock.method(SessionManager.prototype, "getActiveSessionId", () => entry.id);
  t.mock.method(SessionManager.prototype, "getSession", () => entry);
  t.mock.method(SessionManager.prototype, "listSessions", () => [entry]);
  t.mock.method(SessionManager.prototype, "listSessionMessages", () => history);
  t.mock.method(SessionManager.prototype, "restoreSessionConversation", (_sessionId: string, messageId: string) => {
    const index = history.findIndex((item) => item.id === messageId);
    assert.ok(index >= 0);
    history = history.slice(0, index);
    return history;
  });
  const submissions: UserPromptContent[] = [];
  t.mock.method(
    SessionManager.prototype,
    "handleUserPrompt",
    async function (this: SessionManager, prompt: UserPromptContent) {
      submissions.push(prompt);
      const userMessage = message("user", prompt.text ?? "");
      userMessage.meta = { userPrompt: prompt, isAnswers: prompt.isAnswers };
      history.push(userMessage);
      const events = this as unknown as Pick<SessionManagerOptions, "onAssistantMessage" | "onSessionEntryUpdated">;
      if (prompt.text === WEATHER_PROMPT) {
        const question = message(
          "tool",
          JSON.stringify({
            awaitUserResponse: true,
            metadata: {
              kind: "ask_user_question",
              questions: [{ question: QUESTION, options: [{ label: "北京" }, { label: "上海" }] }],
            },
          })
        );
        history.push(question);
        events.onAssistantMessage(question, false);
        entry.status = "waiting_for_user";
      } else {
        entry.status = "completed";
      }
      events.onSessionEntryUpdated?.({ ...entry });
    }
  );
  const frames: string[] = [];
  const output = Object.assign(
    new Writable({
      write(chunk, _encoding, callback) {
        const frame = stripTerminalControls(chunk.toString());
        if (frame.trim()) frames.push(frame);
        callback();
      },
    }),
    { columns: 120, rows: 40, isTTY: true }
  );
  const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode() {}, ref() {}, unref() {} });
  const app = render(React.createElement(App, { projectRoot: root, resumeSessionId: entry.id }), {
    stdin: input as unknown as NodeJS.ReadStream,
    stdout: output as unknown as NodeJS.WriteStream,
    stderr: output as unknown as NodeJS.WriteStream,
    debug: true,
    patchConsole: false,
    exitOnCtrlC: false,
  });
  t.after(() => {
    app.unmount();
    app.cleanup();
    t.mock.restoreAll();
    syncBuiltinESMExports();
    process.env = originalEnv;
    fs.rmSync(root, { recursive: true, force: true });
  });
  async function flush() {
    await setTimeout(30);
    await app.waitUntilRenderFlush();
  }
  async function send(value: string) {
    input.write(value);
    await flush();
  }
  async function submit(value: string) {
    await send(value);
    await send("\r");
  }
  async function waitForFrame(pattern: RegExp) {
    const deadline = Date.now() + 2_000;
    while (!pattern.test(frames.at(-1) ?? "") && Date.now() < deadline) await flush();
    assert.match(frames.at(-1) ?? "", pattern);
  }
  await waitForFrame(/Type your message/);
  return {
    submissions,
    send,
    submit,
    manager: managerRef.current!,
    sessionId: entry.id,
    flush,
    latest: () => frames.at(-1) ?? "",
    waitForFrame,
    async setBusy(value: boolean) {
      busy = value;
      managerRef.current!.setActiveSessionId(null);
      await flush();
    },
    async requestPermission() {
      busy = false;
      entry.status = "ask_permission";
      entry.askPermissions = [
        { toolCallId: "editor-test", name: "Bash", command: "touch example", scopes: ["write-in-cwd"] },
      ];
      const events = managerRef.current! as unknown as Pick<SessionManagerOptions, "onSessionEntryUpdated">;
      events.onSessionEntryUpdated?.({ ...entry });
      managerRef.current!.setActiveSessionId(null);
      await flush();
    },
    async undo() {
      await submit("/undo");
      await waitForFrame(/Enter choose/);
      await send("\r"); // Select the latest user message.
      await waitForFrame(/Restore conversation only/);
      await send("\r"); // Restore the conversation.
    },
  };
}

for (const action of ["answer", "cancel"] as const) {
  test(`/undo draft does not return after ${action}ing AskUserQuestion`, async (t) => {
    const h = await harness(t);
    await h.undo();
    await h.waitForFrame(/^> 今天星期几$/m);
    await h.send("\u0015");
    await h.submit("明天星期几");
    assert.equal(h.submissions[0]?.text, "明天星期几", h.latest());
    await h.submit(WEATHER_PROMPT);
    assert.match(h.latest(), /想查询哪个城市的天气预报？/);
    await h.send(action === "answer" ? "\r" : "\u001b");
    assert.match(h.latest(), /Type your message\.\.\./);
    assert.doesNotMatch(h.latest(), /^> 今天星期几$/m);
    if (action === "answer") {
      assert.equal(h.submissions.at(-1)?.isAnswers, true);
      assert.match(h.submissions.at(-1)?.text ?? "", /answer: 北京/);
    } else {
      assert.equal(h.submissions.length, 2);
    }
    await h.submit("继续");
    assert.equal(h.submissions.at(-1)?.text, "继续");
  });
}

test("consuming an /undo draft preserves its attachments and allows another undo", async (t) => {
  const images = ["data:image/png;base64,aW1hZ2U="];
  const h = await harness(t, images);
  await h.undo();
  await h.waitForFrame(/^> 今天星期几$/m);
  await h.send("\u0015");
  await h.submit("明天星期几");
  assert.deepEqual(h.submissions.at(-1)?.imageUrls, images);
  await h.undo();
  await h.waitForFrame(/^> 明天星期几$/m);
  await h.send("\r");
  assert.equal(h.submissions.at(-1)?.text, "明天星期几");
  assert.deepEqual(h.submissions.at(-1)?.imageUrls, images);
  await h.submit(WEATHER_PROMPT);
  await h.send("\r");
  await h.submit("继续");
  assert.equal(h.submissions.at(-1)?.text, "继续");
  assert.deepEqual(h.submissions.at(-1)?.imageUrls, []);
});

test("busy /undo keeps history visible but only allows changing pending prompts", async (t) => {
  const h = await harness(t);
  await h.setBusy(true);
  await h.submit("/undo");
  assert.match(h.latest(), /今天星期几/);
  assert.match(h.latest(), /↑\/↓ navigate · Esc cancel/);
  assert.doesNotMatch(h.latest(), /Enter choose/);
  assert.doesNotMatch(h.latest(), /Nothing to undo/);
  await h.send("\r");
  assert.doesNotMatch(h.latest(), /Selected message:/);
  assert.equal(h.manager.listSessionMessages(h.sessionId).length, 2);
  await h.send("\x1b");

  const queued = h.manager.enqueuePrompt(h.sessionId, { text: "pending input" });
  await h.flush();
  await h.submit("/undo");
  assert.match(h.latest(), /pending input/);
  assert.match(h.latest(), / · pending/);
  assert.match(h.latest(), /Enter choose/);
  assert.doesNotMatch(h.latest(), /↑\/↓ navigate · Esc cancel/);
  await h.send("\x1b[A");
  assert.match(h.latest(), /↑\/↓ navigate · Esc cancel/);
  assert.doesNotMatch(h.latest(), /Enter choose/);
  await h.send("\x1b[B");
  assert.match(h.latest(), /Enter choose/);
  assert.doesNotMatch(h.latest(), /↑\/↓ navigate · Esc cancel/);
  await h.send("\r");
  assert.match(h.latest(), /Remove/);
  assert.match(h.latest(), /Edit/);
  await h.send("\r");
  assert.equal(
    h.manager.listQueuedMessages(h.sessionId).some((message) => message.id === queued.id),
    false
  );
  assert.match(h.latest(), /Type your message/);

  await h.setBusy(false);
  await h.submit("/undo");
  assert.match(h.latest(), /Enter choose/);
  assert.doesNotMatch(h.latest(), /↑\/↓ navigate · Esc cancel/);
  await h.send("\r");
  assert.match(h.latest(), /Restore conversation/);
});

test("idle /undo appends pending prompts and edits preserve ID, attachments and skills", async (t) => {
  const h = await harness(t);
  const content = {
    text: "pending input",
    imageUrls: ["file:///tmp/image.png"],
    skills: [{ name: "demo", path: "/tmp/demo/SKILL.md", description: "demo" }],
    planMode: true,
  };
  // Leave the queue paused so this test exercises the UI without a model request.
  h.manager.setActiveSessionId(null);
  const queued = h.manager.enqueuePrompt(h.sessionId, content);
  await h.flush();
  await h.submit("/undo");
  assert.match(h.latest(), /pending input/);
  assert.match(h.latest(), /pending/);
  assert.match(h.latest(), /今天星期几/);
  await h.send("\r");
  assert.match(h.latest(), /Remove/);
  await h.send("\x1b[B");
  await h.send("\r");
  assert.match(h.latest(), /pending input/);
  await h.send("\x15");
  await h.submit("edited input");
  const updated = h.manager.listQueuedMessages(h.sessionId)[0];
  assert.equal(updated.id, queued.id);
  assert.equal(updated.submittedAt, queued.submittedAt);
  assert.deepEqual(updated.content, { ...content, text: "edited input" });
  assert.equal(h.submissions.length, 0);
});

test("cancelling a pending edit keeps the original queue content", async (t) => {
  const h = await harness(t);
  h.manager.setActiveSessionId(null);
  const queued = h.manager.enqueuePrompt(h.sessionId, { text: "original pending" });
  await h.flush();
  await h.submit("/undo");
  await h.send("\r");
  await h.send("\x1b[B");
  await h.send("\r");
  await h.send("\x15changed");
  await h.send("\x1b");
  // Esc is decoded asynchronously; restoring the draft also needs a React effect and render.
  await h.waitForFrame(/Type your message/);
  assert.equal(h.manager.listQueuedMessages(h.sessionId)[0].id, queued.id);
  assert.equal(h.manager.listQueuedMessages(h.sessionId)[0].content.text, "original pending");
});

for (const action of ["allow", "cancel"] as const) {
  test(`vim draft survives a permission request arriving during editing (${action})`, async (t) => {
    const h = await harness(t);
    let editor: { file: string; child: EventEmitter } | undefined;
    t.mock.method(childProcess, "spawn", (command: string, args: string[]) => {
      assert.equal(command, "vim");
      editor = { file: args[0], child: new EventEmitter() };
      return editor.child;
    });
    syncBuiltinESMExports();
    await h.setBusy(true);
    await h.send("draft before vim");
    await h.send("\x07");
    assert.ok(editor);
    assert.equal(fs.readFileSync(editor.file, "utf8"), "draft before vim");
    await h.requestPermission();
    assert.doesNotMatch(h.latest(), /touch example/);
    fs.writeFileSync(editor.file, "draft from vim\n");
    editor.child.emit("exit", 0, null);
    await h.waitForFrame(/touch example/);
    await h.send(action === "allow" ? "\r" : "\x1b");
    await h.waitForFrame(/> draft from vim/);
    await h.send("!");
    await h.send("\r");
    assert.equal(h.submissions.at(-1)?.text, "draft from vim!");
  });
}
