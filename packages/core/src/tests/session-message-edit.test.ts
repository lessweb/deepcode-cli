import assert from "node:assert/strict";
import { test } from "node:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { SessionManager, type SessionMessage } from "../session";
import { deleteSessionMessageHistory, editSessionMessageHistory } from "../session-message-edit";

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
function history(): SessionMessage[] {
  return [
    message("u", "user"),
    message("a", "assistant", {
      content: null,
      checkpointHash: "preserve",
      messageParams: {
        reasoning_content: "thinking",
        tool_calls: [
          { id: "c1", type: "function", function: { name: "bash", arguments: '{"command":"pwd"}' } },
          { id: "c2", type: "function", function: { name: "read", arguments: '{"path":"a"}' } },
        ],
      },
    }),
    message("r2", "tool", { content: "file", messageParams: { tool_call_id: "c2" } }),
    message("r1", "tool", { content: "directory", messageParams: { tool_call_id: "c1" } }),
    message("next", "user"),
  ];
}
function params(message: SessionMessage) {
  return message.messageParams as {
    reasoning_content?: string;
    tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
    tool_call_id?: string;
  };
}
function raw(message: SessionMessage) {
  return JSON.parse(JSON.stringify({ ...message, checkpointHash: undefined, html: undefined }));
}

test("content and thinking edits preserve user messages, source history, and checkpoints", () => {
  const original = history();
  const updated = editSessionMessageHistory(original, { messageId: "a" }, "Content", "answer");
  const empty = editSessionMessageHistory(updated, { messageId: "a" }, "Content", "");
  const thinking = editSessionMessageHistory(empty, { messageId: "a" }, "Thinking", "new thinking");
  assert.equal(original[1].content, null);
  assert.equal(updated[1].content, "answer");
  assert.equal(thinking[1].content, "");
  assert.equal(params(thinking[1]).reasoning_content, "new thinking");
  assert.equal(thinking[1].checkpointHash, "preserve");
  assert.deepEqual(thinking[0], original[0]);
  assert.throws(() => editSessionMessageHistory(original, { messageId: "u" }, "Raw", "{}"), /User messages/);
  assert.throws(
    () =>
      editSessionMessageHistory(
        [message("context", "user", { visible: false })],
        { messageId: "context" },
        "Content",
        "changed"
      ),
    /User messages/
  );
});

test("tool tabs update the paired result by call ID, including chat metadata", () => {
  const updated = editSessionMessageHistory(
    history(),
    { messageId: "a", toolCallIndex: 0 },
    "Parameters",
    '{"command":"ls"}'
  );
  assert.equal(params(updated[1]).tool_calls?.[0].function.arguments, '{"command":"ls"}');
  assert.deepEqual(updated[3].meta?.function, { name: "bash", arguments: '{"command":"ls"}' });
  const result = editSessionMessageHistory(updated, { messageId: "a", toolCallIndex: 0 }, "Result", "new directory");
  assert.equal(result[3].content, "new directory");
  assert.equal(result[2].content, "file");
  const withoutResult = history().filter((item) => item.id !== "r1");
  const created = editSessionMessageHistory(withoutResult, { messageId: "a", toolCallIndex: 0 }, "Result", "added");
  assert.equal(created[3].role, "tool");
  assert.equal(params(created[3]).tool_call_id, "c1");
  assert.equal(created[3].content, "added");
  assert.equal(created[4].id, "next");
});

test("Raw edits change content and nested call fields while rejecting structural changes", () => {
  const messages = history();
  const edited = raw(messages[1]);
  edited.content = "raw answer";
  edited.messageParams.reasoning_content = "raw thinking";
  edited.messageParams.tool_calls[0].function.arguments = "new arguments";
  const updated = editSessionMessageHistory(messages, { messageId: "a" }, "Raw", JSON.stringify(edited));
  assert.equal(updated[1].content, "raw answer");
  assert.equal(params(updated[1]).tool_calls?.[0].function.arguments, "new arguments");
  for (const field of ["id", "role", "createTime", "sessionId"]) {
    assert.throws(
      () =>
        editSessionMessageHistory(
          messages,
          { messageId: "a" },
          "Raw",
          JSON.stringify({ ...edited, [field]: "changed" })
        ),
      /unchanged/
    );
  }
  edited.messageParams.tool_calls[0].id = "changed";
  assert.throws(
    () => editSessionMessageHistory(messages, { messageId: "a" }, "Raw", JSON.stringify(edited)),
    /unchanged/
  );
  assert.throws(() => editSessionMessageHistory(messages, { messageId: "a" }, "Raw", "{"), SyntaxError);
  assert.throws(
    () =>
      editSessionMessageHistory(
        messages,
        { messageId: "a" },
        "Raw",
        JSON.stringify({ ...raw(messages[1]), content: 42 })
      ),
    /must be text/
  );
});

test("combined and unpaired tool Raw tabs save their actual source data", () => {
  const messages = history();
  const combined = { call: structuredClone(params(messages[1]).tool_calls![0]), result: raw(messages[3]) };
  combined.call.function.name = "renamed";
  combined.result.content = "raw result";
  const updated = editSessionMessageHistory(
    messages,
    { messageId: "a", toolCallIndex: 0 },
    "Raw",
    JSON.stringify(combined)
  );
  assert.equal(updated[3].content, "raw result");
  assert.equal(params(updated[1]).tool_calls?.[0].function.name, "renamed");
  const noResult = updated.filter((item) => item.id !== "r1");
  const call = structuredClone(params(noResult[1]).tool_calls![0]);
  call.function.arguments = "changed";
  assert.equal(
    params(editSessionMessageHistory(noResult, { messageId: "a", toolCallIndex: 0 }, "Raw", JSON.stringify(call))[1])
      .tool_calls?.[0].function.arguments,
    "changed"
  );
  const legacy = [message("old", "tool", { meta: { function: { name: "old", arguments: {} } } })];
  assert.equal(editSessionMessageHistory(legacy, { messageId: "old" }, "Result", "legacy")[0].content, "legacy");
  assert.doesNotThrow(() =>
    editSessionMessageHistory(legacy, { messageId: "old" }, "Raw", JSON.stringify(raw(legacy[0])))
  );
});

test("deletion removes only the selected message and its associated calls/results", () => {
  const original = history();
  const single = deleteSessionMessageHistory(original, { messageId: "a", toolCallIndex: 0 });
  assert.deepEqual(
    single.map((item) => item.id),
    ["u", "a", "r2", "next"]
  );
  assert.deepEqual(
    params(single[1]).tool_calls?.map((call) => call.id),
    ["c2"]
  );
  const last = deleteSessionMessageHistory(single, { messageId: "a", toolCallIndex: 0 });
  assert.equal(params(last[1]).tool_calls, undefined);
  assert.deepEqual(
    deleteSessionMessageHistory(original, { messageId: "a" }).map((item) => item.id),
    ["u", "next"]
  );
  assert.deepEqual(
    deleteSessionMessageHistory(original, { messageId: "u" }).map((item) => item.id),
    ["a", "r2", "r1", "next"]
  );
  assert.equal(original.length, 5);
});

test("SessionManager persists changes, refreshes summaries, and rejects operations while running", (t) => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "trajectory-edit-"));
  t.after(() => fs.rmSync(projectDir, { recursive: true, force: true }));
  const sessionsIndexPath = path.join(projectDir, "sessions-index.json");
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
    return manager;
  };
  fs.writeFileSync(
    sessionsIndexPath,
    JSON.stringify({
      version: 1,
      entries: [
        {
          id: "s1",
          summary: "test",
          status: "completed",
          createTime: "2026-11-12T00:00:00Z",
          updateTime: "2026-11-12T00:00:00Z",
        },
      ],
    })
  );
  const messagePath = path.join(projectDir, "s1.jsonl");
  fs.writeFileSync(
    messagePath,
    history()
      .map((item) => JSON.stringify(item))
      .join("\n") + "\n"
  );
  const manager = makeManager();
  manager.editSessionMessage("s1", { messageId: "a" }, "Content", "persisted");
  const reloaded = makeManager();
  assert.equal(reloaded.listSessionMessages("s1")[1].content, "persisted");
  assert.equal(reloaded.getSession("s1")?.assistantReply, "persisted");
  const saved = fs.readFileSync(messagePath, "utf8");
  assert.throws(() => manager.editSessionMessage("s1", { messageId: "a" }, "Raw", "{"));
  assert.equal(fs.readFileSync(messagePath, "utf8"), saved);
  t.mock.method(manager, "isSessionRunning", () => true);
  assert.throws(() => manager.editSessionMessage("s1", { messageId: "a" }, "Content", "bad"), /Wait/);
  assert.throws(() => manager.deleteSessionMessage("s1", { messageId: "a" }), /Wait/);
  reloaded.deleteSessionMessage("s1", { messageId: "a" });
  assert.deepEqual(
    makeManager()
      .listSessionMessages("s1")
      .map((item) => item.id),
    ["u", "next"]
  );
  assert.equal(makeManager().getSession("s1")?.assistantReply, null);
});

test("saving a Raw tab draft after another tab does not introduce version conflicts", () => {
  const original = history();
  const draft = raw(original[1]);
  draft.content = "raw draft";
  const updated = editSessionMessageHistory(original, { messageId: "a" }, "Thinking", "saved thinking");
  const saved = editSessionMessageHistory(updated, { messageId: "a" }, "Raw", JSON.stringify(draft));
  assert.equal(saved[1].content, "raw draft");
  assert.equal(params(saved[1]).reasoning_content, "thinking");
});

test("tool Raw drafts can be saved after Parameters without metadata conflicts", () => {
  const original = editSessionMessageHistory(history(), { messageId: "a", toolCallIndex: 0 }, "Parameters", "old");
  const draft = { call: structuredClone(params(original[1]).tool_calls![0]), result: raw(original[3]) };
  draft.result.content = "raw result draft";
  const updated = editSessionMessageHistory(original, { messageId: "a", toolCallIndex: 0 }, "Parameters", "new");
  const saved = editSessionMessageHistory(updated, { messageId: "a", toolCallIndex: 0 }, "Raw", JSON.stringify(draft));
  assert.equal(saved[3].content, "raw result draft");
  assert.equal(params(saved[1]).tool_calls?.[0].function.arguments, "old");
});
