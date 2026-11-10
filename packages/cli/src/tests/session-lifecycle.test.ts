import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { syncBuiltinESMExports } from "node:module";
import { test, type TestContext } from "node:test";
import React from "react";
import { SessionManager, type SessionMessage } from "@vegamo/deepcode-core";
import App from "../ui/views/App";
import { terminal } from "./terminal-helper";
import { McpClient } from "../../../core/src/mcp/mcp-client";
import { MCP_TEST_SERVER } from "../../../core/src/tests/mcp-test-server";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}

async function harness(
  t: TestContext,
  respond: (messages: SessionMessage[], signal: AbortSignal) => unknown | Promise<unknown>
) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deepcode-session-lifecycle-"));
  const originalEnv = process.env;
  process.env = Object.fromEntries(Object.entries(originalEnv).filter(([key]) => !key.startsWith("DEEPCODE_")));
  t.mock.method(os, "homedir", () => root);
  syncBuiltinESMExports();
  fs.mkdirSync(path.join(root, ".deepcode"));
  fs.writeFileSync(path.join(root, ".deepcode", "settings.json"), JSON.stringify({ statusline: { enabled: false } }));
  const ref: { current?: SessionManager } = {};
  const initMcpServers = SessionManager.prototype.initMcpServers;
  t.mock.method(SessionManager.prototype, "initMcpServers", async function (this: SessionManager) {
    ref.current = this;
    Object.assign(this, {
      createOpenAIClient: () => ({ client: {}, model: "test", thinkingEnabled: false, telemetryEnabled: false }),
      getProjectStorage: () => ({
        projectCode: "test",
        projectDir: path.join(root, "storage"),
        sessionsIndexPath: path.join(root, "storage", "sessions-index.json"),
      }),
      maybeGenerateSessionTitle: () => {},
      requestSessionCompletion: (id: string, signal: AbortSignal) => respond(this.listSessionMessages(id), signal),
    });
  });
  t.mock.method(SessionManager.prototype, "listSkills", async () => []);
  const h = await terminal(t, React.createElement(App, { projectRoot: root }), 100);
  const manager = ref.current!;
  t.after(async () => {
    const id = manager.getActiveSessionId();
    if (id && manager.isSessionRunning(id)) {
      manager.interruptSession(id);
      await manager.waitForSessionIdle(id).catch(() => {});
    }
    manager.dispose();
    await new Promise((resolve) => setImmediate(resolve));
    t.mock.restoreAll();
    syncBuiltinESMExports();
    process.env = originalEnv;
    fs.rmSync(root, { recursive: true, force: true });
  });
  return {
    ...h,
    manager,
    initMcpServers: initMcpServers.bind(manager),
    async submit(text: string) {
      await h.send(text);
      await h.send("\r");
    },
  };
}

for (const next of ["Use the default settings.", "/continue"]) {
  test(`Esc cancels a real AskUserQuestion session and permits ${next}`, { timeout: 10000 }, async (t) => {
    const requests: SessionMessage[][] = [];
    const h = await harness(t, (messages) => {
      requests.push(messages);
      return {
        choices: [
          {
            message:
              requests.length === 1
                ? {
                    content: "",
                    tool_calls: [
                      {
                        id: "question",
                        type: "function",
                        function: {
                          name: "AskUserQuestion",
                          arguments: JSON.stringify({
                            questions: [{ question: "Which settings?", options: [{ label: "Default" }] }],
                          }),
                        },
                      },
                    ],
                  }
                : { content: "done" },
          },
        ],
      };
    });
    await h.submit("Ask me which settings to use.");
    const id = h.manager.getActiveSessionId()!;
    await h.manager.waitForSessionIdle(id);
    await h.send("");
    assert.equal(h.manager.getSession(id)?.status, "waiting_for_user");
    assert.match(h.frame(), /Which settings\?/);
    h.manager.enqueuePrompt(id, { text: "also keep the existing files" });
    await h.send("\x1b");
    assert.equal(h.manager.getSession(id)?.status, "interrupted");
    assert.match(h.frame(), /Type your message/);
    assert.equal(requests.length, 1, "cancelling must not automatically consume queued input");
    await h.submit(next);
    await h.manager.waitForSessionIdle(id);
    await h.send("");
    assert.equal(requests.length, 2);
    assert.ok(requests[1].some((message) => message.content === "also keep the existing files"));
    if (next !== "/continue") assert.ok(requests[1].some((message) => message.content === next));
    assert.equal(h.manager.getSession(id)?.status, "completed");
    assert.deepEqual(h.manager.listQueuedMessages(id), []);
    assert.match(h.frame(), /Type your message/);
  });
}

for (const action of ["/exit", "Ctrl+D twice"] as const) {
  test(`${action} aborts the running session and waits for cleanup before exiting`, { timeout: 10000 }, async (t) => {
    const entered = deferred();
    const cleanup = deferred();
    t.after(() => cleanup.resolve());
    let requestSignal!: AbortSignal;
    let requests = 0;
    const h = await harness(t, async (_messages, signal) => {
      requests++;
      requestSignal = signal;
      entered.resolve();
      await cleanup.promise;
      signal.throwIfAborted();
      return { choices: [{ message: { content: "done" } }] };
    });
    await h.submit("keep working");
    await entered.promise;
    const id = h.manager.getActiveSessionId()!;
    h.manager.enqueuePrompt(id, { text: "queued input" });
    const disposedWhileRunning: boolean[] = [];
    const dispose = h.manager.dispose.bind(h.manager);
    t.mock.method(h.manager, "dispose", () => {
      disposedWhileRunning.push(h.manager.isSessionRunning(id));
      dispose();
    });
    if (action === "/exit") await h.submit("/exit");
    else {
      await h.send("\x04");
      assert.equal(requestSignal.aborted, false);
      await h.send("\x04");
    }
    assert.equal(requestSignal.aborted, true);
    assert.equal(h.manager.isSessionRunning(id), true, "execution still owns the lock during cleanup");
    assert.deepEqual(disposedWhileRunning, []);
    assert.match(h.frame(), /Exiting…/);
    cleanup.resolve();
    await h.waitUntilExit();
    assert.ok(disposedWhileRunning.length > 0);
    assert.ok(disposedWhileRunning.every((running) => !running));
    assert.equal(requests, 1, "exiting must not start queued work");
    assert.equal(h.manager.getSession(id)?.status, "interrupted");
    assert.equal(h.rawMode(), false, "exit must restore terminal input mode");
  });

  test(`${action} exits promptly during an unresponsive MCP call`, { timeout: 5000 }, async (t) => {
    const entered = deferred();
    const callTool = McpClient.prototype.callTool;
    let requestSignal: AbortSignal | undefined;
    t.mock.method(
      McpClient.prototype,
      "callTool",
      function (this: McpClient, ...args: Parameters<McpClient["callTool"]>) {
        requestSignal = args[3];
        const result = callTool.apply(this, args);
        entered.resolve();
        return result;
      }
    );
    let requests = 0;
    const h = await harness(t, () => {
      requests++;
      return {
        choices: [
          {
            message: {
              content: "",
              tool_calls: [{ id: "hang", type: "function", function: { name: "mcp__probe__hang", arguments: "{}" } }],
            },
          },
        ],
      };
    });
    await h.initMcpServers({ probe: { command: process.execPath, args: ["-e", MCP_TEST_SERVER] } });
    await h.submit("call the MCP tool");
    await entered.promise;
    const id = h.manager.getActiveSessionId()!;
    h.manager.enqueuePrompt(id, { text: "queued input" });
    if (action === "/exit") await h.submit("/exit");
    else {
      await h.send("\x04");
      await h.send("\x04");
    }
    await h.waitUntilExit();
    assert.equal(requestSignal?.aborted, true);
    assert.equal(h.manager.isSessionRunning(id), false);
    assert.equal(h.manager.getSession(id)?.status, "interrupted");
    assert.equal(requests, 1);
    assert.equal(h.rawMode(), false);
  });

  test(`${action} exits after five seconds even if execution ignores cancellation`, { timeout: 12000 }, async (t) => {
    const entered = deferred();
    const cleanup = deferred();
    t.after(() => cleanup.resolve());
    let requests = 0;
    const h = await harness(t, async (_messages, signal) => {
      requests++;
      entered.resolve();
      await cleanup.promise;
      signal.throwIfAborted();
    });
    await h.submit("keep working");
    await entered.promise;
    const id = h.manager.getActiveSessionId()!;
    h.manager.enqueuePrompt(id, { text: "queued input" });
    const disposedWhileRunning: boolean[] = [];
    const dispose = h.manager.dispose.bind(h.manager);
    t.mock.method(h.manager, "dispose", () => {
      disposedWhileRunning.push(h.manager.isSessionRunning(id));
      dispose();
    });
    const started = performance.now();
    if (action === "/exit") await h.submit("/exit");
    else {
      await h.send("\x04");
      await h.send("\x04");
    }
    assert.match(h.frame(), /Exiting…/);
    assert.deepEqual(disposedWhileRunning, []);
    await h.waitUntilExit();
    assert.ok(performance.now() - started >= 5_000, "allow five seconds for cleanup");
    assert.ok(performance.now() - started < 8_000, "do not wait indefinitely for execution");
    assert.equal(disposedWhileRunning[0], true);
    assert.equal(requests, 1);
    assert.equal(h.rawMode(), false);
  });
}

test("exit restores the terminal even if resource cleanup throws", { timeout: 5000 }, async (t) => {
  const h = await harness(t, () => ({ choices: [{ message: { content: "done" } }] }));
  assert.equal(h.rawMode(), true);
  const mocked = t.mock.method(h.manager, "dispose", () => {
    throw new Error("cleanup failed");
  });
  try {
    await h.submit("/exit");
    await h.waitUntilExit();
    assert.equal(h.rawMode(), false);
  } finally {
    mocked.mock.restore();
  }
});

test("exit restores the terminal even if printing the summary throws", { timeout: 5000 }, async (t) => {
  const h = await harness(t, () => ({ choices: [{ message: { content: "done" } }] }));
  const write = process.stdout.write;
  let failed = false;
  const mocked = t.mock.method(process.stdout, "write", function (...args: Parameters<typeof write>) {
    if (typeof args[0] === "string" && args[0].includes("Goodbye!")) {
      failed = true;
      throw new Error("output failed");
    }
    return write.apply(process.stdout, args);
  });
  try {
    await h.submit("/exit");
    await h.waitUntilExit();
    assert.equal(failed, true);
    assert.equal(h.rawMode(), false);
  } finally {
    mocked.mock.restore();
  }
});
