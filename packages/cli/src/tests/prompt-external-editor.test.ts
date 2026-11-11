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
import { stripTerminalControls } from "./terminal-output";

async function harness(t: TestContext, busy = false, tty = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deepcode-vim-input-"));
  const writes: string[] = [];
  let rawMode = false;
  const output = Object.assign(
    new Writable({
      write(chunk, _encoding, done) {
        if (chunk.length) writes.push(chunk.toString());
        done();
      },
    }),
    { columns: 100, rows: 30, isTTY: tty }
  );
  const input = Object.assign(new PassThrough(), {
    isTTY: true,
    setRawMode(value: boolean) {
      rawMode = value;
    },
    ref() {},
    unref() {},
  });
  const edits: { seed: string; file: string; finish: (text?: string, code?: number) => void }[] = [];
  t.mock.method(os, "homedir", () => root);
  t.mock.method(childProcess, "spawn", (command: string, args: string[]) => {
    assert.equal(command, "vim");
    assert.equal(rawMode, false);
    assert.equal(input.listenerCount("data"), 0);
    assert.equal(input.listenerCount("readable"), 0);
    assert.equal(input.isPaused(), true);
    const child = new EventEmitter();
    edits.push({
      seed: fs.readFileSync(args[0], "utf8"),
      file: args[0],
      finish(text, code = 0) {
        if (text !== undefined) fs.writeFileSync(args[0], text);
        child.emit("exit", code, null);
      },
    });
    return child;
  });
  syncBuiltinESMExports();
  const submissions: PromptSubmission[] = [];
  const editorChanges: { running: boolean; draft?: PromptDraft }[] = [];
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
    editingQueuedMessage: false,
    promptDraft: undefined as PromptDraft | undefined,
    planMode: false,
    onSubmit: (submission: PromptSubmission) => void submissions.push(submission),
    onPromptDraftApplied() {},
    onModelConfigChange: () => "",
    onPermissionSettingsChange: () => "",
    onPlanModeChange() {},
    onInterrupt() {},
    onExternalEditorChange(running: boolean, draft?: PromptDraft) {
      editorChanges.push({ running, draft });
    },
  };
  const app = render(React.createElement(PromptInput, props), {
    stdin: input as unknown as NodeJS.ReadStream,
    stdout: output as unknown as NodeJS.WriteStream,
    stderr: output as unknown as NodeJS.WriteStream,
    interactive: true,
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
    await setTimeout(60);
    await app.waitUntilRenderFlush();
  }
  await flush();
  return {
    edits,
    submissions,
    writes,
    editorChanges,
    flush,
    latest: () => stripTerminalControls(writes.filter((s) => stripTerminalControls(s).trim()).at(-1) ?? ""),
    rawMode: () => rawMode,
    async send(text: string) {
      if (props.disabled) input.emit("data", text);
      else input.write(text);
      await flush();
    },
    async update(changes: Partial<typeof props>) {
      props = { ...props, ...changes };
      app.rerender(React.createElement(PromptInput, props));
      await flush();
    },
  };
}

test("Ctrl+G edits busy input, suspends terminal output, restores modes and supports undo", async (t) => {
  const h = await harness(t, true);
  await h.send("draft");
  await h.send("\x07\x07");
  assert.equal(h.edits.length, 1);
  assert.equal(h.edits[0].seed, "draft");
  assert.equal(h.rawMode(), false);
  const count = h.writes.length;
  await h.update({ busy: false, screenWidth: 80 });
  assert.equal(h.writes.length, count, "no output while vim owns the terminal, even on resize");
  h.edits[0].finish("编辑\nnext\n");
  await h.flush();
  assert.equal(h.rawMode(), true);
  assert.equal(fs.existsSync(path.dirname(h.edits[0].file)), false);
  assert.equal(h.submissions.length, 0);
  assert.match(h.latest(), /编辑/);
  assert.match(h.writes.slice(count).join(""), /\x1b\[\?2004h/);
  assert.match(h.writes.slice(count).join(""), /\x1b\[>4;1m/);
  assert.match(h.writes.slice(count).join(""), /\x1b\[\?1004h/);
  await h.send("!");
  assert.match(h.latest(), /next!/);
  await h.send("\x1b[45;5u");
  await h.send("\x1b[45;5u");
  await h.send("\r");
  assert.equal(h.submissions[0].text, "draft");
});

test("empty input can open vim and a saved empty file clears the draft", async (t) => {
  const h = await harness(t);
  await h.send("\x07");
  assert.equal(h.edits[0].seed, "");
  h.edits[0].finish("hello\n");
  await h.flush();
  await h.send("\x07");
  h.edits[1].finish("");
  await h.flush();
  await h.send("\r");
  assert.equal(h.submissions.length, 0);
  await h.send("new");
  await h.send("\r");
  assert.equal(h.submissions[0].text, "new");
});

test("unchanged and failed editing preserve cursor and draft", async (t) => {
  const h = await harness(t);
  await h.send("hello");
  await h.send("\x1b[D");
  await h.send("\x07");
  h.edits[0].finish();
  await h.flush();
  await h.send("!");
  await h.send("\x07");
  h.edits[1].finish("lost", 1);
  await h.flush();
  assert.match(h.latest(), /Could not edit in vim/);
  assert.equal(h.rawMode(), true);
  await h.send("?");
  await h.send("\r");
  assert.equal(h.submissions[0].text, "hell!?o");
});

test("long pastes expand for vim, keep attachments and remain undoable in queue editing", async (t) => {
  const h = await harness(t);
  const original = "中文 😀\n".repeat(100);
  await h.update({
    editingQueuedMessage: true,
    planMode: true,
    promptDraft: {
      nonce: 1,
      text: "prefix ",
      imageUrls: ["data:image/png;base64,test"],
      selectedSkills: [{ name: "test", path: "/tmp/test-skill", description: "Test skill" }],
    },
  });
  await h.send(`\x1b[200~${original}\x1b[201~`);
  await h.send("\x07");
  assert.equal(h.edits[0].seed, "prefix " + original);
  h.edits[0].finish("edited\n");
  await h.flush();
  assert.equal(h.editorChanges.at(-1)?.draft?.planMode, true);
  assert.equal(h.editorChanges.at(-1)?.draft?.selectedSkills?.[0].name, "test");
  assert.deepEqual(h.editorChanges.at(-1)?.draft?.imageUrls, ["data:image/png;base64,test"]);
  await h.send("\x1b[45;5u");
  await h.send("\r");
  assert.equal(h.submissions[0].text, "prefix " + original);
  assert.deepEqual(h.submissions[0].imageUrls, ["data:image/png;base64,test"]);
});

test("disabled input, search, modal dialogs and Alt combinations do not launch vim", async (t) => {
  const h = await harness(t);
  await h.update({ disabled: true });
  await h.send("\x07");
  await h.update({ disabled: false });
  await h.send("\x12");
  await h.send("\x07");
  await h.send("\x1b");
  await h.send("\x1b[103;7u");
  await h.send("\x1b[200~\x07\x1b[201~");
  await h.update({ promptDraft: { nonce: 2, text: "/model", imageUrls: [] } });
  await h.send("\r");
  await h.send("\x07");
  assert.equal(h.edits.length, 0);
});

test("non-TTY output does not launch vim", async (t) => {
  const h = await harness(t, false, false);
  await h.send("\x07");
  assert.equal(h.edits.length, 0);
});

test("file completion releases its input listener while vim edits the prompt", async (t) => {
  const h = await harness(t);
  await h.send("@");
  await h.send("\x07");
  assert.equal(h.edits.length, 1);
  assert.equal(h.edits[0].seed, "@");
  h.edits[0].finish("file reference\n");
  await h.flush();
  await h.send("\r");
  assert.equal(h.submissions[0].text, "file reference");
});
