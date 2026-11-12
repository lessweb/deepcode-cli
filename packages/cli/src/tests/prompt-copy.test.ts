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
import React from "react";
import { render } from "ink";
import { PromptInput, type PromptDraft, type PromptSubmission } from "../ui/views/PromptInput";
import { parseTerminalInput } from "../ui/hooks";
import { stripTerminalControls } from "./terminal-output";
import { isolateSshEnvironment, mockClipboardTerminal } from "./clipboard-test-helpers";

async function harness(t: TestContext, busy = false) {
  isolateSshEnvironment(t);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deepcode-copy-input-"));
  const frames: string[] = [];
  const output = Object.assign(
    new Writable({
      write(chunk, _encoding, done) {
        const text = stripTerminalControls(chunk.toString());
        if (text.trim()) frames.push(text);
        done();
      },
    }),
    { columns: 100, rows: 30, isTTY: true }
  );
  const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode() {}, ref() {}, unref() {} });
  const copies: { text: string; finish: (code: number) => void }[] = [];
  let holdCopy = false;
  t.mock.method(os, "homedir", () => root);
  t.mock.method(childProcess, "spawn", () => {
    const stdin = new PassThrough();
    const child = Object.assign(new EventEmitter(), { stdin, kill: () => true });
    const copy = { text: "", finish: (code: number) => void child.emit("exit", code) };
    stdin.on("data", (chunk: Buffer) => (copy.text += chunk.toString("utf8")));
    copies.push(copy);
    if (!holdCopy) queueMicrotask(() => copy.finish(0));
    return child;
  });
  syncBuiltinESMExports();
  const submissions: PromptSubmission[] = [];
  let props = {
    projectRoot: root,
    screenWidth: 100,
    skills: [],
    reasoningSummary: "off" as const,
    onReasoningSummaryChange: () => "",
    modelConfig: { model: "test", thinkingEnabled: false, reasoningEffort: "high" as const },
    promptHistory: ["previous prompt"],
    busy,
    disabled: false,
    promptDraft: undefined as PromptDraft | undefined,
    planMode: false,
    onSubmit: (submission: PromptSubmission) => void submissions.push(submission),
    onPromptDraftApplied() {},
    onModelConfigChange: () => "",
    onPermissionSettingsChange: () => "",
    onPlanModeChange() {},
    onInterrupt() {},
  };
  const app = render(React.createElement(PromptInput, props), {
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
    fs.rmSync(root, { recursive: true, force: true });
  });
  async function flush() {
    await setTimeout(80);
    await app.waitUntilRenderFlush();
  }
  await flush();
  return {
    copies,
    submissions,
    flush,
    latest: () => frames.at(-1) ?? "",
    holdCopy: () => (holdCopy = true),
    async send(text: string) {
      input.write(text);
      await flush();
    },
    async update(changes: Partial<typeof props>) {
      props = { ...props, ...changes };
      app.rerender(React.createElement(PromptInput, props));
      await flush();
    },
  };
}

test("raw Ctrl+Y is parsed as the copy shortcut", () => {
  const { input, key } = parseTerminalInput("\x19");
  assert.equal(input, "y");
  assert.equal(key.ctrl, true);
  assert.equal(key.meta, false);
  assert.equal(key.paste, false);
});

test("/copy submits while the model is busy", async (t) => {
  const h = await harness(t, true);
  await h.send("/copy");
  await h.send("\r");
  assert.deepEqual(h.submissions, [{ text: "", imageUrls: [], command: "copy" }]);
  assert.equal(h.copies.length, 0);
  await h.update({ busy: false });
  await h.send("\r");
  assert.equal(h.submissions.length, 1);
});

test("Ctrl+Y preserves input, cursor and undo while the model is busy", async (t) => {
  const h = await harness(t, true);
  await h.send("hello");
  await h.send("\x1b[D");
  await h.send("!");
  await h.send("\x19");
  assert.equal(h.copies[0].text, "hell!o");
  assert.match(h.latest(), /Copied to clipboard/);
  assert.equal(h.submissions.length, 0);
  await h.send("?");
  assert.match(h.latest(), /hell!\?o/);
  await h.send("\x1b[45;5u");
  await h.send("\x1b[45;5u");
  await h.update({ busy: false });
  await h.send("\r");
  assert.equal(h.submissions[0].text, "hello");
});

test("Ctrl+Y expands pasted text and excludes attached images", async (t) => {
  const h = await harness(t);
  const original = "  中文 😀\n".repeat(100);
  await h.update({ promptDraft: { nonce: 1, text: "prefix ", imageUrls: ["data:image/png;base64,test"] } });
  await h.send(`\x1b[200~${original}\x1b[201~`);
  assert.match(h.latest(), /paste #1/);
  await h.send("\x19");
  assert.equal(h.copies[0].text, "prefix " + original);
  assert.match(h.latest(), /paste #1/);
  assert.match(h.latest(), /1 image/);
  await h.send("\r");
  assert.equal(h.submissions[0].text, h.copies[0].text);
  assert.deepEqual(h.submissions[0].imageUrls, ["data:image/png;base64,test"]);
});

test("empty, search and modal inputs do not copy", async (t) => {
  const h = await harness(t);
  await h.send("\x19");
  assert.equal(h.copies.length, 0, "empty input");
  await h.send("draft");
  await h.send("\x12");
  await h.send("\x19");
  assert.equal(h.copies.length, 0, "history search");
  assert.match(h.latest(), /reverse-i-search/);
  await h.send("\x1b");
  await h.update({ promptDraft: { nonce: 2, text: "/skills", imageUrls: [] } });
  await h.send("\r");
  await h.send("\x19");
  assert.equal(h.copies.length, 0);
});

test("disabled input does not copy", async (t) => {
  const h = await harness(t);
  await h.send("draft");
  await h.update({ disabled: true });
  await h.send("\x19");
  assert.equal(h.copies.length, 0);
});

test("Alt combinations and bracketed paste do not trigger copying", async (t) => {
  const h = await harness(t);
  await h.send("draft");
  await h.send("\x1b[121;7u");
  await h.send("\x1b[200~\x19\x1b[201~");
  assert.equal(h.copies.length, 0);
});

test("copy uses a snapshot and ignores repeated presses until completion", async (t) => {
  const h = await harness(t);
  h.holdCopy();
  await h.send("before");
  await h.send("\x19\x19");
  await h.send(" after");
  await h.send("\x19");
  assert.equal(h.copies.length, 1);
  assert.equal(h.copies[0].text, "before");
  h.copies[0].finish(0);
  await h.flush();
  await h.send("\x19");
  assert.equal(h.copies[1].text, "before after");
  h.copies[1].finish(0);
  await h.flush();
});

test("copy failure shows a short status and preserves the draft", async (t) => {
  const h = await harness(t);
  h.holdCopy();
  await h.send("keep me");
  await h.send("\x19");
  h.copies[0].finish(1);
  await h.flush();
  if (process.platform === "linux") {
    h.copies[1].finish(1);
    await h.flush();
  }
  assert.match(h.latest(), /Failed to copy/);
  await h.send("\r");
  assert.equal(h.submissions[0].text, "keep me");
});

test("Ctrl+Y copies input through OSC 52 over SSH", async (t) => {
  const h = await harness(t);
  const { writes } = mockClipboardTerminal(t);
  process.env.SSH_TTY = "/dev/pts/0";
  await h.send("中文 hello");
  await h.send("\x19");
  assert.deepEqual(writes, [`\x1b]52;c;${Buffer.from("中文 hello").toString("base64")}\x07`]);
  assert.equal(h.copies.length, 0);
  assert.match(h.latest(), /Copied to clipboard/);
});
