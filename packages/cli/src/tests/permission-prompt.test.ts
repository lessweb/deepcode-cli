import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { getScopeRiskColor, PermissionPrompt, type PermissionPromptResult } from "../ui/views/PermissionPrompt";
import React, { useState } from "react";
import { render, Text } from "ink";
import { PassThrough, Writable } from "node:stream";
import { setTimeout } from "node:timers/promises";
import { stripTerminalControls } from "./terminal-output";
import type { AskPermissionRequest } from "@vegamo/deepcode-core";

test("getScopeRiskColor maps permission scopes by risk", () => {
  assert.equal(getScopeRiskColor("read-in-cwd"), "#22c55e");
  assert.equal(getScopeRiskColor("read-in-tmp"), "#22c55e");
  assert.equal(getScopeRiskColor("write-in-tmp"), "#22c55e");
  assert.equal(getScopeRiskColor("query-git-log"), "#22c55e");

  assert.equal(getScopeRiskColor("read-out-cwd"), "#f59e0b");
  assert.equal(getScopeRiskColor("write-in-cwd"), "#f59e0b");
  assert.equal(getScopeRiskColor("network"), "#f59e0b");
  assert.equal(getScopeRiskColor("mcp"), "#f59e0b");

  assert.equal(getScopeRiskColor("write-out-cwd"), "#ef4444");
  assert.equal(getScopeRiskColor("delete-in-cwd"), "#ef4444");
  assert.equal(getScopeRiskColor("delete-out-cwd"), "#ef4444");
  assert.equal(getScopeRiskColor("mutate-git-log"), "#ef4444");
  assert.equal(getScopeRiskColor("unknown"), "#ef4444");
});

async function prompt(t: TestContext, requests: AskPermissionRequest[], planMode = false) {
  let frame = "";
  let canceled = false;
  const results: PermissionPromptResult[] = [];
  const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode() {}, ref() {}, unref() {} });
  const stdout = Object.assign(
    new Writable({
      write(chunk, _encoding, done) {
        const text = stripTerminalControls(chunk.toString());
        if (text.trim()) frame = text;
        done();
      },
    }),
    { isTTY: true, columns: 100, rows: 30 }
  );
  function Probe({ batch }: { batch: AskPermissionRequest[] }) {
    const [open, setOpen] = useState(true);
    return open
      ? React.createElement(PermissionPrompt, {
          requests: batch,
          planMode,
          onSubmit(result) {
            results.push(result);
            setOpen(false);
          },
          onCancel() {
            canceled = true;
            setOpen(false);
          },
        })
      : React.createElement(Text, null, "closed");
  }
  const app = render(React.createElement(Probe, { batch: requests }), {
    stdin: stdin as unknown as NodeJS.ReadStream,
    stdout: stdout as unknown as NodeJS.WriteStream,
    stderr: stdout as unknown as NodeJS.WriteStream,
    debug: true,
    patchConsole: false,
    exitOnCtrlC: false,
  });
  t.after(() => {
    app.unmount();
    app.cleanup();
  });
  async function flush() {
    await setTimeout(35);
    await app.waitUntilRenderFlush();
  }
  await flush();
  return {
    results,
    frame: () => frame,
    canceled: () => canceled,
    async replaceRequests(batch: AskPermissionRequest[]) {
      app.rerender(React.createElement(Probe, { batch }));
      await flush();
    },
    async send(key: string) {
      stdin.emit("data", key);
      await flush();
    },
  };
}

function request(id: string, scopes: AskPermissionRequest["scopes"]): AskPermissionRequest {
  return { toolCallId: id, name: "Bash", command: id, scopes };
}

test("permission diff appears above the question and follows the current request", async (t) => {
  const first: AskPermissionRequest = {
    ...request("first", ["write-in-cwd"]),
    name: "edit",
    diff: {
      filePath: "/workspace/example.py",
      details: {
        added: 1,
        removed: 1,
        lines: [
          { kind: "removed", content: "value = 1", lineNumber: 1 },
          { kind: "added", content: "value = 2", lineNumber: 1 },
        ],
      },
    },
  };
  const second: AskPermissionRequest = {
    ...request("second", ["write-in-cwd"]),
    name: "write",
    diff: {
      filePath: "/workspace/new.py",
      details: { added: 1, removed: 0, lines: [{ kind: "added", content: "created = True", lineNumber: 1 }] },
    },
  };
  const h = await prompt(t, [first, second, request("third", ["network"])]);
  assert.match(h.frame(), /example\.py.*\+1 -1/);
  assert.match(h.frame(), /- value = 1/);
  assert.match(h.frame(), /\+ value = 2/);
  assert.ok(h.frame().indexOf("value = 2") < h.frame().indexOf("Do you want to proceed?"));
  await h.send("1");
  assert.doesNotMatch(h.frame(), /value = /);
  assert.match(h.frame(), /\+ created = True/);
  await h.send("4");
  assert.doesNotMatch(h.frame(), /created = True|new\.py/);
  await h.send("1");
  assert.deepEqual(h.results[0].permissions, [
    { toolCallId: "first", permission: "allow" },
    { toolCallId: "second", permission: "deny" },
    { toolCallId: "third", permission: "allow" },
  ]);
});

for (const planMode of [false, true]) {
  test(`session option works in ${planMode ? "Plan" : "normal"} mode and skips repeated scopes`, async (t) => {
    const h = await prompt(t, [request("first", ["network"]), request("second", ["network"])], planMode);
    assert.match(h.frame(), /1\. Yes/);
    assert.match(h.frame(), /2\. Yes, during this session/);
    if (planMode) {
      assert.doesNotMatch(h.frame(), /always allow/);
      assert.match(h.frame(), /3\. No/);
    } else {
      assert.match(h.frame(), /3\. Yes, and always allow/);
      assert.match(h.frame(), /4\. No/);
    }
    await h.send("2");
    assert.deepEqual(h.results, [
      {
        permissions: [
          { toolCallId: "first", permission: "allow" },
          { toolCallId: "second", permission: "allow" },
        ],
        sessionAllows: ["network"],
        alwaysAllows: [],
      },
    ]);
  });
}

test("a mixed batch keeps a denial even when a later scope is allowed for the session", async (t) => {
  const h = await prompt(t, [
    request("first", ["network", "write-in-cwd"]),
    request("second", ["write-in-cwd", "read-out-cwd"]),
  ]);
  await h.send("4");
  await h.send("2");
  assert.equal(h.results.length, 0);
  assert.match(h.frame(), /second/);
  await h.send("1");
  assert.deepEqual(h.results, [
    {
      permissions: [
        { toolCallId: "first", permission: "deny" },
        { toolCallId: "second", permission: "allow" },
      ],
      sessionAllows: ["write-in-cwd"],
      alwaysAllows: [],
    },
  ]);
});

test("arrows and Enter select session authorization and cancellation discards an unfinished batch", async (t) => {
  const h = await prompt(t, [request("first", ["network", "write-in-cwd"])], true);
  await h.send("\u001b[B");
  await h.send("\r");
  assert.equal(h.results.length, 0);
  await h.send("\u001b");
  assert.equal(h.canceled(), true);
  assert.equal(h.results.length, 0);
});

test("unknown scopes offer only Yes and No, while permanent grants retain their own result field", async (t) => {
  const h = await prompt(t, [request("unknown", ["unknown"]), request("known", ["mcp"])]);
  assert.doesNotMatch(h.frame(), /during this session|always allow/);
  await h.send("3");
  assert.equal(h.results.length, 0);
  await h.send("2");
  await h.send("3");
  assert.deepEqual(h.results, [
    {
      permissions: [
        { toolCallId: "unknown", permission: "deny" },
        { toolCallId: "known", permission: "allow" },
      ],
      sessionAllows: [],
      alwaysAllows: ["mcp"],
    },
  ]);
});

test("replacing a pending batch discards its draft without submitting or carrying grants forward", async (t) => {
  const h = await prompt(t, [request("old", ["network", "write-in-cwd"])]);
  await h.send("2");
  await h.replaceRequests([request("new", ["network"])]);
  assert.equal(h.results.length, 0);
  assert.match(h.frame(), /new/);
  assert.match(h.frame(), /network access/);
  await h.send("1");
  assert.deepEqual(h.results, [
    { permissions: [{ toolCallId: "new", permission: "allow" }], alwaysAllows: [], sessionAllows: [] },
  ]);
});
