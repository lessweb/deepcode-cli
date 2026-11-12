import assert from "node:assert/strict";
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
import { SessionManager } from "@vegamo/deepcode-core";
import type { SessionManagerOptions, SessionMessage } from "@vegamo/deepcode-core";
import App from "../ui/views/App";
import { RawMode, RawModeProvider, useRawModeContext } from "../ui/contexts";

async function harness(t: TestContext, config?: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deepcode-raw-mode-"));
  const originalEnv = process.env;
  process.env = Object.fromEntries(Object.entries(originalEnv).filter(([key]) => !key.startsWith("DEEPCODE_")));
  t.mock.method(os, "homedir", () => root);
  syncBuiltinESMExports();
  const directory = path.join(root, ".deepcode");
  fs.mkdirSync(directory);
  const file = path.join(directory, "cli.json");
  if (config !== undefined) fs.writeFileSync(file, config);
  fs.writeFileSync(path.join(directory, "settings.json"), JSON.stringify({ statusline: { enabled: false } }));
  t.mock.method(SessionManager.prototype, "initMcpServers", async () => {});
  t.mock.method(SessionManager.prototype, "listSkills", async () => []);
  let emitMessage: SessionManagerOptions["onAssistantMessage"];
  t.mock.method(SessionManager.prototype, "listSessions", function (this: SessionManager) {
    emitMessage = (this as unknown as Pick<SessionManagerOptions, "onAssistantMessage">).onAssistantMessage;
    return [];
  });
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
  let currentMode = RawMode.Lite;
  let previousMode = RawMode.Lite;
  function Probe() {
    const context = useRawModeContext();
    currentMode = context.mode;
    previousMode = context.previousMode;
    return null;
  }
  const app = render(
    React.createElement(
      RawModeProvider,
      null,
      React.createElement(App, { projectRoot: root }),
      React.createElement(Probe)
    ),
    {
      stdin: input as unknown as NodeJS.ReadStream,
      stdout: output as unknown as NodeJS.WriteStream,
      stderr: output as unknown as NodeJS.WriteStream,
      debug: true,
      patchConsole: false,
      exitOnCtrlC: false,
    }
  );
  t.after(() => {
    app.unmount();
    app.cleanup();
    t.mock.restoreAll();
    syncBuiltinESMExports();
    process.env = originalEnv;
    fs.rmSync(root, { recursive: true, force: true });
  });
  async function flush() {
    await setTimeout(250);
    await app.waitUntilRenderFlush();
  }
  async function send(value: string) {
    input.write(value);
    await flush();
  }
  await flush();
  return {
    file,
    send,
    mode: () => currentMode,
    previous: () => previousMode,
    latest: () => frames.at(-1) ?? "",
    emitMessage(message: SessionMessage) {
      emitMessage(message, true);
    },
    async submit(value: string) {
      await send(value);
      await send("\r");
    },
  };
}

test("raw scrollback filters incoming messages without writing blank lines", async (t) => {
  const h = await harness(t);
  await h.submit("/raw raw-scrollback");
  assert.equal(h.mode(), RawMode.Raw, h.latest());
  let output = "";
  const stdout = t.mock.method(process.stdout, "write", (chunk: string) => {
    output += chunk;
    return true;
  });
  const message: SessionMessage = {
    id: "incoming",
    sessionId: "raw-test",
    role: "assistant",
    content: "Answer",
    visible: true,
    compacted: false,
    contentParams: null,
    messageParams: null,
    createTime: "2026-01-01T00:00:00Z",
    updateTime: "2026-01-01T00:00:00Z",
  };
  h.emitMessage({ ...message, meta: { asThinking: true } });
  h.emitMessage({ ...message, role: "tool" });
  h.emitMessage({ ...message, role: "system", meta: { isModelChange: true } });
  h.emitMessage({ ...message, content: " \n" });
  h.emitMessage({ ...message, visible: false });
  assert.equal(output, "");
  h.emitMessage({ ...message, role: "user", content: "Question" });
  h.emitMessage(message);
  assert.equal(stripTerminalControls(output), "\n> Question\n\n\n✦ Answer\n\n");
  stdout.mock.restore();
});

test("commands save normal and lite, including explicitly selecting the default", async (t) => {
  const h = await harness(t);
  assert.equal(h.mode(), RawMode.Lite);
  assert.equal(fs.existsSync(h.file), false);
  await h.submit("/raw lite");
  assert.equal(JSON.parse(fs.readFileSync(h.file, "utf8")).rawMode, "lite");
  await h.submit("/raw normal");
  assert.equal(h.mode(), RawMode.None);
  assert.equal(JSON.parse(fs.readFileSync(h.file, "utf8")).rawMode, "normal");
  await h.submit("/raw lite");
  assert.equal(h.mode(), RawMode.Lite);
  assert.equal(JSON.parse(fs.readFileSync(h.file, "utf8")).rawMode, "lite");
});

test("restored normal survives raw scrollback and Escape returns to normal", async (t) => {
  const config = '{"rawMode":"normal","future":true}';
  const h = await harness(t, config);
  assert.equal(h.mode(), RawMode.None);
  assert.equal(h.previous(), RawMode.None);
  const writes = t.mock.method(fs, "renameSync");
  await h.submit("/raw raw-scrollback");
  assert.equal(h.mode(), RawMode.Raw);
  assert.equal(writes.mock.callCount(), 0);
  assert.equal(fs.readFileSync(h.file, "utf8"), config);
  await h.send("\u001b");
  assert.equal(h.mode(), RawMode.None);
  assert.deepEqual(JSON.parse(fs.readFileSync(h.file, "utf8")), { rawMode: "normal", future: true });
});

test("selecting raw scrollback in the menu creates no configuration", async (t) => {
  const h = await harness(t);
  await h.submit("/raw");
  await h.send("\u001b[B");
  await h.send("\u001b[B");
  await h.send("\r");
  assert.equal(h.mode(), RawMode.Raw);
  assert.equal(fs.existsSync(h.file), false);
  await h.send("\u001b");
  assert.equal(h.mode(), RawMode.Lite);
});

test("the menu saves a selection once through the shared handler", async (t) => {
  const h = await harness(t);
  const writes = t.mock.method(fs, "renameSync");
  await h.submit("/raw");
  await h.send("\u001b[B");
  await h.send("\r");
  assert.equal(h.mode(), RawMode.None);
  assert.equal(writes.mock.callCount(), 1);
  assert.equal(JSON.parse(fs.readFileSync(h.file, "utf8")).rawMode, "normal");
});

test("invalid configuration falls back to lite and save failures do not block switching", async (t) => {
  const h = await harness(t, "{");
  assert.equal(h.mode(), RawMode.Lite);
  await h.submit("/raw normal");
  assert.equal(h.mode(), RawMode.None);
  assert.equal(fs.readFileSync(h.file, "utf8"), "{");
  assert.match(h.latest(), /Could not save display mode\./);
});
