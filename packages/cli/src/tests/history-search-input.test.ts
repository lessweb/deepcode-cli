import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { syncBuiltinESMExports } from "node:module";
import { PassThrough, Writable } from "node:stream";
import { test, type TestContext } from "node:test";
import { setTimeout } from "node:timers/promises";
import React from "react";
import { render } from "ink";
import { PromptInput, type PromptSubmission, type PromptDraft } from "../ui/views/PromptInput";
import { stripTerminalControls } from "./terminal-output";

async function harness(t: TestContext, busy = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deepcode-search-input-"));
  t.mock.method(os, "homedir", () => root);
  syncBuiltinESMExports();
  fs.mkdirSync(path.join(root, ".deepcode"));
  fs.writeFileSync(
    path.join(root, ".deepcode", "history.jsonl"),
    JSON.stringify({ session_id: "old", ts: 1, text: "disk needle" }) + "\n"
  );
  const frames: string[] = [];
  const output = Object.assign(
    new Writable({
      write(chunk, _enc, done) {
        const text = stripTerminalControls(chunk.toString());
        if (text.trim()) frames.push(text);
        done();
      },
    }),
    { columns: 100, rows: 30, isTTY: true }
  );
  const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode() {}, ref() {}, unref() {} });
  const submissions: PromptSubmission[] = [];
  let interruptions = 0;
  const props = {
    projectRoot: root,
    screenWidth: 100,
    skills: [],
    reasoningSummary: "off" as const,
    onReasoningSummaryChange: () => "",
    modelConfig: { model: "test", thinkingEnabled: false, reasoningEffort: "high" as const },
    promptHistory: ["older needle", "newer NEEDLE", "newer NEEDLE"],
    busy,
    planMode: false,
    onSubmit: (submission: PromptSubmission) => {
      submissions.push(submission);
    },
    onPromptDraftApplied() {},
    onModelConfigChange: () => "",
    onPermissionSettingsChange: () => "",
    onPlanModeChange() {},
    onInterrupt() {
      interruptions++;
    },
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
    submissions,
    interrupted: () => interruptions,
    latest: () => frames.at(-1) ?? "",
    async send(text: string) {
      input.write(text);
      await flush();
    },
    async draft(draft: PromptDraft) {
      app.rerender(React.createElement(PromptInput, { ...props, promptDraft: draft }));
      await flush();
    },
    async resize(width: number) {
      output.columns = width;
      app.rerender(React.createElement(PromptInput, { ...props, screenWidth: width }));
      await flush();
    },
  };
}

test("reverse search previews, deduplicates, navigates both directions and accepts without submitting", async (t) => {
  const h = await harness(t);
  await h.send("draft");
  await h.send("\x12");
  assert.match(h.latest(), /reverse-i-search:/);
  assert.match(h.latest(), /draft/);
  assert.doesNotMatch(h.latest(), /newer NEEDLE/);
  await h.send("needle");
  assert.match(h.latest(), /newer NEEDLE/);
  await h.send("\x12");
  assert.match(h.latest(), /older needle/);
  await h.send("\x1b[A");
  assert.match(h.latest(), /disk needle/);
  await h.send("\x1b[A");
  assert.match(h.latest(), /disk needle/);
  await h.send("\x13");
  assert.match(h.latest(), /older needle/);
  await h.send("\x1b[B");
  assert.match(h.latest(), /newer NEEDLE/);
  await h.send("\r\r");
  assert.doesNotMatch(h.latest(), /reverse-i-search:/);
  assert.equal(h.submissions.length, 0);
  await h.send(" edited");
  await h.send("\r");
  assert.equal(h.submissions[0].text, "newer NEEDLE edited");
});

test("Esc and Ctrl+C restore cursor, attachments and collapsed paste; search cancellation does not interrupt", async (t) => {
  const h = await harness(t, true);
  await h.draft({ nonce: 1, text: "original", imageUrls: ["data:image/png;base64,test"] });
  await h.send("\x1b[D");
  await h.send("\x12needle");
  assert.doesNotMatch(h.latest(), /1 image/);
  await h.send("\x03");
  assert.equal(h.interrupted(), 0);
  assert.match(h.latest(), /original/);
  assert.match(h.latest(), /1 image/);
  await h.send("!");
  assert.match(h.latest(), /origina!l/);
  const paste = "long draft ".repeat(120);
  await h.send(`\x1b[200~${paste}\x1b[201~`);
  assert.match(h.latest(), /paste #1/);
  await h.send("\x12needle");
  await h.send("\x1b");
  assert.equal(h.interrupted(), 0);
  assert.match(h.latest(), /paste #1/);
  await h.send("\x0f");
  assert.match(h.latest(), /long draft/);
});

test("no-match Enter stays in search, paste edits only the query, and fresh draft ends search", async (t) => {
  const h = await harness(t);
  await h.send("original");
  await h.send("\x12");
  await h.send("\x1b[200~not found\x1b[201~");
  assert.match(h.latest(), /no match/);
  assert.match(h.latest(), /original/);
  await h.send("\r");
  assert.match(h.latest(), /reverse-i-search:/);
  assert.equal(h.submissions.length, 0);
  await h.send("\x15needle");
  assert.match(h.latest(), /newer NEEDLE/);
  await h.resize(24);
  assert.match(h.latest(), /reverse-i-search:/);
  await h.draft({ nonce: 2, text: "replacement", imageUrls: [] });
  assert.doesNotMatch(h.latest(), /reverse-i-search:/);
  assert.match(h.latest(), /replacement/);
});

test("accepting history discards original attachments and cancellation preserves undo", async (t) => {
  const h = await harness(t);
  await h.send("first");
  await h.send(" second");
  await h.send("\x12needle");
  await h.send("\x03");
  await h.send("\x1b[45;5u");
  assert.match(h.latest(), /> first\s*\n/);
  assert.doesNotMatch(h.latest(), /second/);
  await h.draft({ nonce: 3, text: "with image", imageUrls: ["data:image/png;base64,test"] });
  await h.send("\x12needle");
  await h.send("\r");
  assert.equal(h.submissions.length, 0);
  await h.send("\r");
  assert.deepEqual(h.submissions[0].imageUrls, []);
  assert.equal(h.submissions[0].text, "newer NEEDLE");
});
