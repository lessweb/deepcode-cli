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
import { SessionManager, type SessionEntry, type SessionMessage } from "@vegamo/deepcode-core";
import App from "../ui/views/App";

async function harness(t: TestContext, compact: (signal: AbortSignal) => Promise<boolean>, active = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deepcode-compact-command-"));
  const originalEnv = process.env;
  process.env = Object.fromEntries(Object.entries(originalEnv).filter(([key]) => !key.startsWith("DEEPCODE_")));
  t.mock.method(os, "homedir", () => root);
  syncBuiltinESMExports();
  fs.mkdirSync(path.join(root, ".deepcode"));
  fs.writeFileSync(path.join(root, ".deepcode", "settings.json"), JSON.stringify({ statusline: { enabled: false } }));
  const entry: SessionEntry = {
    id: "compact-test",
    summary: "Previous conversation",
    assistantReply: null,
    assistantThinking: null,
    assistantRefusal: null,
    toolCalls: null,
    status: "completed",
    failReason: null,
    usage: null,
    usagePerModel: null,
    activeTokens: 20000,
    processes: null,
    createTime: "2026-01-01T00:00:00Z",
    updateTime: "2026-01-01T00:00:00Z",
  };
  const history: SessionMessage[] = [
    {
      id: "old-prompt",
      sessionId: entry.id,
      role: "user",
      content: "Keep this conversation visible",
      contentParams: null,
      messageParams: null,
      compacted: false,
      visible: true,
      createTime: entry.createTime,
      updateTime: entry.updateTime,
    },
  ];
  t.mock.method(SessionManager.prototype, "initMcpServers", async () => {});
  t.mock.method(SessionManager.prototype, "listSkills", async () => []);
  t.mock.method(SessionManager.prototype, "getActiveSessionId", () => (active ? entry.id : null));
  t.mock.method(SessionManager.prototype, "getSession", () => (active ? entry : null));
  const list = t.mock.method(SessionManager.prototype, "listSessions", () => (active ? [entry] : []));
  t.mock.method(SessionManager.prototype, "listSessionMessages", () => history);
  const prompt = t.mock.method(SessionManager.prototype, "handleUserPrompt", async () => {});
  const interrupt = t.mock.method(SessionManager.prototype, "interruptActiveSession", () => {});
  const compaction = t.mock.method(
    SessionManager.prototype as unknown as {
      compactSessionOnce(sessionId: string, signal: AbortSignal, retain: number): Promise<boolean>;
    },
    "compactSessionOnce",
    async (id: string, signal?: AbortSignal) => {
      assert.equal(id, entry.id);
      assert.ok(signal);
      const changed = await compact(signal);
      if (changed) entry.activeTokens = 1000;
      return changed;
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
  const app = render(
    React.createElement(App, {
      projectRoot: root,
      resumeSessionId: active ? entry.id : undefined,
    }),
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
    await setTimeout(30);
    await app.waitUntilRenderFlush();
  }
  async function send(value: string) {
    input.emit("data", value);
    await flush();
  }
  await flush();
  return {
    app,
    frames,
    entry,
    list,
    prompt,
    interrupt,
    compaction,
    send,
    flush,
    async submit(value = "/compact") {
      await send(value);
      await send("\r");
    },
    latest: () => frames.at(-1) ?? "",
  };
}

test("/compact preserves displayed history, refreshes usage and waits for another prompt", async (t) => {
  const h = await harness(t, async () => true);
  const refreshes = h.list.mock.callCount();
  await h.submit();
  assert.equal(h.compaction.mock.callCount(), 1);
  assert.equal(h.prompt.mock.callCount(), 0);
  assert.match(h.latest(), /> Conversation compacted\./);
  assert.equal(h.latest().match(/Conversation compacted\./g)?.length, 1);
  assert.ok(h.frames.some((frame) => frame.includes("Compacting conversation...")));
  assert.match(h.latest(), /1000\//);
  assert.ok(h.frames.some((frame) => frame.includes("Keep this conversation visible")));
  assert.ok(h.list.mock.callCount() > refreshes);
  await h.submit("Continue working");
  assert.equal(h.prompt.mock.callCount(), 1);
  assert.match(h.latest(), /> Conversation compacted\./);
});

test("/compact reports no active conversation without starting a request", async (t) => {
  const h = await harness(t, async () => true, false);
  await h.submit();
  assert.match(h.latest(), /No active conversation to compact\./);
  assert.equal(h.compaction.mock.callCount(), 0);
  assert.equal(h.prompt.mock.callCount(), 0);
});

test("/compact can be selected from the completion menu", async (t) => {
  const h = await harness(t, async () => true);
  await h.submit("/comp");
  assert.match(h.latest(), /Conversation compacted\./);
  assert.equal(h.compaction.mock.callCount(), 1);
  assert.equal(h.prompt.mock.callCount(), 0);
});

test("/compact reports a no-op without claiming success", async (t) => {
  const h = await harness(t, async () => false);
  // Trailing text follows the existing behavior of parameterless commands.
  await h.submit("/compact extra text");
  assert.match(h.latest(), /Conversation was not compacted\./);
  assert.equal(h.compaction.mock.callCount(), 1);
  assert.equal(h.prompt.mock.callCount(), 0);
});

test("/compact failures restore input and allow retry", async (t) => {
  let attempts = 0;
  const h = await harness(t, async () => {
    if (++attempts === 1) throw new Error("Summary request failed");
    return true;
  });
  await h.submit();
  assert.match(h.latest(), /Error: Summary request failed/);
  await h.submit();
  assert.match(h.latest(), /Conversation compacted\./);
  assert.doesNotMatch(h.latest(), /Summary request failed/);
  assert.equal(h.prompt.mock.callCount(), 0);
});

test("Esc cancels compaction without interrupting the session; duplicate submissions are blocked", async (t) => {
  let signal: AbortSignal | undefined;
  const h = await harness(t, (current) => {
    signal = current;
    return new Promise((_resolve, reject) => {
      current.addEventListener("abort", () => reject(current.reason), { once: true });
    });
  });
  await h.submit();
  assert.match(h.latest(), /Compacting conversation\.\.\./);
  await h.submit();
  assert.equal(h.compaction.mock.callCount(), 1);
  assert.equal(h.prompt.mock.callCount(), 0);
  await h.send("\u001b");
  assert.equal(signal?.aborted, true);
  assert.equal(h.interrupt.mock.callCount(), 0);
  assert.match(h.latest(), /Compaction cancelled\./);
  assert.doesNotMatch(h.latest(), /Error:/);
  // Clear the duplicate command left in the input before submitting a normal prompt.
  await h.send("\u0015");
  await h.submit("Continue working");
  assert.equal(h.prompt.mock.callCount(), 1);
});

test("unmount cancels an in-flight compaction", async (t) => {
  let signal: AbortSignal | undefined;
  const h = await harness(t, (current) => {
    signal = current;
    return new Promise((_resolve, reject) => {
      current.addEventListener("abort", () => reject(current.reason), { once: true });
    });
  });
  await h.submit();
  h.app.unmount();
  await h.flush();
  assert.equal(signal?.aborted, true);
  assert.equal(h.interrupt.mock.callCount(), 0);
});

test("exiting cancels an in-flight compaction", async (t) => {
  let signal: AbortSignal | undefined;
  const h = await harness(t, (current) => {
    signal = current;
    return new Promise((_resolve, reject) => {
      current.addEventListener("abort", () => reject(current.reason), { once: true });
    });
  });
  await h.submit();
  await h.send("\u0004");
  await h.send("\u0004");
  assert.equal(signal?.aborted, true);
  assert.equal(h.interrupt.mock.callCount(), 0);
  assert.doesNotMatch(h.latest(), /Compaction cancelled\.|Error:/);
});
