import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PromptQueue } from "../prompt-queue";
import { SessionManager, type SessionMessage } from "../session";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const completion = () => ({ choices: [{ message: { content: "done" } }] });

async function fixture(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deepcode-queue-"));
  const committed: SessionMessage[] = [];
  const manager = new SessionManager({
    projectRoot: root,
    createOpenAIClient: () => ({ client: {} as any, model: "test", thinkingEnabled: false }),
    getResolvedSettings: () => ({ model: "test", history: { persistence: "none", maxBytes: 0 } }),
    renderMarkdown: (text) => text,
    onAssistantMessage: () => {},
    onUserMessage: (message) => committed.push(message),
  });
  const internal = manager as any;
  internal.getProjectStorage = () => ({
    projectCode: "test",
    projectDir: path.join(root, "storage"),
    sessionsIndexPath: path.join(root, "storage", "sessions-index.json"),
  });
  internal.maybeGenerateSessionTitle = () => {};
  internal.reportNewPrompt = () => {};
  manager.listSkills = async () => [];
  internal.requestSessionCompletion = async () => completion();
  t.after(() => {
    manager.dispose();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const id = await manager.createSession({ text: "first" });
  return { manager, id, internal, committed };
}

test("queue edits are FIFO barriers, retain identity and timestamp, and never include permission grants", () => {
  const queue = new PromptQueue("s");
  const first = queue.enqueue({ text: "first", sessionAllows: ["write-in-cwd"] } as any);
  const second = queue.enqueue({ text: "second", imageUrls: ["file:///image.png"] });
  queue.enqueue({ text: "third" });
  assert.equal((first.content as any).sessionAllows, undefined);
  assert.ok(queue.beginEdit(second.id));
  assert.deepEqual(
    queue.executable().map((message) => message.id),
    [first.id]
  );
  queue.remove(first.id);
  assert.equal(queue.executable().length, 0);
  queue.finishEdit(second.id, { text: "changed", imageUrls: second.content.imageUrls });
  assert.equal(queue.list()[0].id, second.id);
  assert.equal(queue.list()[0].submittedAt, second.submittedAt);
  assert.equal(queue.list()[0].content.text, "changed");
  queue.beginEdit(second.id);
  queue.finishEdit(second.id);
  assert.deepEqual(
    queue.executable().map((message) => message.content.text),
    ["changed", "third"]
  );
});

test("busy inputs stay out of history and are consumed together in FIFO order with their original IDs", async (t) => {
  const { manager, id, internal } = await fixture(t);
  const entered = deferred();
  const release = deferred();
  const requests: string[][] = [];
  internal.requestSessionCompletion = async () => {
    requests.push(
      manager
        .listSessionMessages(id)
        .filter((m) => m.role === "user")
        .map((m) => m.content ?? "")
    );
    if (requests.length === 1) {
      entered.resolve();
      await release.promise;
    }
    return completion();
  };
  const run = manager.replySession(id, { text: "running" });
  await entered.promise;
  const a = manager.enqueuePrompt(id, { text: "a" });
  const b = manager.enqueuePrompt(id, { text: "b" });
  assert.equal(
    manager.listSessionMessages(id).some((message) => message.id === a.id),
    false
  );
  release.resolve();
  await run;
  assert.deepEqual(requests, [
    ["first", "running"],
    ["first", "running", "a", "b"],
  ]);
  const messages = manager.listSessionMessages(id);
  assert.equal(messages.find((message) => message.id === a.id)?.createTime, a.submittedAt);
  assert.equal(messages.filter((message) => message.id === b.id).length, 1);
  assert.deepEqual(manager.listQueuedMessages(id), []);
});

test("editing blocks the suffix and finishing an edit wakes an idle session", async (t) => {
  const { manager, id, internal } = await fixture(t);
  manager.setActiveSessionId(null);
  const a = manager.enqueuePrompt(id, { text: "a" });
  const b = manager.enqueuePrompt(id, { text: "b" });
  manager.enqueuePrompt(id, { text: "c" });
  manager.beginQueuedMessageEdit(id, b.id);
  let calls = 0;
  internal.requestSessionCompletion = async () => {
    calls++;
    return completion();
  };
  manager.setActiveSessionId(id);
  await manager.waitForSessionIdle(id);
  assert.equal(calls, 1);
  assert.equal(manager.listSessionMessages(id).filter((m) => m.id === a.id).length, 1);
  assert.deepEqual(
    manager.listQueuedMessages(id).map((m) => m.content.text),
    ["b", "c"]
  );
  manager.finishQueuedMessageEdit(id, b.id, { text: "edited", planMode: true });
  await manager.waitForSessionIdle(id);
  assert.equal(calls, 2);
  assert.deepEqual(manager.listQueuedMessages(id), []);
  assert.equal(manager.listSessionMessages(id).find((m) => m.id === b.id)?.content, "edited");
});

test("editing during asynchronous preparation prevents committing the old content", async (t) => {
  const { manager, id, internal } = await fixture(t);
  const entered = deferred();
  const release = deferred();
  internal.normalizeSkills = async () => {
    entered.resolve();
    await release.promise;
    return [];
  };
  const queued = manager.enqueuePrompt(id, { text: "old" });
  await entered.promise;
  assert.equal(manager.getPreparingPromptId(id), queued.id);
  manager.beginQueuedMessageEdit(id, queued.id);
  assert.equal(manager.getPreparingPromptId(id), undefined);
  release.resolve();
  await manager.waitForSessionIdle(id);
  assert.equal(
    manager.listSessionMessages(id).some((m) => m.id === queued.id),
    false
  );
  manager.finishQueuedMessageEdit(id, queued.id, { text: "new" });
  await manager.waitForSessionIdle(id);
  assert.equal(manager.listSessionMessages(id).find((m) => m.id === queued.id)?.content, "new");
});

test("interrupt retains the execution lock until cleanup and a new input resumes afterward", async (t) => {
  const { manager, id, internal } = await fixture(t);
  const entered = deferred();
  const release = deferred();
  let active = 0;
  let maxActive = 0;
  let calls = 0;
  internal.requestSessionCompletion = async () => {
    active++;
    maxActive = Math.max(maxActive, active);
    if (++calls === 1) {
      entered.resolve();
      await release.promise;
    }
    active--;
    return completion();
  };
  const run = manager.replySession(id, { text: "running" });
  await entered.promise;
  manager.enqueuePrompt(id, { text: "waiting" });
  manager.interruptActiveSession();
  assert.equal(manager.isSessionRunning(id), true);
  manager.enqueuePrompt(id, { text: "resume" });
  assert.equal(calls, 1);
  release.resolve();
  await run;
  await manager.waitForSessionIdle(id);
  assert.equal(maxActive, 1);
  assert.equal(calls, 2);
  assert.deepEqual(manager.listQueuedMessages(id), []);
  assert.equal(manager.getSession(id)?.status, "completed");
});

for (const resume of ["new input", "new input during cleanup", "/continue"] as const) {
  test(`interrupted tools are retried only by explicit /continue: ${resume}`, { timeout: 10000 }, async (t) => {
    const { manager, id, internal } = await fixture(t);
    const entered = deferred();
    const cleanup = deferred();
    t.after(() => cleanup.resolve());
    const tool = { id: "old-command", type: "function", function: { name: "Bash", arguments: '{"command":"old"}' } };
    let requests = 0;
    let executions = 0;
    let resumedContext: any[] = [];
    internal.requestSessionCompletion = async () => {
      if (++requests === 1) return { choices: [{ message: { content: "", tool_calls: [tool] } }] };
      resumedContext = manager.buildOpenAIMessages(manager.listSessionMessages(id), false, "test");
      return completion();
    };
    internal.toolExecutor.executeToolCalls = async (_sessionId: string, _calls: unknown[], hooks: any) => {
      if (++executions === 1) {
        entered.resolve();
        await cleanup.promise;
        hooks.signal.throwIfAborted();
      }
      return [{ toolCallId: tool.id, content: "executed", result: { name: "Bash", ok: true } }];
    };
    const running = manager.handleUserPrompt({ text: "run a command" });
    await entered.promise;
    manager.interruptActiveSession();
    const text = resume === "/continue" ? "/continue" : "Do not execute the previous command.";
    const immediate = resume === "new input during cleanup" ? manager.handleUserPrompt({ text }) : undefined;
    cleanup.resolve();
    await running;
    if (immediate) await immediate;
    else await manager.handleUserPrompt({ text });

    assert.equal(executions, resume === "/continue" ? 2 : 1);
    assert.equal(requests, 2);
    const result = resumedContext.find((message) => message.role === "tool" && message.tool_call_id === tool.id);
    assert.ok(result, "the model context must pair every tool call with a result");
    if (resume !== "/continue") {
      assert.equal(JSON.parse(result.content).metadata.interrupted, true);
      assert.ok(resumedContext.some((message) => message.role === "user" && message.content === text));
    }
    assert.equal(manager.getSession(id)?.status, "completed");
  });
}

test("failed preparation retains inputs and a new submission resumes the FIFO batch", async (t) => {
  const { manager, id, internal } = await fixture(t);
  const normalize = internal.normalizeSkills;
  internal.normalizeSkills = async () => {
    throw new Error("preparation failed");
  };
  manager.enqueuePrompt(id, { text: "retry me" });
  await assert.rejects(manager.waitForSessionIdle(id), /preparation failed/);
  assert.equal(manager.getPreparingPromptId(id), undefined);
  assert.equal(manager.getQueuePausedReason(id), "failed");
  assert.deepEqual(
    manager.listQueuedMessages(id).map((m) => m.content.text),
    ["retry me"]
  );
  internal.normalizeSkills = normalize;
  manager.enqueuePrompt(id, { text: "resume" });
  await manager.waitForSessionIdle(id);
  assert.deepEqual(
    manager
      .listSessionMessages(id)
      .filter((m) => m.role === "user")
      .map((m) => m.content),
    ["first", "retry me", "resume"]
  );
});

test("awaiting user and inactive sessions do not consume ordinary input", async (t) => {
  const { manager, id, internal } = await fixture(t);
  internal.updateSessionEntry(id, (entry: any) => ({ ...entry, status: "waiting_for_user" }));
  manager.enqueuePrompt(id, { text: "later" });
  assert.equal(manager.isSessionRunning(id), false);
  assert.equal(manager.getQueuePausedReason(id), "awaiting_user");
  manager.setActiveSessionId(null);
  assert.equal(manager.getQueuePausedReason(id), "session_inactive");
  manager.setActiveSessionId(id);
  assert.equal(manager.getQueuePausedReason(id), "awaiting_user");
  await manager.replySession(id, { text: "answer", isAnswers: true });
  assert.deepEqual(manager.listQueuedMessages(id), []);
});

test("an input submitted from completion notification is consumed before the runner stops", async (t) => {
  const { manager, id, internal } = await fixture(t);
  let inserted = false;
  internal.onSessionEntryUpdated = (entry: any) => {
    if (entry.status === "completed" && !inserted) {
      inserted = true;
      manager.enqueuePrompt(id, { text: "at completion" });
    }
  };
  await manager.replySession(id, { text: "running" });
  assert.equal(manager.listSessionMessages(id).filter((m) => m.content === "at completion").length, 1);
  assert.deepEqual(manager.listQueuedMessages(id), []);
});

test("initial preparation accepts additional inputs without creating a second session", async (t) => {
  const { manager, internal } = await fixture(t);
  const entered = deferred();
  const release = deferred();
  internal.createOpenAIClient.prepare = async () => {
    entered.resolve();
    await release.promise;
  };
  const creating = manager.createSession({ text: "new session" });
  const id = manager.getActiveSessionId()!;
  await entered.promise;
  const first = manager.listQueuedMessages(id)[0];
  assert.equal(manager.getPreparingPromptId(id), first.id);
  const submitting = manager.handleUserPrompt({ text: "during preparation" });
  assert.equal(manager.getActiveSessionId(), id);
  assert.equal(manager.getPreparingPromptId(id), first.id);
  release.resolve();
  await creating;
  await submitting;
  assert.equal(manager.getPreparingPromptId(id), undefined);
  assert.deepEqual(
    manager
      .listSessionMessages(id)
      .filter((m) => m.role === "user")
      .map((m) => m.content),
    ["new session", "during preparation"]
  );
});

test("removing an editing barrier wakes the remaining suffix without restarting a failed session", async (t) => {
  const { manager, id, internal } = await fixture(t);
  manager.setActiveSessionId(null);
  const a = manager.enqueuePrompt(id, { text: "a" });
  manager.enqueuePrompt(id, { text: "b" });
  manager.beginQueuedMessageEdit(id, a.id);
  manager.setActiveSessionId(id);
  assert.equal(manager.isSessionRunning(id), false);
  manager.removeQueuedMessage(id, a.id);
  await manager.waitForSessionIdle(id);
  assert.equal(manager.listSessionMessages(id).at(-2)?.content, "b");
  internal.updateSessionEntry(id, (entry: any) => ({ ...entry, status: "failed" }));
  manager.setActiveSessionId(null);
  const c = manager.enqueuePrompt(id, { text: "c" });
  manager.enqueuePrompt(id, { text: "d" });
  manager.setActiveSessionId(id);
  manager.removeQueuedMessage(id, c.id);
  assert.equal(manager.isSessionRunning(id), false);
  assert.equal(manager.getQueuePausedReason(id), "failed");
});

test("initial subscription failure keeps the queue in memory and retries the same session", async (t) => {
  const { manager, internal } = await fixture(t);
  internal.createOpenAIClient.prepare = async () => {
    throw new Error("subscription unavailable");
  };
  await assert.rejects(manager.createSession({ text: "first queued" }), /subscription unavailable/);
  const id = manager.getActiveSessionId()!;
  assert.equal(manager.getSession(id), null);
  assert.equal(manager.listQueuedMessages(id)[0].content.text, "first queued");
  internal.createOpenAIClient.prepare = async () => {};
  await manager.handleUserPrompt({ text: "/continue" });
  await manager.handleUserPrompt({ text: "second queued" });
  assert.equal(manager.getActiveSessionId(), id);
  assert.deepEqual(
    manager
      .listSessionMessages(id)
      .filter((m) => m.role === "user")
      .map((m) => m.content),
    ["first queued", "second queued"]
  );
});

test("model-change notices are deferred until pending tool results have been appended", async (t) => {
  const { manager, id, internal } = await fixture(t);
  const assistant = internal.buildAssistantMessage(id, "", [
    { id: "tool", type: "function", function: { name: "Read", arguments: "{}" } },
  ]);
  internal.appendSessionMessage(id, assistant);
  manager.addSessionSystemMessage(id, "model changed", true, { isModelChange: true });
  assert.equal(manager.listSessionMessages(id).at(-1)?.id, assistant.id);
  internal.toolExecutor.executeToolCalls = async () => [
    { toolCallId: "tool", content: "done", result: { name: "Read" } },
  ];
  manager.setActiveSessionId(null);
  manager.enqueuePrompt(id, { text: "next" });
  await manager.replySession(id, { text: "/continue" });
  const messages = manager.listSessionMessages(id);
  const index = messages.findIndex((m) => m.id === assistant.id);
  assert.equal(messages[index + 1].role, "tool");
  assert.equal(messages[index + 2].content, "model changed");
  assert.equal(messages[index + 3].content, "next");
});

test("manual compaction holds the execution lock and wakes queued input on completion", async (t) => {
  const { manager, id, internal } = await fixture(t);
  const entered = deferred();
  const release = deferred();
  let calls = 0;
  internal.compactSessionOnce = async () => {
    entered.resolve();
    await release.promise;
    return true;
  };
  internal.requestSessionCompletion = async () => {
    calls++;
    return completion();
  };
  const compacting = manager.compactSession(id);
  await entered.promise;
  manager.enqueuePrompt(id, { text: "after compaction" });
  assert.equal(calls, 0);
  assert.equal(manager.isSessionRunning(id), true);
  release.resolve();
  await compacting;
  await manager.waitForSessionIdle(id);
  assert.equal(calls, 1);
  assert.deepEqual(manager.listQueuedMessages(id), []);
});

test("editing during the next iteration's preparation does not repeat a finished model reply", async (t) => {
  const { manager, id, internal } = await fixture(t);
  const requested = deferred();
  const finishReply = deferred();
  const preparing = deferred();
  const finishPreparation = deferred();
  let requests = 0;
  internal.requestSessionCompletion = async () => {
    requests++;
    requested.resolve();
    await finishReply.promise;
    return completion();
  };
  const running = manager.replySession(id, { text: "running" });
  await requested.promise;
  const queued = manager.enqueuePrompt(id, { text: "later" });
  internal.normalizeSkills = async () => {
    preparing.resolve();
    await finishPreparation.promise;
    return [];
  };
  finishReply.resolve();
  await preparing.promise;
  manager.beginQueuedMessageEdit(id, queued.id);
  finishPreparation.resolve();
  await running;
  assert.equal(requests, 1);
  assert.equal(manager.listQueuedMessages(id)[0].id, queued.id);
  manager.finishQueuedMessageEdit(id, queued.id);
  await manager.waitForSessionIdle(id);
  assert.equal(requests, 2);
});
