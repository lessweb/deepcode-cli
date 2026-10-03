import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Writable } from "node:stream";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import { stripVTControlCharacters } from "node:util";
import React from "react";
import { render } from "ink";
import stringWidth from "string-width";
import { PromptInput } from "../ui/views/PromptInput";
import type { PromptSubmission } from "../ui/views/PromptInput";

async function renderBusyInput(
  queuedPrompts: readonly PromptSubmission[] = [
    { text: "Review the changes", imageUrls: [] },
    { text: "Run the tests", imageUrls: [] },
  ]
) {
  const projectRoot = mkdtempSync(join(tmpdir(), "deepcode-prompt-input-"));
  const frames: string[] = [];
  const submissions: PromptSubmission[] = [];
  let interrupts = 0;
  const stdout = Object.assign(
    new Writable({
      write(chunk, _encoding, callback) {
        frames.push(chunk.toString());
        callback();
      },
    }),
    { columns: 80, rows: 24, isTTY: false }
  );
  const stdin = Object.assign(new PassThrough(), {
    isTTY: true,
    setRawMode: () => stdin,
    ref: () => stdin,
    unref: () => stdin,
  });
  const props = {
    projectRoot,
    screenWidth: 80,
    skills: [],
    modelConfig: { model: "deepseek-flash", thinkingEnabled: false, reasoningEffort: "high" as const },
    promptHistory: [],
    busy: true,
    queuedPrompts,
    planMode: false,
    onSubmit: (submission: PromptSubmission) => submissions.push(submission),
    onInterrupt: () => interrupts++,
    onPlanModeChange: () => {},
    onModelConfigChange: () => "",
  };
  const app = render(React.createElement(PromptInput, props), {
    stdin: stdin as unknown as NodeJS.ReadStream,
    stdout: stdout as unknown as NodeJS.WriteStream,
    debug: true,
    patchConsole: false,
    exitOnCtrlC: false,
  });
  async function flush() {
    await setImmediate();
    await app.waitUntilRenderFlush();
  }
  await flush();
  return {
    get frame() {
      return [...frames].reverse().find((frame) => stripVTControlCharacters(frame).trim().length > 0) ?? "";
    },
    submissions,
    get interrupts() {
      return interrupts;
    },
    async input(value: string) {
      stdin.emit("data", value);
      await flush();
    },
    async updateQueue(queuedPrompts: readonly PromptSubmission[]) {
      app.rerender(React.createElement(PromptInput, { ...props, queuedPrompts }));
      await flush();
    },
    cleanup() {
      app.unmount();
      app.cleanup();
      stdin.destroy();
      stdout.destroy();
      rmSync(projectRoot, { recursive: true, force: true });
    },
  };
}

test("busy prompt input accepts plain prompts and shows the queue count and composing cursor", async () => {
  const h = await renderBusyInput();
  try {
    await h.input("next prompt");
    const frame = h.frame;
    assert.match(stripVTControlCharacters(frame), /next prompt/);
    assert.match(stripVTControlCharacters(frame), /2 prompts queued/);
    assert.match(stripVTControlCharacters(frame), /1\. Review the changes/);
    assert.match(stripVTControlCharacters(frame), /2\. Run the tests/);
    assert.ok(frame.includes("\u001B[7m \u001B[27m"), "composing cursor remains visible while busy");
    await h.input("\r");
    assert.equal(h.submissions.length, 1);
    assert.equal(h.submissions[0]?.text, "next prompt");
  } finally {
    h.cleanup();
  }
});

test("queued previews stay on one line, show at most three items, and update as the queue drains", async () => {
  const h = await renderBusyInput([
    { text: `Review\nthe changes ${"long prompt ".repeat(20)}`, imageUrls: [] },
    { text: "Run the tests", imageUrls: [] },
    { text: "Check the build", imageUrls: [] },
    { text: "Fourth prompt", imageUrls: [] },
    { text: "Fifth prompt", imageUrls: [] },
  ]);
  try {
    let frame = stripVTControlCharacters(h.frame);
    assert.match(frame, /5 prompts queued/);
    assert.match(frame, /1\. Review the changes/);
    assert.match(frame, /2\. Run the tests/);
    assert.match(frame, /3\. Check the build/);
    assert.match(frame, /2 more queued/);
    assert.doesNotMatch(frame, /Fourth prompt|Fifth prompt/);
    const previewLines = frame.split("\n").filter((line) => /^\d+\. /.test(line));
    assert.equal(previewLines.length, 3);
    assert.ok(previewLines.every((line) => stringWidth(line) <= 80));

    await h.updateQueue([{ text: "Run the tests", imageUrls: [] }]);
    frame = stripVTControlCharacters(h.frame);
    assert.match(frame, /1 prompt queued/);
    assert.match(frame, /1\. Run the tests/);
    assert.doesNotMatch(frame, /Review the changes|Check the build|more queued/);

    await h.updateQueue([]);
    frame = stripVTControlCharacters(h.frame);
    assert.doesNotMatch(frame, /queued|Run the tests/);
  } finally {
    h.cleanup();
  }
});

test("busy prompt input blocks slash commands but lets /exit submit immediately", async () => {
  const h = await renderBusyInput();
  try {
    for (const command of ["/new", "/continue", "/init", "/model", "/plan"]) {
      await h.input(command);
      await h.input("\r");
      assert.deepEqual(h.submissions, [], command);
      assert.ok(stripVTControlCharacters(h.frame).includes(`> ${command}`), "blocked command stays in the input");
      await h.input("\u0015"); // Ctrl+U clears the blocked command.
    }
    await h.input("/exit");
    await h.input("\r");
    assert.deepEqual(h.submissions, [{ text: "/exit", imageUrls: [], command: "exit" }]);
  } finally {
    h.cleanup();
  }
});

test("Esc interrupts a busy run and a new intentional submission is still accepted", async () => {
  const h = await renderBusyInput();
  try {
    await h.input("\u001B");
    assert.equal(h.interrupts, 1);
    await h.input("after interrupt");
    await h.input("\r");
    assert.equal(h.submissions[0]?.text, "after interrupt");
  } finally {
    h.cleanup();
  }
});
