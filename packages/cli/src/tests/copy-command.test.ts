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
import { SessionManager, type SessionEntry, type SessionMessage } from "@vegamo/deepcode-core";
import App from "../ui/views/App";
import { stripTerminalControls } from "./terminal-output";

function message(overrides: Partial<SessionMessage> = {}): SessionMessage {
  return {
    id: "assistant-message",
    sessionId: "copy-test",
    role: "assistant",
    content: "Earlier reply",
    contentParams: null,
    messageParams: null,
    compacted: false,
    visible: true,
    createTime: "2026-01-01T00:00:00Z",
    updateTime: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

async function harness(
  t: TestContext,
  history: SessionMessage[],
  { active = true, outcome = "success" }: { active?: boolean; outcome?: "success" | "failure" | "throw" } = {}
) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deepcode-copy-command-"));
  const originalEnv = process.env;
  const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
  process.env = Object.fromEntries(Object.entries(originalEnv).filter(([key]) => !key.startsWith("DEEPCODE_")));
  Object.defineProperty(process, "platform", { value: "darwin" });
  t.mock.method(os, "homedir", () => root);
  fs.mkdirSync(path.join(root, ".deepcode"));
  fs.writeFileSync(path.join(root, ".deepcode", "settings.json"), JSON.stringify({ statusline: { enabled: false } }));
  const entry: SessionEntry = {
    id: "copy-test",
    summary: "Previous conversation",
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
    createTime: "2026-01-01T00:00:00Z",
    updateTime: "2026-01-01T00:00:00Z",
  };
  const copies: { text: string }[] = [];
  t.mock.method(childProcess, "spawn", (command: string) => {
    assert.equal(command, "pbcopy");
    if (outcome === "throw") throw new Error("Clipboard unavailable");
    const copy = { text: "" };
    copies.push(copy);
    const stdin = new PassThrough();
    stdin.on("data", (chunk: Buffer) => (copy.text += chunk.toString("utf8")));
    const child = Object.assign(new EventEmitter(), { stdin, kill: () => true });
    queueMicrotask(() => child.emit("exit", outcome === "success" ? 0 : 1));
    return child;
  });
  syncBuiltinESMExports();
  t.mock.method(SessionManager.prototype, "initMcpServers", async () => {});
  t.mock.method(SessionManager.prototype, "listSkills", async () => []);
  t.mock.method(SessionManager.prototype, "getActiveSessionId", () => (active ? entry.id : null));
  t.mock.method(SessionManager.prototype, "getSession", () => (active ? entry : null));
  t.mock.method(SessionManager.prototype, "listSessions", () => (active ? [entry] : []));
  t.mock.method(SessionManager.prototype, "listSessionMessages", () => history);
  const prompt = t.mock.method(SessionManager.prototype, "handleUserPrompt", async () => {});
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
  const app = render(React.createElement(App, { projectRoot: root, resumeSessionId: active ? entry.id : undefined }), {
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
    Object.defineProperty(process, "platform", platform);
    fs.rmSync(root, { recursive: true, force: true });
  });
  async function flush() {
    await setTimeout(30);
    await app.waitUntilRenderFlush();
  }
  await flush();
  return {
    copies,
    latest: () => frames.at(-1) ?? "",
    async submit(value = "/copy") {
      const before = structuredClone(history);
      input.emit("data", value);
      await flush();
      input.emit("data", "\r");
      await flush();
      assert.equal(prompt.mock.callCount(), 0);
      assert.deepEqual(history, before);
    },
  };
}

test("/copy preserves the latest assistant body and excludes reasoning, tool calls and tool output", async (t) => {
  const text = "  **中文 😀**\n\n```sh\necho 'hello'\n```\n";
  const h = await harness(t, [
    message(),
    message({
      id: "latest",
      content: text,
      messageParams: { reasoning_content: "Private reasoning", tool_calls: [{ id: "tool-call" }] },
      contentParams: [{ text: "Not body text" }],
    }),
    message({ id: "tool", role: "tool", content: "Tool output" }),
    message({ id: "user", role: "user", content: "User prompt" }),
  ]);
  await h.submit();
  assert.deepEqual(h.copies, [{ text }]);
  assert.match(h.latest(), /Copied to clipboard/);
});

for (const [name, history, active] of [
  ["no active session", [], false],
  ["empty session", [], true],
  ["no assistant messages", [message({ role: "user" })], true],
] as const) {
  test(`/copy reports ${name}`, async (t) => {
    const h = await harness(t, [...history], { active });
    await h.submit();
    assert.match(h.latest(), /No assistant messages to copy yet\./);
    assert.deepEqual(h.copies, []);
  });
}

for (const [name, overrides] of [
  ["null content", { content: null }],
  ["empty content", { content: "" }],
  ["whitespace content", { content: " \n\t " }],
  ["Thinking content", { content: "Tool preamble", meta: { asThinking: true } }],
  ["reasoning only", { content: null, messageParams: { reasoning_content: "Private reasoning" } }],
  ["invisible tool call", { content: null, visible: false, messageParams: { tool_calls: [{ id: "call" }] } }],
] satisfies [string, Partial<SessionMessage>][]) {
  test(`/copy does not fall back to an earlier reply for ${name}`, async (t) => {
    const h = await harness(t, [message(), message({ id: "latest", ...overrides })]);
    await h.submit();
    assert.match(h.latest(), /No text to copy from the last assistant message\./);
    assert.deepEqual(h.copies, []);
  });
}

for (const outcome of ["failure", "throw"] as const) {
  test(`/copy reports clipboard ${outcome}`, async (t) => {
    const h = await harness(t, [message()], { outcome });
    await h.submit();
    assert.match(h.latest(), /Failed to copy/);
  });
}

test("/copy can be selected from completion and ignores trailing arguments", async (t) => {
  const h = await harness(t, [message()]);
  await h.submit("/cop");
  await h.submit("/copy extra text");
  assert.deepEqual(h.copies, [{ text: "Earlier reply" }, { text: "Earlier reply" }]);
  assert.match(h.latest(), /Copied to clipboard/);
});
