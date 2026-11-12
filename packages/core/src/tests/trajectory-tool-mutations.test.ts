import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type OpenAI from "openai";
import { SessionManager, type SessionMessage, type SessionStatus } from "../session";
import { recordFileState } from "../common/state";
import { readTextFileWithMetadata } from "../common/file-utils";
import { computeToolCallPermissions, type PermissionToolCall } from "../common/permissions";

function recordFullReads(files: string[]) {
  for (const filePath of files) recordFileState("s1", { filePath, ...readTextFileWithMetadata(filePath) });
}

const writeCall = (id: string, file: string, content = "new content"): PermissionToolCall => ({
  id,
  type: "function",
  function: { name: "Write", arguments: JSON.stringify({ file_path: file, content }) },
});
function fixture(t: TestContext, count = 1, defaultMode: "askAll" | "allowAll" = "askAll") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "trajectory-tools-"));
  const files = [path.join(root, "a.txt"), path.join(root, "b.txt")];
  fs.writeFileSync(files[0], "original A");
  fs.writeFileSync(files[1], "original B");
  const projectDir = path.join(root, "storage");
  fs.mkdirSync(projectDir);
  const sessionsIndexPath = path.join(projectDir, "sessions-index.json");
  const calls = files.slice(0, count).map((file, i) => writeCall(`c${i + 1}`, file));
  const settings = { allow: [], deny: [], ask: [], defaultMode, addWorkingDirs: [] };
  const plan = computeToolCallPermissions({ sessionId: "s1", projectRoot: root, toolCalls: calls, settings });
  const assistant: SessionMessage = {
    id: "a",
    sessionId: "s1",
    role: "assistant",
    content: "",
    contentParams: null,
    messageParams: { tool_calls: calls },
    meta: { permissions: plan.permissions },
    visible: true,
    compacted: false,
    createTime: "2026-11-12T00:00:00Z",
    updateTime: "2026-11-12T00:00:00Z",
  };
  fs.writeFileSync(path.join(projectDir, "s1.jsonl"), JSON.stringify(assistant) + "\n");
  fs.writeFileSync(
    sessionsIndexPath,
    JSON.stringify({
      version: 1,
      entries: [
        {
          id: "s1",
          summary: "test",
          status: plan.askPermissions.length ? "ask_permission" : "completed",
          askPermissions: plan.askPermissions,
          toolCalls: calls,
          createTime: assistant.createTime,
          updateTime: assistant.updateTime,
        },
      ],
    })
  );
  let completions = 0;
  const seenAtCompletion: SessionMessage[][] = [];
  const manager = new SessionManager({
    projectRoot: root,
    createOpenAIClient: () => ({ client: {} as OpenAI, model: "test", thinkingEnabled: false }),
    getResolvedSettings: () => ({
      model: "test",
      permissions: settings,
      history: { persistence: "none", maxBytes: 0 },
    }),
    renderMarkdown: (text) => text,
    onAssistantMessage: () => {},
  });
  const internal = manager as unknown as {
    getProjectStorage(): { projectCode: string; projectDir: string; sessionsIndexPath: string };
    requestSessionCompletion(): Promise<unknown>;
    prepareFileMutationCheckpoint(): void;
    recordFileMutationCheckpoint(): void;
    updateSessionEntry(id: string, update: (entry: { status: SessionStatus }) => unknown): void;
  };
  t.mock.method(internal, "getProjectStorage", () => ({ projectCode: "test", projectDir, sessionsIndexPath }));
  t.mock.method(internal, "requestSessionCompletion", async () => {
    completions++;
    seenAtCompletion.push(manager.listSessionMessages("s1"));
    return { choices: [{ message: { content: "done" } }] };
  });
  t.mock.method(internal, "prepareFileMutationCheckpoint", () => {});
  t.mock.method(internal, "recordFileMutationCheckpoint", () => {});
  manager.setActiveSessionId("s1");
  t.after(() => {
    manager.dispose();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { manager, root, files, calls, settings, seenAtCompletion, completions: () => completions, internal };
}

for (const tab of ["Parameters", "Raw"] as const) {
  test(`${tab}: editing pending Write replaces permission target, preview and one-shot authorization`, async (t) => {
    const { manager, files } = fixture(t);
    const args = JSON.stringify({ file_path: files[1], content: "changed B" });
    const text =
      tab === "Raw"
        ? JSON.stringify({ ...writeCall("c1", files[0]), function: { name: "Write", arguments: args } })
        : args;
    manager.editSessionMessage("s1", { messageId: "a", toolCallIndex: 0 }, tab, text);
    const request = manager.getSession("s1")!.askPermissions![0];
    assert.notEqual(request.toolCallId, "c1");
    assert.ok(request.command.includes(files[1]));
    assert.ok(!request.command.includes(files[0]));
    assert.equal(request.diff?.filePath, files[1]);
    assert.match(JSON.stringify(request.diff?.details), /original B/);
    assert.match(JSON.stringify(request.diff?.details), /changed B/);
    assert.deepEqual(manager.listSessionMessages("s1")[0].meta?.permissions, [
      { toolCallId: request.toolCallId, permission: "ask" },
    ]);
    await assert.rejects(
      manager.replySession("s1", { text: "/continue", permissions: [{ toolCallId: "c1", permission: "allow" }] }),
      /request has changed/
    );
    assert.equal(fs.readFileSync(files[1], "utf8"), "original B");
    recordFullReads(files);
    await manager.replySession("s1", {
      text: "/continue",
      permissions: [{ toolCallId: request.toolCallId, permission: "allow" }],
    });
    assert.equal(fs.readFileSync(files[0], "utf8"), "original A");
    assert.equal(fs.readFileSync(files[1], "utf8"), "changed B");
    assert.equal(manager.getSession("s1")?.status, "completed");
  });
}

test("assistant Raw edits also invalidate old allows and recalculate permission scopes", async (t) => {
  const { manager, files, settings } = fixture(t, 1, "allowAll");
  settings.defaultMode = "askAll";
  const raw = manager.listSessionMessages("s1")[0];
  (raw.messageParams as { tool_calls: PermissionToolCall[] }).tool_calls[0].function = {
    name: "Read",
    arguments: JSON.stringify({ file_path: files[1] }),
  };
  manager.editSessionMessage("s1", { messageId: "a" }, "Raw", JSON.stringify(raw));
  const request = manager.getSession("s1")!.askPermissions![0];
  assert.equal(request.name, "Read");
  assert.deepEqual(request.scopes, ["read-in-cwd"]);
  assert.notEqual(request.toolCallId, "c1");
  assert.equal(manager.listSessionMessages("s1")[0].meta?.permissions?.[0].permission, "ask");
  await assert.rejects(manager.replySession("s1", { text: "/continue" }), /Respond to the permission request/);
});

test("unchanged calls retain identity and editing completed calls never reruns them", async (t) => {
  const { manager, files } = fixture(t);
  manager.editSessionMessage("s1", { messageId: "a" }, "Content", "comment");
  assert.equal(manager.getSession("s1")?.askPermissions?.[0].toolCallId, "c1");
  manager.editSessionMessage("s1", { messageId: "a", toolCallIndex: 0 }, "Result", "manual result");
  manager.editSessionMessage(
    "s1",
    { messageId: "a", toolCallIndex: 0 },
    "Parameters",
    JSON.stringify({ file_path: files[1], content: "must not run" })
  );
  recordFullReads(files);
  await manager.replySession("s1", { text: "/continue" });
  assert.equal(fs.readFileSync(files[1], "utf8"), "original B");
});

test("a manually completed first call does not skip the second call after approval", async (t) => {
  const { manager, files, seenAtCompletion, completions } = fixture(t, 2);
  manager.editSessionMessage("s1", { messageId: "a", toolCallIndex: 0 }, "Result", "manual first result");
  assert.deepEqual(
    manager.getSession("s1")?.askPermissions?.map((r) => r.toolCallId),
    ["c2"]
  );
  recordFullReads(files);
  await manager.replySession("s1", { text: "/continue", permissions: [{ toolCallId: "c2", permission: "allow" }] });
  assert.equal(fs.readFileSync(files[0], "utf8"), "original A");
  assert.equal(fs.readFileSync(files[1], "utf8"), "new content");
  assert.equal(completions(), 1);
  const results = seenAtCompletion[0].filter((m) => m.role === "tool");
  assert.deepEqual(
    results.map((m) => (m.messageParams as { tool_call_id: string }).tool_call_id),
    ["c1", "c2"]
  );
  assert.equal(results[0].content, "manual first result");
  assert.equal(manager.getSession("s1")?.status, "completed");
});

test("continuing a partially completed allowed batch executes only the missing result", async (t) => {
  const { manager, files } = fixture(t, 2, "allowAll");
  manager.editSessionMessage("s1", { messageId: "a", toolCallIndex: 1 }, "Result", "manual second result");
  recordFullReads(files);
  await manager.replySession("s1", { text: "/continue" });
  assert.equal(fs.readFileSync(files[0], "utf8"), "new content");
  assert.equal(fs.readFileSync(files[1], "utf8"), "original B");
  const results = manager.listSessionMessages("s1").filter((m) => m.role === "tool");
  assert.equal(results.length, 2);
});

test("answer still required after completing other tools in a batch", async (t) => {
  const { manager, files, completions } = fixture(t, 2);
  manager.editSessionMessage(
    "s1",
    { messageId: "a", toolCallIndex: 0 },
    "Result",
    JSON.stringify({ ok: true, awaitUserResponse: true })
  );
  recordFullReads(files);
  await manager.replySession("s1", { text: "/continue", permissions: [{ toolCallId: "c2", permission: "allow" }] });
  assert.equal(manager.getSession("s1")?.status, "waiting_for_user");
  assert.equal(completions(), 0);
});

test("editing a pending call preserves completed calls and their permission metadata", async (t) => {
  const { manager, files } = fixture(t, 2);
  manager.editSessionMessage("s1", { messageId: "a", toolCallIndex: 0 }, "Result", "manual first result");
  manager.editSessionMessage(
    "s1",
    { messageId: "a", toolCallIndex: 1 },
    "Parameters",
    JSON.stringify({ file_path: files[1], content: "edited B" })
  );
  const request = manager.getSession("s1")!.askPermissions![0];
  assert.notEqual(request.toolCallId, "c2");
  assert.deepEqual(manager.listSessionMessages("s1")[0].meta?.permissions, [
    { toolCallId: "c1", permission: "ask" },
    { toolCallId: request.toolCallId, permission: "ask" },
  ]);
  await assert.rejects(
    manager.replySession("s1", { text: "/continue", permissions: [{ toolCallId: "c2", permission: "allow" }] }),
    /request has changed/
  );
  recordFullReads(files);
  await manager.replySession("s1", {
    text: "/continue",
    permissions: [{ toolCallId: request.toolCallId, permission: "allow" }],
  });
  assert.equal(fs.readFileSync(files[0], "utf8"), "original A");
  assert.equal(fs.readFileSync(files[1], "utf8"), "edited B");
  const results = manager.listSessionMessages("s1").filter((message) => message.role === "tool");
  assert.equal(results.length, 2);
  assert.equal(results[0].content, "manual first result");
});

test("a partially approved batch waits for unanswered requests before executing any calls", async (t) => {
  const { manager, files, completions } = fixture(t, 2);
  await manager.replySession("s1", { text: "/continue", permissions: [{ toolCallId: "c1", permission: "allow" }] });
  assert.equal(manager.getSession("s1")?.status, "ask_permission");
  assert.deepEqual(
    manager.getSession("s1")?.askPermissions?.map((request) => request.toolCallId),
    ["c2"]
  );
  assert.equal(completions(), 0);
  assert.equal(fs.readFileSync(files[0], "utf8"), "original A");
  assert.equal(fs.readFileSync(files[1], "utf8"), "original B");
  recordFullReads(files);
  await manager.replySession("s1", {
    text: "/continue",
    permissions: [
      { toolCallId: "c1", permission: "allow" },
      { toolCallId: "c2", permission: "allow" },
    ],
  });
  assert.equal(manager.getSession("s1")?.status, "completed");
  assert.equal(fs.readFileSync(files[0], "utf8"), "new content");
  assert.equal(fs.readFileSync(files[1], "utf8"), "new content");
});
