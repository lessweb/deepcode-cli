import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { SessionManager, type SessionEntry, type SessionMessage } from "../session";
import { reconcileSessionWaitState } from "../session-wait-state";
import { clearSessionState, getSnippet, rebuildSessionStateFromHistory } from "../common/state";

const call = (id: string) => ({
  id,
  type: "function",
  function: { name: "WebSearch", arguments: '{"query":"weather"}' },
});
const request = (id: string) => ({
  toolCallId: id,
  name: "WebSearch",
  command: "weather",
  description: undefined,
  scopes: ["network" as const],
});
function message(id: string, role: SessionMessage["role"], extra: Partial<SessionMessage> = {}): SessionMessage {
  return {
    id,
    sessionId: "s1",
    role,
    content: id,
    contentParams: null,
    messageParams: null,
    compacted: false,
    visible: true,
    createTime: "2026-11-12T00:00:00Z",
    updateTime: "2026-11-12T00:00:00Z",
    ...extra,
  };
}
const assistant = () => message("a", "assistant", { messageParams: { tool_calls: [call("c1"), call("c2")] } });
const question = (id = "c1") =>
  message(`result-${id}`, "tool", {
    messageParams: { tool_call_id: id },
    content: JSON.stringify({
      ok: true,
      awaitUserResponse: true,
      metadata: { kind: "ask_user_question", questions: [] },
    }),
  });
function entry(status: SessionEntry["status"]): SessionEntry {
  return {
    id: "s1",
    summary: "test",
    status,
    failReason: status === "permission_denied" ? "Permission denied by user" : null,
    askPermissions:
      status === "ask_permission" || status === "permission_denied" ? [request("c1"), request("c2")] : undefined,
    createTime: "2026-11-12T00:00:00Z",
    updateTime: "2026-11-12T00:00:00Z",
  } as SessionEntry;
}

for (const status of ["ask_permission", "permission_denied"] as const) {
  test(`${status}: keep live permission requests and remove deleted or completed calls`, () => {
    const original = entry(status);
    const kept = reconcileSessionWaitState(original, [assistant()]);
    assert.equal(kept.status, status);
    assert.deepEqual(kept.askPermissions, original.askPermissions);
    const partial = reconcileSessionWaitState(original, [
      assistant(),
      message("r1", "tool", { messageParams: { tool_call_id: "c1" } }),
    ]);
    assert.deepEqual(partial.askPermissions, [request("c2")]);
    assert.equal(partial.status, status);
    const removed = reconcileSessionWaitState(original, [message("a", "assistant")]);
    assert.equal(removed.status, "completed");
    assert.equal(removed.failReason, null);
    assert.equal(removed.askPermissions, undefined);
  });
}

test("question waits survive unrelated edits and hidden context but end after answers or removal", () => {
  const messages = [assistant(), question(), message("context", "user", { meta: { isToolFollowUp: true } })];
  assert.equal(reconcileSessionWaitState(entry("waiting_for_user"), messages).status, "waiting_for_user");
  for (const suffix of [
    message("answer", "user", { meta: { isAnswers: true } }),
    message("reply", "user"),
    message("next", "assistant"),
  ]) {
    assert.equal(reconcileSessionWaitState(entry("waiting_for_user"), [...messages, suffix]).status, "completed");
  }
  assert.equal(reconcileSessionWaitState(entry("waiting_for_user"), [assistant()]).status, "completed");
  assert.equal(
    reconcileSessionWaitState(entry("waiting_for_user"), [message("a", "assistant"), question()]).status,
    "completed"
  );
  assert.equal(
    reconcileSessionWaitState(entry("waiting_for_user"), [assistant(), question("orphan")]).status,
    "completed"
  );
});

test("compacted waits do not block and unrelated interrupted/failed states are preserved", () => {
  assert.equal(
    reconcileSessionWaitState(
      entry("waiting_for_user"),
      [assistant(), question()].map((m) => ({ ...m, compacted: true }))
    ).status,
    "completed"
  );
  for (const status of ["interrupted", "failed"] as const) {
    const original = { ...entry(status), failReason: "keep this cause" };
    const state = reconcileSessionWaitState(original, []);
    assert.equal(state.status, status);
    assert.equal(state.failReason, original.failReason);
  }
});

function fixture(t: TestContext, initial: SessionEntry, messages: SessionMessage[]) {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "session-wait-"));
  t.after(() => fs.rmSync(projectDir, { recursive: true, force: true }));
  const sessionsIndexPath = path.join(projectDir, "sessions-index.json");
  fs.writeFileSync(sessionsIndexPath, JSON.stringify({ version: 1, entries: [initial] }));
  fs.writeFileSync(path.join(projectDir, "s1.jsonl"), messages.map((m) => JSON.stringify(m)).join("\n") + "\n");
  const makeManager = () => {
    const manager = new SessionManager({
      projectRoot: projectDir,
      createOpenAIClient: () => ({ client: null, model: "test", thinkingEnabled: false }),
      getResolvedSettings: () => ({ model: "test" }),
      renderMarkdown: (text) => text,
      onAssistantMessage: () => {},
    });
    const storage = manager as unknown as {
      getProjectStorage(): { projectCode: string; projectDir: string; sessionsIndexPath: string };
    };
    t.mock.method(storage, "getProjectStorage", () => ({ projectCode: "test", projectDir, sessionsIndexPath }));
    manager.setActiveSessionId("s1");
    return manager;
  };
  return { manager: makeManager(), makeManager };
}

for (const status of ["permission_denied", "ask_permission"] as const) {
  test(`save retains valid ${status}; deleting the last blocked call allows continuation`, async (t) => {
    const { manager, makeManager } = fixture(t, entry(status), [assistant()]);
    manager.editSessionMessage("s1", { messageId: "a" }, "Thinking", "edited reasoning");
    assert.equal(makeManager().getSession("s1")?.status, status);
    await assert.rejects(
      manager.replySession("s1", { text: "/continue" }),
      status === "permission_denied" ? /Permission was denied/ : /Respond to the permission request/
    );
    manager.deleteSessionMessage("s1", { messageId: "a", toolCallIndex: 0 });
    assert.deepEqual(manager.getSession("s1")?.askPermissions, [request("c2")]);
    manager.deleteSessionMessage("s1", { messageId: "a", toolCallIndex: 0 });
    assert.equal(makeManager().getSession("s1")?.status, "completed");
    assert.equal(manager.getSession("s1")?.askPermissions, undefined);
    assert.equal(manager.getSession("s1")?.failReason, null);
    assert.equal(manager.getQueuePausedReason("s1"), undefined);
    let continued = false;
    t.mock.method(manager, "activateSession", async () => {
      continued = true;
    });
    await manager.replySession("s1", { text: "/continue" });
    assert.ok(continued);
  });
}

test("saving an already edited history clears orphaned denial state", (t) => {
  const { manager } = fixture(t, entry("permission_denied"), [message("a", "assistant")]);
  manager.editSessionMessage("s1", { messageId: "a" }, "Content", "");
  assert.equal(manager.getSession("s1")?.status, "completed");
  assert.equal(manager.getSession("s1")?.askPermissions, undefined);
});

test("question wait persists until its result no longer requests an answer", async (t) => {
  const { manager, makeManager } = fixture(t, entry("waiting_for_user"), [assistant(), question()]);
  manager.editSessionMessage("s1", { messageId: "a" }, "Content", "updated");
  assert.equal(makeManager().getSession("s1")?.status, "waiting_for_user");
  await assert.rejects(manager.replySession("s1", { text: "/continue" }), /Answer the pending question/);
  manager.editSessionMessage(
    "s1",
    { messageId: "a", toolCallIndex: 0 },
    "Result",
    JSON.stringify({ ok: true, awaitUserResponse: false })
  );
  assert.equal(makeManager().getSession("s1")?.status, "completed");
});

test("deleting one pending question retains the other; deleting the assistant clears the wait", (t) => {
  const { manager } = fixture(t, entry("waiting_for_user"), [assistant(), question(), question("c2")]);
  manager.deleteSessionMessage("s1", { messageId: "a", toolCallIndex: 0 });
  assert.equal(manager.getSession("s1")?.status, "waiting_for_user");
  manager.deleteSessionMessage("s1", { messageId: "a" });
  assert.equal(manager.getSession("s1")?.status, "completed");
});

test("explicit permission replies still enter the existing continuation flow", async (t) => {
  const { manager } = fixture(t, entry("permission_denied"), [assistant()]);
  let continued = false;
  t.mock.method(manager, "activateSession", async () => {
    continued = true;
  });
  await manager.replySession("s1", {
    text: "/continue",
    permissions: [
      { toolCallId: "c1", permission: "deny" },
      { toolCallId: "c2", permission: "deny" },
    ],
  });
  assert.ok(continued);
});

test("editing history preserves an explicit runtime interruption", (t) => {
  const { manager } = fixture(t, entry("permission_denied"), [assistant()]);
  manager.interruptSession("s1");
  manager.deleteSessionMessage("s1", { messageId: "a" });
  assert.equal(manager.getSession("s1")?.status, "interrupted");
  assert.equal(manager.getSession("s1")?.failReason, "interrupted");
  assert.equal(manager.getQueuePausedReason("s1"), "interrupted");
});

test("restoring history resets permission waits even when earlier calls remain unanswered", (t) => {
  const lastAssistant = assistant();
  lastAssistant.messageParams = { ...(lastAssistant.messageParams as object), reasoning_content: "saved thinking" };
  const { manager, makeManager } = fixture(t, entry("permission_denied"), [
    lastAssistant,
    message("target", "user"),
    message("later", "assistant"),
  ]);
  manager.restoreSessionConversation("s1", "target");
  const restored = makeManager().getSession("s1");
  assert.equal(restored?.assistantReply, lastAssistant.content);
  assert.equal(restored?.assistantThinking, "saved thinking");
  assert.equal(restored?.status, "completed");
  assert.equal(restored?.failReason, null);
  assert.equal(restored?.askPermissions, undefined);
  assert.equal(restored?.toolCalls, null);
  assert.equal(manager.getQueuePausedReason("s1"), undefined);
});

test("restoring history rebuilds file references without retaining discarded snippets", (t) => {
  t.after(() => clearSessionState("s1"));
  const readResult = (id: string) =>
    message(id, "tool", {
      content: JSON.stringify({
        ok: true,
        name: "read",
        output: id,
        metadata: { snippet: { id, filePath: path.join(os.tmpdir(), `${id}.txt`), startLine: 1, endLine: 1 } },
      }),
    });
  const messages = [readResult("snippet_1"), message("target", "user"), readResult("snippet_2")];
  const { manager } = fixture(t, entry("completed"), messages);
  rebuildSessionStateFromHistory("s1", messages);
  assert.ok(getSnippet("s1", "snippet_2"));
  manager.restoreSessionConversation("s1", "target");
  assert.ok(getSnippet("s1", "snippet_1"));
  assert.equal(getSnippet("s1", "snippet_2"), null);
});
