import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import React from "react";
import { getProjectCode, SessionManager } from "@vegamo/deepcode-core";
import App from "../ui/views/App";
import { isolateSshEnvironment } from "./clipboard-test-helpers";
import { terminal } from "./terminal-helper";

for (const ssh of [false, true]) {
  test(`resuming over ${ssh ? "SSH" : "a local terminal"} limits replay and preserves prompt recall`, async (t) => {
    isolateSshEnvironment(t);
    if (ssh) process.env.SSH_CONNECTION = "test";
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "deepcode-session-replay-"));
    t.mock.method(os, "homedir", () => root);
    syncBuiltinESMExports();
    const projectDir = path.join(root, ".deepcode", "projects", getProjectCode(root));
    fs.mkdirSync(projectDir, { recursive: true });
    const entry = { id: "saved", summary: "Saved conversation", status: ssh ? "waiting_for_user" : "completed" };
    fs.writeFileSync(path.join(projectDir, "sessions-index.json"), JSON.stringify({ version: 1, entries: [entry] }));
    const filename = path.join(projectDir, "saved.jsonl");
    function append(role: string, content: string, visible = true) {
      fs.appendFileSync(
        filename,
        JSON.stringify({ id: crypto.randomUUID(), sessionId: entry.id, role, content, visible }) + "\n"
      );
    }
    const padding = "x".repeat(1024 * 1024);
    append("user", "old prompt outside both windows");
    for (let i = 0; i < 46; i++) append("system", padding, false);
    append("assistant", "middle reply outside the SSH window");
    if (ssh)
      append(
        "tool",
        JSON.stringify({
          awaitUserResponse: true,
          metadata: {
            kind: "ask_user_question",
            questions: [{ question: "Which option?", options: [{ label: "First" }] }],
          },
        })
      );
    for (let i = 0; i < 6; i++) append("system", padding, false);
    append("assistant", "latest reply in both windows");
    t.mock.method(SessionManager.prototype, "initMcpServers", async () => {});
    const h = await terminal(
      t,
      React.createElement(App, { projectRoot: root, resumeSessionId: ssh ? true : entry.id }),
      100,
      { rows: 40 }
    );
    t.after(() => {
      t.mock.restoreAll();
      syncBuiltinESMExports();
      fs.rmSync(root, { recursive: true, force: true });
    });
    if (ssh) await h.send("\r");
    await h.send("");
    const transcript = () => {
      const buffer = h.screen!.buffer.active;
      return Array.from({ length: buffer.length }, (_, y) => buffer.getLine(y)?.translateToString(true)).join("\n");
    };
    assert.match(transcript(), /latest reply in both windows/);
    assert.equal(transcript().includes("middle reply outside the SSH window"), !ssh);
    assert.doesNotMatch(transcript(), /old prompt outside both windows/);
    await h.resize(90, 40);
    assert.match(transcript(), /latest reply in both windows/);
    assert.equal(transcript().includes("middle reply outside the SSH window"), !ssh);
    assert.doesNotMatch(transcript(), /old prompt outside both windows/);
    if (ssh) {
      assert.match(transcript(), /Which option\?/);
      await h.send("\x1b");
    }
    await h.send("\x1b[A");
    assert.match(transcript(), /old prompt outside both windows/);
  });
}
