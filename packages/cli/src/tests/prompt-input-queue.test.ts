import assert from "node:assert/strict";
import { Readable, Writable } from "node:stream";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { stripVTControlCharacters } from "node:util";
import React from "react";
import { render } from "ink";
import { PromptInput } from "../ui";
import type { PromptSubmission } from "../ui";

type Harness = ReturnType<typeof createHarness>;

function createHarness() {
  const frames: string[] = [];
  const stdout = Object.assign(
    new Writable({
      write(chunk, _encoding, callback) {
        const frame = stripVTControlCharacters(chunk.toString());
        if (frame.trim()) {
          frames.push(frame);
        }
        callback();
      },
    }),
    { columns: 100, rows: 24, isTTY: true }
  );
  const stdin = Object.assign(new Readable({ read() {} }), {
    isTTY: true,
    setRawMode() {},
    ref() {},
    unref() {},
  });
  return { frames, stdout, stdin };
}

function renderPromptInput(
  harness: Harness,
  props: {
    busy: boolean;
    queuedPrompts?: string[];
    onSubmit: (submission: PromptSubmission) => void;
    onRemoveQueuedPrompt?: () => void;
  }
) {
  const element = React.createElement(PromptInput, {
    projectRoot: process.cwd(),
    skills: [],
    modelConfig: { model: "deepseek-v4-flash", thinkingEnabled: true, reasoningEffort: "max" },
    screenWidth: 100,
    promptHistory: [],
    busy: props.busy,
    queuedPrompts: props.queuedPrompts,
    planMode: false,
    onSubmit: props.onSubmit,
    onModelConfigChange: () => "",
    onPlanModeChange: () => {},
    onInterrupt: () => {},
    onRemoveQueuedPrompt: props.onRemoveQueuedPrompt,
  });

  return render(element, {
    stdout: harness.stdout as unknown as NodeJS.WriteStream,
    stdin: harness.stdin as unknown as NodeJS.ReadStream,
    debug: true,
    patchConsole: false,
    exitOnCtrlC: false,
  });
}

async function press(harness: Harness, app: { waitUntilRenderFlush: () => Promise<void> }, data: string) {
  harness.stdin.push(data);
  await delay(0);
  await app.waitUntilRenderFlush();
}

test("PromptInput submits a plain prompt on enter while idle", async () => {
  const harness = createHarness();
  const submissions: PromptSubmission[] = [];
  const app = renderPromptInput(harness, { busy: false, onSubmit: (submission) => submissions.push(submission) });
  try {
    await press(harness, app, "first prompt");
    await press(harness, app, "\r");
    assert.deepEqual(
      submissions.map((submission) => submission.text),
      ["first prompt"]
    );
  } finally {
    app.unmount();
  }
});

test("PromptInput still submits a plain prompt while busy so App can queue it", async () => {
  const harness = createHarness();
  const submissions: PromptSubmission[] = [];
  const app = renderPromptInput(harness, { busy: true, onSubmit: (submission) => submissions.push(submission) });
  try {
    await press(harness, app, "queued prompt");
    await press(harness, app, "\r");
    assert.deepEqual(
      submissions.map((submission) => submission.text),
      ["queued prompt"]
    );
    // Plain Enter only queues: App decides whether to steer based on steerMode.
    assert.equal(submissions[0]?.steer, undefined);
  } finally {
    app.unmount();
  }
});

test("PromptInput marks ctrl+enter as a steering submit", async () => {
  const harness = createHarness();
  const submissions: PromptSubmission[] = [];
  const app = renderPromptInput(harness, { busy: true, onSubmit: (submission) => submissions.push(submission) });
  try {
    await press(harness, app, "stop doing that");
    await press(harness, app, "\u001B[13;5u");
    assert.deepEqual(
      submissions.map((submission) => submission.text),
      ["stop doing that"]
    );
    assert.equal(submissions[0]?.steer, true);
  } finally {
    app.unmount();
  }
});

test("PromptInput keeps blocking slash commands while busy", async () => {
  const harness = createHarness();
  const submissions: PromptSubmission[] = [];
  const app = renderPromptInput(harness, { busy: true, onSubmit: (submission) => submissions.push(submission) });
  try {
    await press(harness, app, "/model");
    await press(harness, app, "\r");
    assert.deepEqual(submissions, []);
    // The buffer is kept so the user can run the command once the turn finishes.
    assert.match(harness.frames.at(-1) ?? "", /\/model/);
  } finally {
    app.unmount();
  }
});

test("PromptInput still allows /exit while busy so the CLI can quit", async () => {
  const harness = createHarness();
  const submissions: PromptSubmission[] = [];
  const app = renderPromptInput(harness, { busy: true, onSubmit: (submission) => submissions.push(submission) });
  try {
    await press(harness, app, "/exit");
    await press(harness, app, "\r");
    // App receives the command (not a prompt), so `/exit` keeps quitting the CLI
    // instead of being queued as guidance for the running turn.
    assert.deepEqual(
      submissions.map((submission) => submission.command),
      ["exit"]
    );
    assert.equal(submissions[0]?.steer, undefined);
  } finally {
    app.unmount();
  }
});

test("PromptInput renders pending guidance and removes the last one on backspace", async () => {
  const harness = createHarness();
  let removed = 0;
  const app = renderPromptInput(harness, {
    busy: true,
    queuedPrompts: ["older prompt", "newer prompt"],
    onSubmit: () => {},
    onRemoveQueuedPrompt: () => {
      removed += 1;
    },
  });
  try {
    await delay(0);
    await app.waitUntilRenderFlush();
    const frame = harness.frames.at(-1) ?? "";
    assert.match(frame, /guidance 1\. older prompt/);
    assert.match(frame, /guidance 2\. newer prompt/);
    assert.match(frame, /2 guidance queued/);

    await press(harness, app, "\u007F");
    assert.equal(removed, 1);
  } finally {
    app.unmount();
  }
});
