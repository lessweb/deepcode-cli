import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { PassThrough, Writable } from "node:stream";
import { setTimeout } from "node:timers/promises";
import React from "react";
import { Box, render, Static, Text } from "ink";
import sharp from "sharp";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { syncBuiltinESMExports } from "node:module";
import { SessionManager } from "@vegamo/deepcode-core";
import App from "../ui/views/App";
import { AttachmentPreviews } from "../ui/components/AttachmentPreviews";
import { MessageView } from "../ui/components/MessageView";
import { PromptInput, type PromptDraft, type PromptSubmission } from "../ui/views/PromptInput";
import { TerminalImages } from "../ui/core/terminal-images";
import { createImageInput } from "../ui/core/terminal-image-input";
import { usePreparedMessages } from "../ui/hooks/usePreparedMessages";
import type { SessionMessage } from "@vegamo/deepcode-core";
import { terminal } from "./terminal-helper";

async function imageUrl(width = 800, height = 600) {
  return `data:image/png;base64,${(
    await sharp({ create: { width, height, channels: 3, background: "red" } })
      .png()
      .toBuffer()
  ).toString("base64")}`;
}

async function nativeTerminal(t: TestContext, element: React.ReactElement, protocol = "kitty") {
  let chunks: string[] = [];
  const sink = Object.assign(
    new Writable({
      write(chunk, _encoding, done) {
        chunks.push(String(chunk));
        done();
      },
    }),
    { isTTY: true, columns: 80, rows: 30 }
  );
  const images = new TerminalImages(sink as unknown as NodeJS.WriteStream, { TERM_PROGRAM: protocol });
  const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode() {}, ref() {}, unref() {} });
  const imageInput = createImageInput(input as unknown as NodeJS.ReadStream, images);
  const app = render(element, {
    stdout: images.stdout,
    stdin: imageInput.stdin,
    stderr: images.stdout,
    interactive: true,
    incrementalRendering: true,
    patchConsole: false,
    exitOnCtrlC: false,
  });
  async function flush() {
    await setTimeout(100);
    await app.waitUntilRenderFlush();
  }
  t.after(() => {
    app.unmount();
    app.cleanup();
    imageInput.dispose();
    images.dispose();
  });
  await flush();
  return {
    images,
    output: () => chunks.join(""),
    clear: () => {
      chunks = [];
    },
    async rerender(element: React.ReactElement) {
      app.rerender(element);
      await flush();
    },
    async send(text: string) {
      input.write(text);
      await flush();
    },
    async waitForOutput(pattern: RegExp) {
      for (let attempt = 0; attempt < 20 && !pattern.test(chunks.join("")); attempt++) await flush();
      assert.match(chunks.join(""), pattern);
    },
    flush,
  };
}

test("preview switches between graphics and placeholders at 42 available columns", async (t) => {
  const urls = [await imageUrl()];
  const h = await nativeTerminal(t, React.createElement(AttachmentPreviews, { urls, width: 41 }));
  assert.match(h.output(), /\[image #1 \(800×600\)\]/);
  assert.doesNotMatch(h.output(), /\x1b_Ga=T/);
  h.clear();
  await h.rerender(React.createElement(AttachmentPreviews, { urls, width: 42 }));
  assert.match(h.output(), /\x1b_Ga=T/);
  assert.doesNotMatch(h.output(), /DC[a-f0-9]{10}[0-9a-z]+X/);
  h.clear();
  await h.rerender(React.createElement(AttachmentPreviews, { urls, width: 41 }));
  assert.match(h.output(), /\x1b_Ga=d/);
  // The label is unchanged, so incremental rendering leaves its existing row intact.
  assert.doesNotMatch(h.output(), /\x1b_Ga=T/);
});

test("iTerm2 preview uses its native protocol and can be removed", async (t) => {
  const h = await nativeTerminal(
    t,
    React.createElement(AttachmentPreviews, { urls: [await imageUrl()], width: 80 }),
    "iTerm.app"
  );
  assert.match(h.output(), /\x1b\]1337;File=/);
  h.clear();
  await h.rerender(React.createElement(Text, null, "input"));
  assert.doesNotMatch(h.output(), /1337;File=/);
  assert.match(h.output(), /\x1b\[2K/);
});

function PreparedTranscript({ messages, width = 80 }: { messages: SessionMessage[]; width?: number }) {
  const prepared = usePreparedMessages(messages, width);
  return React.createElement(
    Box,
    { flexDirection: "column" },
    React.createElement(Static<SessionMessage>, {
      items: prepared.items,
      children: (message) =>
        React.createElement(MessageView, {
          key: message.id,
          message,
          width,
          permanentImages: true,
          imagePreviews: prepared.previews.get(message),
        }),
    }),
    React.createElement(Text, null, "prompt")
  );
}

test("static transcript waits for thumbnails, preserves order and does not duplicate images", async (t) => {
  const message: SessionMessage = {
    id: "user",
    sessionId: "test",
    role: "user",
    content: "my picture",
    contentParams: [{ type: "image_url", image_url: { url: await imageUrl() } }],
    messageParams: null,
    visible: true,
    compacted: false,
    createTime: "",
    updateTime: "",
  };
  const reply: SessionMessage = {
    ...message,
    id: "assistant",
    role: "assistant",
    content: "reply",
    contentParams: null,
  };
  const h = await nativeTerminal(t, React.createElement(PreparedTranscript, { messages: [message, reply] }));
  const output = h.output();
  assert.ok(output.indexOf("my picture") < output.indexOf("\x1b_Ga=T"));
  assert.ok(output.indexOf("\x1b_Ga=T") < output.indexOf("reply"));
  assert.equal([...output.matchAll(/\x1b_Ga=T/g)].length, 1);
  h.clear();
  await h.rerender(React.createElement(PreparedTranscript, { messages: [message, reply] }));
  assert.doesNotMatch(h.output(), /\x1b_Ga=T|my picture/);
});

function promptProps(draft: PromptDraft, submissions: PromptSubmission[], output: () => void) {
  return {
    projectRoot: process.cwd(),
    screenWidth: 80,
    skills: [],
    reasoningSummary: "off" as const,
    onReasoningSummaryChange: () => "",
    modelConfig: { model: "test", thinkingEnabled: false, reasoningEffort: "high" as const },
    promptHistory: [],
    busy: false,
    disabled: false,
    promptDraft: draft,
    planMode: false,
    onSubmit: (submission: PromptSubmission) => {
      submissions.push(submission);
    },
    onPromptDraftApplied() {},
    onModelConfigChange: () => "",
    onPermissionSettingsChange: () => "",
    onPlanModeChange() {},
    onInterrupt() {},
    onToggleProcessStdout: output,
  };
}

test("Ctrl+O prioritizes text at the cursor, then previews attachments; submit resets previews", async (t) => {
  const url = await imageUrl();
  const submissions: PromptSubmission[] = [];
  let outputToggles = 0;
  const props = promptProps({ nonce: 1, text: "", imageUrls: [url, url] }, submissions, () => {
    outputToggles++;
  });
  const h = await terminal(t, React.createElement(PromptInput, props));
  assert.doesNotMatch(h.frame(), /\[image #/);
  await h.send("\x0f");
  assert.match(h.frame(), /\[image #1 \(800×600\)\]/);
  assert.match(h.frame(), /\[image #2 \(800×600\)\]/);
  assert.equal(outputToggles, 0);
  await h.send("\x0f");
  const pasted = "paste content ".repeat(100);
  await h.send(`\x1b[200~${pasted}\x1b[201~`);
  assert.match(h.frame(), /\[paste #1/);
  await h.send("\x0f");
  assert.match(h.frame(), /paste content/);
  assert.doesNotMatch(h.frame(), /\[image #/);
  await h.send("\x0f");
  assert.match(h.frame(), /\[paste #1/);
  await h.send("\x1b[F");
  await h.send(" after");
  await h.send("\x0f");
  assert.match(h.frame(), /\[image #1/);
  await h.send("\r");
  assert.equal(submissions.length, 1);
  assert.deepEqual(submissions[0].imageUrls, [url, url]);
  assert.equal(submissions[0].text, pasted + " after");
  assert.doesNotMatch(h.frame(), /\[image #/);
  await h.send("\x0f");
  assert.equal(outputToggles, 1);
});

test("clearing images and restoring a draft do not resurrect an old preview", async (t) => {
  const url = await imageUrl();
  let props = promptProps({ nonce: 1, text: "", imageUrls: [url] }, [], () => {});
  const h = await terminal(t, React.createElement(PromptInput, props));
  await h.send("\x0f");
  await h.send("\x18");
  assert.doesNotMatch(h.frame(), /\[image #/);
  props = { ...props, promptDraft: { nonce: 2, text: "restored", imageUrls: [url] } };
  h.rerender(React.createElement(PromptInput, props));
  await h.send("");
  assert.doesNotMatch(h.frame(), /\[image #/);
  await h.send("\x0f");
  assert.match(h.frame(), /\[image #1/);
});

test("native prompt input filters size replies, recomputes previews and keeps attachment data intact", async (t) => {
  const url = await imageUrl();
  const submissions: PromptSubmission[] = [];
  const props = promptProps({ nonce: 1, text: "", imageUrls: [url] }, submissions, () => {});
  const h = await nativeTerminal(t, React.createElement(PromptInput, props));
  await h.send("hello\x1b[6;10;10t");
  assert.deepEqual(h.images.cell, { width: 10, height: 10 });
  await h.send("\x0f");
  await h.waitForOutput(/c=14,r=10/);
  h.clear();
  await h.send("\x1b[6;18;9t");
  await h.waitForOutput(/c=27,r=10/);
  assert.match(h.output(), /a=d/);
  await h.send("\r");
  assert.equal(submissions[0].text, "hello");
  assert.deepEqual(submissions[0].imageUrls, [url]);
});

test("replaying static messages after resize prepares images at the new width", async (t) => {
  const message: SessionMessage = {
    id: "resize-user",
    sessionId: "test",
    role: "user",
    content: "picture",
    contentParams: [{ type: "image_url", image_url: { url: await imageUrl() } }],
    messageParams: null,
    visible: true,
    compacted: false,
    createTime: "",
    updateTime: "",
  };
  const h = await nativeTerminal(t, React.createElement(PreparedTranscript, { messages: [message], width: 44 }));
  assert.match(h.output(), /\[image #1 \(800×600\)\]/);
  assert.doesNotMatch(h.output(), /a=T/);
  await h.rerender(React.createElement(PreparedTranscript, { messages: [], width: 80 }));
  h.clear();
  await h.rerender(React.createElement(PreparedTranscript, { messages: [message], width: 80 }));
  assert.match(h.output(), /a=T/);
});

for (const protocol of ["kitty", "iTerm.app"]) {
  test(`saved attachments remain in the transcript when the assistant replies (${protocol})`, async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "deepcode-saved-preview-"));
    const originalEnv = process.env;
    process.env = Object.fromEntries(Object.entries(originalEnv).filter(([key]) => !key.startsWith("DEEPCODE_")));
    t.mock.method(os, "homedir", () => root);
    syncBuiltinESMExports();
    fs.mkdirSync(path.join(root, ".deepcode"));
    fs.writeFileSync(path.join(root, ".deepcode", "settings.json"), JSON.stringify({ statusline: { enabled: false } }));
    let releasePreparation!: () => void;
    const preparation = new Promise<void>((resolve) => {
      releasePreparation = resolve;
    });
    let releaseReply!: () => void;
    const reply = new Promise<void>((resolve) => {
      releaseReply = resolve;
    });
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
        requestSessionCompletion: async () => {
          await reply;
          return { choices: [{ message: { content: "The image is red." } }] };
        },
      });
    });
    t.mock.method(SessionManager.prototype, "listSkills", async () => []);
    t.mock.method(SessionManager.prototype, "identifyMatchingSkillNames", async () => []);
    const h = await nativeTerminal(t, React.createElement(App, { projectRoot: root }), protocol);
    const manager = managerRef.current!;
    t.after(async () => {
      manager?.interruptActiveSession();
      releasePreparation();
      releaseReply();
      const id = manager?.getActiveSessionId();
      if (id) await manager.waitForSessionIdle(id).catch(() => {});
      manager?.dispose();
      await new Promise((resolve) => setImmediate(resolve));
      t.mock.restoreAll();
      syncBuiltinESMExports();
      process.env = originalEnv;
      fs.rmSync(root, { recursive: true, force: true });
    });
    const running = manager.createSession({
      text: "Describe this picture",
      imageUrls: [await imageUrl(82, 282), await imageUrl(208, 192)],
    });
    await h.flush();
    const imageSequence = protocol === "kitty" ? /a=T,f=100/ : /1337;File=inline=1/;
    assert.match(h.output(), imageSequence, "queued prompt should display its data URL image");
    await h.flush();
    h.clear();
    await setTimeout(550);
    await h.flush();
    assert.doesNotMatch(h.output(), imageSequence, "preparation status updates must not resend queued previews");
    h.clear();
    releasePreparation();
    for (let attempt = 0; attempt < 20 && !imageSequence.test(h.output()); attempt++) await h.flush();
    const saved = manager
      .listSessionMessages(manager.getActiveSessionId()!)
      .find((message) => message.role === "user")!;
    assert.equal(saved.contentParams, null);
    assert.match(saved.meta!.userPrompt!.imageUrls![0], /^file:/);
    assert.match(h.output(), imageSequence, "committed prompt must display the persisted file image");
    assert.doesNotMatch(h.output(), /\[image #1\]/, "valid file should not degrade to a placeholder");
    const staticId = /a=T,f=100,t=d,i=(\d+)/.exec(h.output())?.[1];
    h.clear();
    releaseReply();
    await running;
    await h.flush();
    assert.match(h.output(), /The image is red/);
    assert.doesNotMatch(
      h.output(),
      /> Describe this picture/,
      "assistant append should preserve existing static output"
    );
    if (staticId)
      assert.ok(!h.output().includes(`a=d,d=I,i=${staticId},`), "assistant append must not delete the saved image");
  });
}

for (const protocol of ["kitty", "iTerm.app"]) {
  test(`status updates do not resend unchanged multi-image previews (${protocol})`, async (t) => {
    const urls = await Promise.all(
      [
        [82, 282],
        [208, 192],
      ].map(async ([width, height]) => {
        const png = await sharp({ create: { width, height, channels: 3, background: "red" } })
          .png()
          .toBuffer();
        return `data:image/png;base64,${png.toString("base64")}`;
      })
    );
    function PreviewFrame({ tick, tail = true, heading = false }: { tick: number; tail?: boolean; heading?: boolean }) {
      return React.createElement(
        Box,
        { flexDirection: "column" },
        heading ? React.createElement(Text, null, "Queued message") : null,
        React.createElement(AttachmentPreviews, { urls, width: 80 }),
        React.createElement(Text, null, `Thinking ${tick}`),
        tail ? React.createElement(Text, null, "extra line") : null
      );
    }
    const h = await nativeTerminal(t, React.createElement(PreviewFrame, { tick: 0 }), protocol);
    assert.match(h.output(), /a=T|1337;File=/);
    h.clear();
    await h.rerender(React.createElement(PreviewFrame, { tick: 1 }));
    assert.match(h.output(), /Thinking 1/);
    assert.doesNotMatch(h.output(), /a=T|a=d|1337;File=/, "status changes must leave both images in place");
    h.clear();
    await h.rerender(React.createElement(PreviewFrame, { tick: 2, tail: false }));
    assert.doesNotMatch(h.output(), /a=T|a=d|1337;File=/, "removing a footer must not erase retained images");
    h.clear();
    await h.rerender(React.createElement(PreviewFrame, { tick: 3, tail: false, heading: true }));
    const transmissions = [...h.output().matchAll(/a=T|1337;File=/g)];
    assert.equal(transmissions.length, 2, "moving the previews must redraw both images at the new positions");
    assert.doesNotMatch(h.output(), /DC[a-f0-9]{10}[0-9a-z]+X/, "private row markers must never reach the terminal");
    h.clear();
    await h.rerender(React.createElement(PreviewFrame, { tick: 4, tail: false, heading: true }));
    assert.doesNotMatch(h.output(), /a=T|a=d|1337;File=/, "images must remain stable after moving");
  });
}
