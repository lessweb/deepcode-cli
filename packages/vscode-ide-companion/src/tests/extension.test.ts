import { test } from "node:test";
import assert from "node:assert/strict";
import { handleWebviewMessage, loadSession, postUndoState, releaseQueueEdit, type ProviderDeps } from "../provider.js";

import { PromptQueue } from "../../../core/src/prompt-queue.js";

// --- Helpers ---

function createMockSessionManager(options?: { sessions?: any[]; messages?: any[]; skills?: any[] }) {
  const sessions = options?.sessions ?? [
    {
      id: "session-1",
      summary: "Test Session",
      status: "idle",
      askPermissions: null,
      processes: null,
      activeTokens: 100,
      usage: null,
      createTime: "2025-01-01T00:00:00Z",
      updateTime: "2025-01-01T00:00:00Z",
    },
  ];
  const messages = options?.messages ?? [];
  const skills = options?.skills ?? [];
  let activeSessionId: string | null = sessions[0]?.id ?? null;

  const queue = new PromptQueue("session-1");
  return {
    listUndoTargets: () =>
      messages
        .filter((m: any) => m.role === "user" && m.visible && !m.meta?.isSummary)
        .map((message: any, index: number) => ({ message, index, canRestoreCode: Boolean(message.checkpointHash) })),
    restoreSessionCode: () => {},
    restoreSessionConversation: () => [],
    listQueuedMessages: () => queue.list(),
    getQueuePausedReason: () => undefined,
    getPreparingPromptId: (): string | undefined => undefined,
    enqueuePrompt: (_sessionId: string, content: any) => queue.enqueue(content),
    beginQueuedMessageEdit: (_sessionId: string, id: string) => queue.beginEdit(id),
    finishQueuedMessageEdit: (_sessionId: string, id: string, content?: any) => queue.finishEdit(id, content),
    removeQueuedMessage: (_sessionId: string, id: string) => queue.remove(id),
    isSessionRunning: () => false,
    dispose: () => {},
    listSessions: () => sessions,
    getSession: (id: string) => sessions.find((s: any) => s.id === id) ?? null,
    getActiveSessionId: () => activeSessionId,
    setActiveSessionId: (id: string | null) => {
      activeSessionId = id;
    },
    listSessionMessages: (_sessionId: string) => messages,
    handleUserPrompt: () => Promise.resolve(),
    interruptActiveSession: () => {},
    denySessionPermission: (_sessionId: string) => {},
    listSkills: () => Promise.resolve(skills),
    initMcpServers: () => Promise.resolve(),
    forkSession: (id: string) => {
      const source = sessions.find((s: any) => s.id === id);
      sessions.push({ ...source, id: "forked-session" });
      return "forked-session";
    },
    compactSession: () => Promise.resolve(true),
  };
}

function createDeps(options?: Parameters<typeof createMockSessionManager>[0]): ProviderDeps & { messages: unknown[] } {
  const messages: unknown[] = [];
  return {
    sessionManager: createMockSessionManager(options),
    postMessage: (msg: unknown) => {
      messages.push(msg);
    },
    renderMarkdown: (text: string) => `<p>${text}</p>`,
    copyToClipboard: () => {},
    messages,
  };
}

// --- handleWebviewMessage routing ---

test("handleWebviewMessage returns false for null message", async () => {
  const deps = createDeps();
  const result = await handleWebviewMessage(null, deps);
  assert.equal(result, false);
});

test("handleWebviewMessage returns false for non-object message", async () => {
  const deps = createDeps();
  assert.equal(await handleWebviewMessage("string", deps), false);
  assert.equal(await handleWebviewMessage(123, deps), false);
});

test("handleWebviewMessage returns false for unknown message type", async () => {
  const deps = createDeps();
  assert.equal(await handleWebviewMessage({ type: "unknownType" }, deps), false);
});

test("ready message triggers loadInitialSession and sendSkillsList", async () => {
  const deps = createDeps();
  const handled = await handleWebviewMessage({ type: "ready" }, deps);

  assert.equal(handled, true);
  const types = deps.messages.map((m: any) => m.type);
  // With sessions present, should send loadSession + skillsList
  assert.ok(types.includes("loadSession"), `Expected loadSession, got: ${types.join(", ")}`);
  assert.ok(types.includes("skillsList"), `Expected skillsList, got: ${types.join(", ")}`);
});

test("ready message renders markdown for initial session messages", async () => {
  const deps = createDeps({
    messages: [{ role: "assistant", content: "**bold**", visible: true }],
  });

  await handleWebviewMessage({ type: "ready" }, deps);

  const loadMsg = deps.messages.find((m: any) => m.type === "loadSession") as any;
  assert.ok(loadMsg, "Should send loadSession");
  assert.equal(loadMsg.messages[0].html, "<p>**bold**</p>");
});

test("ready with no sessions sends initializeEmpty", async () => {
  const deps = createDeps({ sessions: [] });
  await handleWebviewMessage({ type: "ready" }, deps);

  const types = deps.messages.map((m: any) => m.type);
  assert.ok(types.includes("initializeEmpty"), `Expected initializeEmpty, got: ${types.join(", ")}`);
});

test("requestSkills sends skillsList", async () => {
  const deps = createDeps({ skills: [{ name: "test-skill" }] });
  await handleWebviewMessage({ type: "requestSkills" }, deps);

  const skillsMsg = deps.messages.find((m: any) => m.type === "skillsList");
  assert.ok(skillsMsg, "Should send skillsList");
  assert.deepEqual((skillsMsg as any).skills, [{ name: "test-skill" }]);
});

test("interrupt calls interruptActiveSession", async () => {
  const deps = createDeps();
  let interrupted = false;
  (deps.sessionManager as any).interruptActiveSession = () => {
    interrupted = true;
  };

  const handled = await handleWebviewMessage({ type: "interrupt" }, deps);
  assert.equal(handled, true);
  assert.ok(interrupted, "interruptActiveSession should be called");
});

test("createNewSession clears active session and sends initializeEmpty", async () => {
  const deps = createDeps();
  let cleared = false;
  (deps.sessionManager as any).setActiveSessionId = (id: string | null) => {
    if (id === null) cleared = true;
  };

  await handleWebviewMessage({ type: "createNewSession" }, deps);

  assert.ok(cleared, "setActiveSessionId(null) should be called");
  const types = deps.messages.map((m: any) => m.type);
  assert.ok(types.includes("initializeEmpty"), `Expected initializeEmpty, got: ${types.join(", ")}`);
  assert.ok(types.includes("skillsList"), `Expected skillsList, got: ${types.join(", ")}`);
});

test("selectSession loads session and sends skillsList", async () => {
  const deps = createDeps();
  let loadedId: string | null = null;
  (deps.sessionManager as any).setActiveSessionId = (id: string) => {
    loadedId = id;
  };

  await handleWebviewMessage({ type: "selectSession", sessionId: "session-1" }, deps);

  assert.equal(loadedId, "session-1");
  const types = deps.messages.map((m: any) => m.type);
  assert.ok(types.includes("loadSession"), `Expected loadSession, got: ${types.join(", ")}`);
  assert.ok(types.includes("skillsList"), `Expected skillsList, got: ${types.join(", ")}`);
});

test("selectSession with empty sessionId does nothing", async () => {
  const deps = createDeps();
  await handleWebviewMessage({ type: "selectSession", sessionId: "" }, deps);
  assert.equal(deps.messages.length, 0, "No messages for empty sessionId");
});

test("selectSession with non-existent session does not send loadSession", async () => {
  const deps = createDeps();
  (deps.sessionManager as any).getSession = () => null;

  await handleWebviewMessage({ type: "selectSession", sessionId: "non-existent" }, deps);

  const types = deps.messages.map((m: any) => m.type);
  assert.ok(!types.includes("loadSession"), "Should not send loadSession for non-existent session");
});

test("backToList sends showSessionsList", async () => {
  const deps = createDeps();
  await handleWebviewMessage({ type: "backToList" }, deps);

  const msg = deps.messages.find((m: any) => m.type === "showSessionsList");
  assert.ok(msg, "Should send showSessionsList");
  assert.ok(Array.isArray((msg as any).sessions), "sessions should be an array");
});

test("denyPermission calls denySessionPermission and sends sessionStatus", async () => {
  const deps = createDeps();
  let deniedId: string | null = null;
  (deps.sessionManager as any).denySessionPermission = (id: string) => {
    deniedId = id;
  };

  await handleWebviewMessage({ type: "denyPermission", sessionId: "session-1" }, deps);

  assert.equal(deniedId, "session-1");
  const types = deps.messages.map((m: any) => m.type);
  assert.ok(types.includes("sessionStatus"), `Expected sessionStatus, got: ${types.join(", ")}`);
  assert.ok(types.includes("showSessionsList"), `Expected showSessionsList, got: ${types.join(", ")}`);
});

test("denyPermission with empty sessionId does nothing", async () => {
  const deps = createDeps();
  (deps.sessionManager as any).getActiveSessionId = () => null;

  await handleWebviewMessage({ type: "denyPermission", sessionId: "" }, deps);

  // No sessionStatus should be sent
  const types = deps.messages.map((m: any) => m.type);
  assert.ok(!types.includes("sessionStatus"), "Should not send sessionStatus for empty sessionId");
});

test("copyText calls copyToClipboard", async () => {
  const deps = createDeps();
  let copiedText: string | null = null;
  deps.copyToClipboard = (text: string) => {
    copiedText = text;
  };

  const handled = await handleWebviewMessage({ type: "copyText", text: "hello" }, deps);
  assert.equal(handled, true);
  assert.equal(copiedText, "hello");
});

test("copyText with empty text does not call copyToClipboard", async () => {
  const deps = createDeps();
  let copied = false;
  deps.copyToClipboard = () => {
    copied = true;
  };

  await handleWebviewMessage({ type: "copyText", text: "" }, deps);
  assert.ok(!copied, "Should not copy empty text");
});

test("openFile returns false (handled by caller)", async () => {
  const deps = createDeps();
  const result = await handleWebviewMessage({ type: "openFile", filePath: "/some/file.ts" }, deps);
  assert.equal(result, false);
});

// --- userPrompt ---

test("userPrompt with empty prompt and no images/permissions is handled without messages", async () => {
  const deps = createDeps();
  const handled = await handleWebviewMessage(
    { type: "userPrompt", prompt: "", images: [], permissions: [], alwaysAllows: [] },
    deps
  );
  assert.equal(handled, true);
  assert.equal(deps.messages.length, 0, "No messages for empty prompt");
});

test("ordinary userPrompt waits for committed user callback and sends loading states", async () => {
  const deps = createDeps();
  await handleWebviewMessage({ type: "userPrompt", prompt: "hello" }, deps);

  const types = deps.messages.map((m: any) => m.type);
  assert.ok(!types.includes("userMessage"), "No optimistic duplicate of the committed user message");
  assert.ok(types.includes("loading"), `Expected loading, got: ${types.join(", ")}`);

  // Should end with loading: false
  const lastLoading = [...deps.messages].reverse().find((m: any) => m.type === "loading");
  assert.deepEqual(lastLoading, { type: "loading", value: false, status: "idle" });
});

test("image userPrompt waits for committed user callback", async () => {
  const deps = createDeps();
  await handleWebviewMessage({ type: "userPrompt", prompt: "", images: ["data:image/png;base64,abc"] }, deps);

  const userMsg = deps.messages.find((m: any) => m.type === "userMessage");
  assert.equal(userMsg, undefined);
});

test("userPrompt passes multiple image urls to the session manager", async () => {
  const deps = createDeps();
  let submittedPrompt: any = null;
  (deps.sessionManager as any).handleUserPrompt = (prompt: any) => {
    submittedPrompt = prompt;
    return Promise.resolve();
  };

  await handleWebviewMessage(
    {
      type: "userPrompt",
      prompt: "",
      images: ["data:image/png;base64,abc", "data:image/jpeg;base64,def"],
    },
    deps
  );

  assert.deepEqual(submittedPrompt?.imageUrls, ["data:image/png;base64,abc", "data:image/jpeg;base64,def"]);
});

test("userPrompt passes the AskUserQuestion answer marker to the session manager", async () => {
  const deps = createDeps();
  let submittedPrompt: any = null;
  (deps.sessionManager as any).handleUserPrompt = (prompt: any) => {
    submittedPrompt = prompt;
    return Promise.resolve();
  };

  await handleWebviewMessage(
    {
      type: "userPrompt",
      prompt: "Questions 1/1 answered\n - Continue?\n   answer: Yes",
      isAnswers: true,
    },
    deps
  );

  assert.equal(submittedPrompt?.isAnswers, true);
  const userMessage = deps.messages.find((message: any) => message.type === "userMessage") as any;
  assert.equal(userMessage.meta?.isAnswers, true);
  assert.match(userMessage.html, /^<p>Questions 1\/1 answered/);
});

test("userPrompt with permissions (continue) does not send userMessage", async () => {
  const deps = createDeps();
  await handleWebviewMessage(
    {
      type: "userPrompt",
      prompt: "/continue",
      images: [],
      permissions: [{ toolCallId: "call-1", permission: "allow" }],
    },
    deps
  );

  const userMsg = deps.messages.find((m: any) => m.type === "userMessage");
  assert.ok(!userMsg, "Should not send userMessage for /continue with permissions");
});

test("userPrompt sends sessionStatus after handling", async () => {
  const deps = createDeps();
  (deps.sessionManager.getSession("session-1") as any).pluginRateLimitedTool = "WebSearch";
  await handleWebviewMessage({ type: "userPrompt", prompt: "hello" }, deps);

  const status = deps.messages.find((m: any) => m.type === "sessionStatus") as any;
  assert.ok(status, "Expected sessionStatus");
  assert.equal(status.pluginRateLimitedTool, "WebSearch");
});

test("userPrompt sends showSessionsList after handling", async () => {
  const deps = createDeps();
  await handleWebviewMessage({ type: "userPrompt", prompt: "hello" }, deps);

  const sessionsMsg = deps.messages.find((m: any) => m.type === "showSessionsList");
  assert.ok(sessionsMsg, "Should send showSessionsList");
  assert.ok(Array.isArray((sessionsMsg as any).sessions), "sessions should be an array");
});

test("userPrompt on error sends assistant error message", async () => {
  const deps = createDeps();
  (deps.sessionManager as any).handleUserPrompt = () => Promise.reject(new Error("API failed"));

  await handleWebviewMessage({ type: "userPrompt", prompt: "hello" }, deps);

  const assistantMsg = deps.messages.find((m: any) => m.type === "assistant");
  assert.ok(assistantMsg, "Should send assistant error message");
  assert.ok((assistantMsg as any).html.includes("API failed"), "Error message should contain the error text");
});

test("userPrompt always sends loading: false even on error", async () => {
  const deps = createDeps();
  (deps.sessionManager as any).handleUserPrompt = () => Promise.reject(new Error("fail"));

  await handleWebviewMessage({ type: "userPrompt", prompt: "hello" }, deps);

  const lastLoading = [...deps.messages].reverse().find((m: any) => m.type === "loading");
  assert.deepEqual(lastLoading, { type: "loading", value: false, status: "idle" });
});

// --- loadSession ---

test("loadSession sends loadSession with correct fields", () => {
  const sessionManager = createMockSessionManager();
  const messages: unknown[] = [];
  const postMessage = (msg: unknown) => {
    messages.push(msg);
  };

  loadSession("session-1", sessionManager, postMessage, (t) => t);

  const msg = messages.find((m: any) => m.type === "loadSession") as any;
  assert.ok(msg, "Should send loadSession");
  assert.equal(msg.sessionId, "session-1");
  assert.equal(msg.summary, "Test Session");
  assert.equal(msg.status, "idle");
  assert.equal(msg.pluginRateLimitedTool, null);
  assert.ok(Array.isArray(msg.sessions), "sessions should be an array");
  assert.ok(Array.isArray(msg.messages), "messages should be an array");
});

test("loadSession includes the persisted plugin rate limit", () => {
  const sessionManager = createMockSessionManager();
  (sessionManager.getSession("session-1") as any).pluginRateLimitedTool = "UnderstandImage";
  const messages: unknown[] = [];

  loadSession(
    "session-1",
    sessionManager,
    (msg) => messages.push(msg),
    (t) => t
  );

  const msg = messages.find((item: any) => item.type === "loadSession") as any;
  assert.equal(msg.pluginRateLimitedTool, "UnderstandImage");
});

test("loadSession with non-existent session does nothing", () => {
  const sessionManager = createMockSessionManager();
  const messages: unknown[] = [];
  const postMessage = (msg: unknown) => {
    messages.push(msg);
  };

  (sessionManager as any).getSession = () => null;
  loadSession("non-existent", sessionManager, postMessage, (t) => t);

  assert.equal(messages.length, 0, "No messages for non-existent session");
});

test("loadSession sets active session id", () => {
  const sessionManager = createMockSessionManager();
  const messages: unknown[] = [];
  let setTo: string | null = null;
  (sessionManager as any).setActiveSessionId = (id: string) => {
    setTo = id;
  };

  loadSession(
    "session-1",
    sessionManager,
    (msg) => messages.push(msg),
    (t) => t
  );

  assert.equal(setTo, "session-1");
});

test("loadSession filters out invisible messages", () => {
  const sessionManager = createMockSessionManager({
    messages: [
      { role: "user", content: "visible", visible: true },
      { role: "assistant", content: "hidden", visible: false },
      { role: "user", content: "also visible", visible: true },
    ],
  });
  const messages: unknown[] = [];
  loadSession(
    "session-1",
    sessionManager,
    (msg) => messages.push(msg),
    (t) => t
  );

  const loadMsg = messages.find((m: any) => m.type === "loadSession") as any;
  assert.equal(loadMsg.messages.length, 2, "Should filter out invisible messages");
});

// --- serializeProcesses ---

test("loadSession serializes processes map to object", () => {
  const sessionManager = createMockSessionManager({
    sessions: [
      {
        id: "session-1",
        summary: "Test",
        status: "idle",
        askPermissions: null,
        processes: new Map([
          ["123", { startTime: "2025-01-01", command: "ls" }],
          ["456", { startTime: "2025-01-02", command: "cat" }],
        ]),
        activeTokens: 0,
        usage: null,
        createTime: "2025-01-01",
        updateTime: "2025-01-01",
      },
    ],
  });
  const messages: unknown[] = [];
  loadSession(
    "session-1",
    sessionManager,
    (msg) => messages.push(msg),
    (t) => t
  );

  const loadMsg = messages.find((m: any) => m.type === "loadSession") as any;
  assert.deepEqual(loadMsg.processes, {
    "123": { startTime: "2025-01-01", command: "ls" },
    "456": { startTime: "2025-01-02", command: "cat" },
  });
});

test("loadSession returns null for empty processes", () => {
  const sessionManager = createMockSessionManager({
    sessions: [
      {
        id: "session-1",
        summary: "Test",
        status: "idle",
        askPermissions: null,
        processes: null,
        activeTokens: 0,
        usage: null,
        createTime: "2025-01-01",
        updateTime: "2025-01-01",
      },
    ],
  });
  const messages: unknown[] = [];
  loadSession(
    "session-1",
    sessionManager,
    (msg) => messages.push(msg),
    (t) => t
  );

  const loadMsg = messages.find((m: any) => m.type === "loadSession") as any;
  assert.equal(loadMsg.processes, null);
});

test("loadSession prepares legacy tool diffs without modifying persisted content", () => {
  const content = JSON.stringify({
    name: "edit",
    ok: true,
    metadata: {
      file_path: "/project/file.ts",
      diff_preview: "--- a/file\n+++ b/file\n@@ -2,1 +2,1 @@\n context\n-old\n+new",
    },
  });
  const original = { role: "tool", content, visible: true };
  const deps = createDeps({ messages: [original] });
  loadSession("session-1", deps.sessionManager, deps.postMessage, (text) => text);
  const loaded = deps.messages.find((message: any) => message.type === "loadSession") as any;
  const metadata = JSON.parse(loaded.messages[0].content).metadata;
  assert.equal(metadata.diff_details.added, 1);
  assert.equal(metadata.diff_details.removed, 1);
  assert.equal(metadata.diff_details.lines[0].lineNumber, 1);
  assert.equal(original.content, content);
});

test("plan mode is passed to prompts and restored with session state", async () => {
  const deps = createDeps();
  const submitted: any[] = [];
  deps.sessionManager.handleUserPrompt = async (prompt) => {
    submitted.push(prompt);
  };
  const session = deps.sessionManager.getSession("session-1")!;
  session.planMode = true;
  await handleWebviewMessage({ type: "userPrompt", prompt: "Plan it", planMode: true }, deps);
  await handleWebviewMessage({ type: "userPrompt", prompt: "Implement it", planMode: false }, deps);
  assert.equal(submitted[0].planMode, true);
  assert.equal(submitted[1].planMode, false);
  loadSession("session-1", deps.sessionManager, deps.postMessage, deps.renderMarkdown);
  assert.equal((deps.messages.find((m: any) => m.type === "loadSession") as any).planMode, true);
  assert.equal((deps.messages.find((m: any) => m.type === "sessionStatus") as any).planMode, true);
});

test("slash commands reuse session navigation and do not submit local commands as prompts", async () => {
  const deps = createDeps();
  deps.sessionManager.handleUserPrompt = async () => {
    assert.fail("Unexpected prompt");
  };
  await handleWebviewMessage({ type: "slashCommand", command: "resume" }, deps);
  assert.ok(deps.messages.some((m: any) => m.type === "openSessionPicker"));
  await handleWebviewMessage({ type: "slashCommand", command: "fork" }, deps);
  assert.equal(deps.sessionManager.getActiveSessionId(), "forked-session");
  await handleWebviewMessage({ type: "slashCommand", command: "new" }, deps);
  assert.equal(deps.sessionManager.getActiveSessionId(), null);
  assert.ok(deps.messages.some((m: any) => m.type === "initializeEmpty" && m.fresh === true));
  deps.messages.length = 0;
  await handleWebviewMessage({ type: "slashCommand", command: "continue" }, deps);
  assert.ok(deps.messages.some((m: any) => m.type === "openSessionPicker"));
  await handleWebviewMessage({ type: "slashCommand", command: "exit" }, deps);
});

test("init and continue submit through the normal prompt pipeline with plan mode and permissions", async () => {
  const deps = createDeps();
  const submitted: any[] = [];
  deps.sessionManager.handleUserPrompt = async (prompt) => {
    submitted.push(prompt);
  };
  await handleWebviewMessage(
    { type: "slashCommand", command: "init", skills: [{ name: "test" }], planMode: true },
    deps
  );
  await handleWebviewMessage(
    {
      type: "slashCommand",
      command: "continue",
      planMode: true,
      permissions: [{ toolCallId: "call-1", permission: "allow" }],
    },
    deps
  );
  assert.equal(submitted[0].text, "/init");
  assert.deepEqual(submitted[0].skills, [{ name: "test" }]);
  assert.equal(submitted[0].planMode, true);
  assert.equal(submitted[1].text, "/continue");
  assert.equal(submitted[1].planMode, true);
  assert.deepEqual(submitted[1].permissions, [{ toolCallId: "call-1", permission: "allow" }]);
});

test("compaction blocks duplicate operations and can be interrupted", async () => {
  const deps = createDeps();
  let calls = 0;
  let signal: AbortSignal | undefined;
  deps.sessionManager.compactSession = async (_sessionId, abortSignal) => {
    calls++;
    signal = abortSignal;
    return new Promise<boolean>((_resolve, reject) => {
      abortSignal!.addEventListener("abort", () => reject(new Error("Aborted")), { once: true });
    });
  };
  const pending = handleWebviewMessage({ type: "slashCommand", command: "compact" }, deps);
  await handleWebviewMessage({ type: "slashCommand", command: "compact" }, deps);
  await handleWebviewMessage({ type: "createNewSession" }, deps);
  assert.equal(calls, 1);
  assert.equal(deps.sessionManager.getActiveSessionId(), "session-1");
  await handleWebviewMessage({ type: "interrupt" }, deps);
  await pending;
  assert.equal(signal?.aborted, true);
  assert.ok(deps.messages.some((m: any) => m.type === "commandNotice" && m.text === "Compaction cancelled."));
  assert.ok(deps.messages.some((m: any) => m.type === "commandBusy" && m.value === false));
  await handleWebviewMessage({ type: "createNewSession" }, deps);
  assert.equal(deps.sessionManager.getActiveSessionId(), null);
});

test("compaction reports no-op and failure, and always releases busy state", async () => {
  const deps = createDeps();
  deps.sessionManager.compactSession = async () => false;
  await handleWebviewMessage({ type: "slashCommand", command: "compact" }, deps);
  assert.ok(deps.messages.some((m: any) => m.text === "Conversation was not compacted."));
  deps.sessionManager.compactSession = async () => {
    throw new Error("API failed");
  };
  await handleWebviewMessage({ type: "slashCommand", command: "compact" }, deps);
  assert.ok(deps.messages.some((m: any) => m.text === "Compaction failed: API failed"));
  assert.equal(deps.messages.filter((m: any) => m.type === "commandBusy" && m.value === false).length, 2);
});

test("ready restores the selected session or an unsent new conversation", async () => {
  const deps = createDeps();
  await handleWebviewMessage({ type: "slashCommand", command: "fork" }, deps);
  await handleWebviewMessage({ type: "ready", sessionId: "forked-session" }, deps);
  assert.equal(deps.sessionManager.getActiveSessionId(), "forked-session");
  await handleWebviewMessage({ type: "ready", sessionId: null }, deps);
  assert.equal(deps.sessionManager.getActiveSessionId(), null);
  assert.ok(deps.messages.some((m: any) => m.type === "initializeEmpty" && m.fresh === false));
});

test("webview reconstruction cannot switch away from a running session", async () => {
  const deps = createDeps();
  const session = deps.sessionManager.getSession("session-1")!;
  session.status = "processing";
  session.planMode = true;
  await handleWebviewMessage({ type: "ready", sessionId: null }, deps);
  assert.equal(deps.sessionManager.getActiveSessionId(), "session-1");
  const loaded = deps.messages.find((m: any) => m.type === "loadSession") as any;
  assert.equal(loaded.planMode, true);
});

test("compaction and fork without a session report a notice without submitting a prompt", async () => {
  const deps = createDeps({ sessions: [] });
  deps.sessionManager.handleUserPrompt = async () => assert.fail("Unexpected prompt");
  await handleWebviewMessage({ type: "slashCommand", command: "compact" }, deps);
  await handleWebviewMessage({ type: "slashCommand", command: "fork" }, deps);
  assert.deepEqual(deps.messages, [
    { type: "commandNotice", text: "No active conversation to compact." },
    { type: "commandNotice", text: "No active conversation to fork." },
  ]);
});

async function completePlan(
  deps: ReturnType<typeof createDeps>,
  reply = "<proposed_plan>\n# Plan\n- Implement it\n</proposed_plan>"
) {
  deps.sessionManager.handleUserPrompt = async () => {
    const session = deps.sessionManager.getSession(deps.sessionManager.getActiveSessionId()!)!;
    session.status = "completed";
    session.planMode = true;
    session.assistantReply = reply;
  };
  await handleWebviewMessage({ type: "userPrompt", prompt: "Make a plan", planMode: true }, deps);
  const offered = deps.messages.find((m: any) => m.type === "planImplementation") as any;
  assert.ok(offered);
  return { id: offered.id, sessionId: offered.sessionId };
}

test("only the current completed plan response offers implementation choices", async () => {
  for (const [planMode, status, reply, expected] of [
    [true, "completed", "<proposed_plan>Plan</proposed_plan>", true],
    [false, "completed", "<proposed_plan>Plan</proposed_plan>", false],
    [true, "interrupted", "<proposed_plan>Plan</proposed_plan>", false],
    [true, "waiting_for_user", "<proposed_plan>Plan</proposed_plan>", false],
    [true, "completed", "<proposed_plan>Partial", false],
    [true, "completed", "<proposed_plan> </proposed_plan>", false],
  ] as const) {
    const deps = createDeps();
    deps.sessionManager.handleUserPrompt = async () => {
      Object.assign(deps.sessionManager.getSession("session-1")!, { status, assistantReply: reply, planMode });
    };
    await handleWebviewMessage({ type: "userPrompt", prompt: "Make a plan", planMode }, deps);
    assert.equal(
      deps.messages.some((m: any) => m.type === "planImplementation"),
      expected
    );
  }
  const deps = createDeps();
  Object.assign(deps.sessionManager.getSession("session-1")!, {
    status: "completed",
    planMode: true,
    assistantReply: "<proposed_plan>Historical plan</proposed_plan>",
  });
  await handleWebviewMessage({ type: "ready" }, deps);
  assert.equal(
    deps.messages.some((m: any) => m.type === "planImplementation"),
    false
  );
});

test("implement keeps the conversation, exits Plan mode, and cannot run twice", async () => {
  const deps = createDeps();
  const pending = await completePlan(deps);
  const prompts: any[] = [];
  deps.sessionManager.handleUserPrompt = async (prompt) => {
    prompts.push(prompt);
  };
  await handleWebviewMessage({ type: "planImplementationChoice", ...pending, choice: "implement" }, deps);
  assert.equal(deps.sessionManager.getActiveSessionId(), "session-1");
  assert.equal(prompts[0].text, "Implement the plan.");
  assert.equal(prompts[0].planMode, false);
  await handleWebviewMessage({ type: "planImplementationChoice", ...pending, choice: "implement" }, deps);
  assert.equal(prompts.length, 1);
});

test("clear context implements the complete plan in a new conversation and preserves the original", async () => {
  const deps = createDeps();
  const plan = "# Plan\n\n- Keep `Markdown`\n- Verify tests";
  const pending = await completePlan(deps, `<proposed_plan>${plan}</proposed_plan>`);
  let prompt: any;
  deps.sessionManager.handleUserPrompt = async (submitted) => {
    assert.equal(deps.sessionManager.getActiveSessionId(), null);
    prompt = submitted;
    deps.sessionManager
      .listSessions()
      .push({ ...deps.sessionManager.getSession("session-1")!, id: "new-session", planMode: false });
    deps.sessionManager.setActiveSessionId("new-session");
  };
  await handleWebviewMessage({ type: "planImplementationChoice", ...pending, choice: "clear-context" }, deps);
  assert.equal(prompt.planMode, false);
  assert.ok(prompt.text.endsWith(`\n\n${plan}`));
  assert.match(prompt.text, /Implement the plan in a fresh context/);
  assert.equal(deps.sessionManager.getActiveSessionId(), "new-session");
  assert.ok(deps.sessionManager.getSession("session-1"));
  assert.ok(deps.messages.some((m: any) => m.type === "initializeEmpty" && m.fresh));
});

test("stay and default only dismiss the chooser; plain replies continue in Plan mode", async () => {
  for (const choice of ["stay", "default"] as const) {
    const deps = createDeps();
    const pending = await completePlan(deps);
    const prompts: any[] = [];
    deps.sessionManager.handleUserPrompt = async (prompt) => {
      prompts.push(prompt);
    };
    await handleWebviewMessage({ type: "planImplementationChoice", ...pending, choice }, deps);
    assert.equal(prompts.length, 0);
    await handleWebviewMessage({ type: "userPrompt", prompt: "Follow up", planMode: choice === "stay" }, deps);
    assert.equal(prompts[0].planMode, choice === "stay");
  }
  const deps = createDeps();
  const pending = await completePlan(deps);
  const prompts: any[] = [];
  deps.sessionManager.handleUserPrompt = async (prompt) => {
    prompts.push(prompt);
  };
  await handleWebviewMessage({ type: "userPrompt", prompt: "Revise step two", planMode: false }, deps);
  assert.equal(prompts[0].text, "Revise step two");
  assert.equal(prompts[0].planMode, true);
  await handleWebviewMessage({ type: "planImplementationChoice", ...pending, choice: "implement" }, deps);
  assert.equal(prompts.length, 1);
});

test("pending choices survive Webview reconstruction but not switching sessions", async () => {
  const deps = createDeps();
  const pending = await completePlan(deps);
  deps.messages.length = 0;
  await handleWebviewMessage({ type: "ready", sessionId: "session-1" }, deps);
  assert.ok(deps.messages.some((m: any) => m.type === "planImplementation" && m.id === pending.id));
  await handleWebviewMessage({ type: "createNewSession" }, deps);
  deps.sessionManager.handleUserPrompt = async () => assert.fail("Stale plan must not execute");
  await handleWebviewMessage({ type: "planImplementationChoice", ...pending, choice: "implement" }, deps);
  await handleWebviewMessage({ type: "selectSession", sessionId: "session-1" }, deps);
  deps.messages.length = 0;
  await handleWebviewMessage({ type: "ready", sessionId: "session-1" }, deps);
  assert.equal(
    deps.messages.some((m: any) => m.type === "planImplementation"),
    false
  );
});

const undoPrompt = {
  id: "prompt-1",
  role: "user",
  visible: true,
  content: "restore me",
  createTime: "2026-11-11T00:00:00Z",
  checkpointHash: "checkpoint",
  meta: { userPrompt: { imageUrls: ["data:image/png;base64,abc"] } },
};

async function undoAction(
  deps: ProviderDeps & { messages: unknown[] },
  action: string,
  extra: Record<string, unknown> = {}
) {
  await handleWebviewMessage(
    { type: "undoAction", action, sessionId: "session-1", id: "prompt-1", requestId: 42, ...extra },
    deps
  );
  return deps.messages.filter((message: any) => message.type === "undoResult").at(-1) as any;
}

test("busy undo exposes history and pending messages without interrupting", async () => {
  const deps = createDeps({ messages: [undoPrompt] });
  deps.sessionManager.getSession("session-1")!.status = "processing";
  deps.sessionManager.interruptActiveSession = () => assert.fail("must not interrupt");
  deps.sessionManager.enqueuePrompt("session-1", { text: "pending" });
  await handleWebviewMessage({ type: "slashCommand", command: "undo" }, deps);
  const state = deps.messages.find((m: any) => m.type === "undoState") as any;
  assert.equal(state.busy, true);
  assert.equal(state.targets[0].id, "prompt-1");
  assert.equal(state.queued[0].content.text, "pending");
  assert.ok(deps.messages.some((m: any) => m.type === "openUndo"));
  deps.sessionManager.restoreSessionConversation = () => assert.fail("busy restore must be rejected");
  assert.equal((await undoAction(deps, "conversation")).ok, false);
});

test("restore attempts files then conversation, reports partial failure and returns images once", async () => {
  const deps = createDeps({ messages: [undoPrompt] });
  const calls: string[] = [];
  deps.sessionManager.restoreSessionCode = () => {
    calls.push("files");
    throw new Error("unavailable");
  };
  deps.sessionManager.restoreSessionConversation = () => {
    calls.push("conversation");
    return [];
  };
  const reply = await undoAction(deps, "code-and-conversation");
  assert.deepEqual(calls, ["files", "conversation"]);
  assert.equal(reply.ok, true);
  assert.match(reply.error, /File restore failed/);
  assert.deepEqual(reply.draft, { text: "restore me", imageUrls: ["data:image/png;base64,abc"] });
  assert.equal(reply.requestId, 42);
  assert.ok(deps.messages.some((m: any) => m.type === "loadSession"));
  deps.messages.length = 0;
  await handleWebviewMessage({ type: "ready" }, deps);
  assert.ok(!deps.messages.some((m: any) => m.type === "undoResult"));
});

test("failed conversation restore does not replace history or apply a draft", async () => {
  const deps = createDeps({ messages: [undoPrompt] });
  deps.sessionManager.restoreSessionCode = () => assert.fail("conversation-only must not restore files");
  deps.sessionManager.restoreSessionConversation = () => {
    throw new Error("read only");
  };
  const reply = await undoAction(deps, "conversation");
  assert.equal(reply.ok, false);
  assert.equal(reply.draft, undefined);
  assert.ok(!deps.messages.some((m: any) => m.type === "loadSession"));
});

test("restore rejects stale session and missing message, even if the client sends an action directly", async () => {
  const deps = createDeps({ messages: [undoPrompt] });
  deps.sessionManager.restoreSessionCode = () => assert.fail("must not restore");
  deps.sessionManager.restoreSessionConversation = () => assert.fail("must not restore");
  assert.equal((await undoAction(deps, "code-and-conversation", { sessionId: "other" })).ok, false);
  assert.equal((await undoAction(deps, "conversation", { id: "missing" })).ok, false);
  deps.sessionManager.isSessionRunning = () => true;
  assert.equal((await undoAction(deps, "conversation")).ok, false);
});

test("queue edit preserves ID, timestamp, attachments, skills and mode, and cancel preserves original", async () => {
  const deps = createDeps();
  const content = { text: "pending", imageUrls: ["image"], skills: [{ name: "test" } as any], planMode: true };
  const queued = deps.sessionManager.enqueuePrompt("session-1", content);
  const edit = await undoAction(deps, "edit", { id: queued.id });
  assert.deepEqual(edit.draft, content);
  assert.equal((await undoAction(deps, "save", { id: queued.id, ...content, text: "edited" })).ok, true);
  const updated = deps.sessionManager.listQueuedMessages("session-1")[0];
  assert.equal(updated.id, queued.id);
  assert.equal(updated.submittedAt, queued.submittedAt);
  assert.deepEqual(updated.content, { ...content, text: "edited" });
  await undoAction(deps, "edit", { id: queued.id });
  assert.equal((await undoAction(deps, "cancel", { id: queued.id })).ok, true);
  assert.deepEqual(deps.sessionManager.listQueuedMessages("session-1")[0], updated);
  assert.equal((await undoAction(deps, "remove", { id: queued.id })).ok, true);
  assert.equal(deps.sessionManager.listQueuedMessages("session-1").length, 0);
  assert.equal((await undoAction(deps, "edit", { id: queued.id })).ok, false);
});

test("empty queue edit remains editable and release/ready/session switch cancel locks", async () => {
  const deps = createDeps();
  const queued = deps.sessionManager.enqueuePrompt("session-1", { text: "pending" });
  await undoAction(deps, "edit", { id: queued.id });
  assert.equal((await undoAction(deps, "save", { id: queued.id, text: "" })).ok, false);
  releaseQueueEdit(deps.sessionManager);
  assert.equal((await undoAction(deps, "edit", { id: queued.id })).ok, true);
  await handleWebviewMessage({ type: "ready" }, deps);
  assert.equal((await undoAction(deps, "edit", { id: queued.id })).ok, true);
  await handleWebviewMessage({ type: "createNewSession" }, deps);
  deps.sessionManager.setActiveSessionId("session-1");
  assert.equal((await undoAction(deps, "edit", { id: queued.id })).ok, true);
  releaseQueueEdit(deps.sessionManager);
});

test("busy ordinary submissions enqueue while permission and question replies keep their dedicated path", async () => {
  const deps = createDeps();
  deps.sessionManager.getSession("session-1")!.status = "processing";
  deps.sessionManager.handleUserPrompt = () => assert.fail("must not start another request");
  await handleWebviewMessage({ type: "userPrompt", prompt: "queued", planMode: true, images: ["image"] }, deps);
  assert.deepEqual(deps.sessionManager.listQueuedMessages("session-1")[0].content, {
    text: "queued",
    planMode: true,
    imageUrls: ["image"],
    skills: [],
  });
  await handleWebviewMessage({ type: "userPrompt", prompt: "answer", isAnswers: true }, deps);
  assert.equal(deps.sessionManager.listQueuedMessages("session-1").length, 1);
  await handleWebviewMessage({ type: "enqueuePrompt", sessionId: "other", requestId: 7, text: "stale" }, deps);
  assert.equal(deps.sessionManager.listQueuedMessages("session-1").length, 1);
});

test("legacy history images and stable IDs reach restore and message list", async () => {
  const deps = createDeps({
    messages: [
      { ...undoPrompt, meta: null, contentParams: [{ type: "image_url", image_url: { url: "legacy-image" } }] },
    ],
  });
  loadSession("session-1", deps.sessionManager, deps.postMessage, deps.renderMarkdown);
  const loaded = deps.messages.find((m: any) => m.type === "loadSession") as any;
  assert.equal(loaded.messages[0].id, undoPrompt.id);
  assert.equal(loaded.messages[0].createTime, undoPrompt.createTime);
  const reply = await undoAction(deps, "conversation");
  assert.deepEqual(reply.draft.imageUrls, ["legacy-image"]);
});

test("question replies associate their temporary bubble with the committed message ID", async () => {
  const history: any[] = [];
  const deps = createDeps({ messages: history });
  deps.sessionManager.handleUserPrompt = async () => {
    history.push({ ...undoPrompt, id: "answer-id", content: "My answer", meta: { isAnswers: true } });
  };
  await handleWebviewMessage({ type: "userPrompt", prompt: "My answer", isAnswers: true }, deps);
  const optimistic = deps.messages.find((message: any) => message.type === "userMessage") as any;
  const committed = deps.messages.find((message: any) => message.type === "userMessageCommitted") as any;
  assert.equal(committed.optimisticId, optimistic.id);
  assert.equal(committed.message.id, "answer-id");
  const state = deps.messages.filter((message: any) => message.type === "undoState").at(-1) as any;
  assert.equal(state.targets[0].id, "answer-id");
});

test("undo opened during compaction becomes available when compaction finishes", async () => {
  const deps = createDeps({ messages: [undoPrompt] });
  let finish!: () => void;
  deps.sessionManager.compactSession = () =>
    new Promise<boolean>((resolve) => {
      finish = () => resolve(true);
    });
  const compaction = handleWebviewMessage({ type: "slashCommand", command: "compact" }, deps);
  await handleWebviewMessage({ type: "slashCommand", command: "undo" }, deps);
  assert.equal((deps.messages.filter((message: any) => message.type === "undoState").at(-1) as any).busy, true);
  finish();
  await compaction;
  assert.equal((deps.messages.filter((message: any) => message.type === "undoState").at(-1) as any).busy, false);
});

for (const fresh of [false, true]) {
  test(`${fresh ? "new" : "existing"} idle session displays its first submission as preparing, not pending`, async () => {
    const deps = createDeps();
    if (fresh) deps.sessionManager.setActiveSessionId(null);
    deps.sessionManager.handleUserPrompt = async (content) => {
      deps.sessionManager.setActiveSessionId("session-1");
      const first = deps.sessionManager.enqueuePrompt("session-1", content);
      // Core notifies as soon as it enqueues, before it assigns preparingPromptId.
      postUndoState(deps.sessionManager, deps.postMessage);
      const initial = deps.messages.filter((m: any) => m.type === "undoState").at(-1) as any;
      assert.equal(initial.preparing.id, first.id);
      assert.equal(initial.queued.filter((q: any) => q.id !== initial.preparing.id).length, 0);
      const second = deps.sessionManager.enqueuePrompt("session-1", { text: "next" });
      postUndoState(deps.sessionManager, deps.postMessage);
      const withPending = deps.messages.filter((m: any) => m.type === "undoState").at(-1) as any;
      assert.equal(withPending.preparing.id, first.id);
      assert.deepEqual(
        withPending.queued.filter((q: any) => q.id !== withPending.preparing.id).map((q: any) => q.id),
        [second.id]
      );
      deps.sessionManager.removeQueuedMessage("session-1", first.id);
      postUndoState(deps.sessionManager, deps.postMessage);
      const consumed = deps.messages.filter((m: any) => m.type === "undoState").at(-1) as any;
      assert.equal(consumed.preparing, undefined, "do not misclassify the next queued prompt as the idle submission");
      deps.sessionManager.getPreparingPromptId = () => second.id;
      postUndoState(deps.sessionManager, deps.postMessage);
      assert.equal((deps.messages.filter((m: any) => m.type === "undoState").at(-1) as any).preparing.id, second.id);
    };
    await handleWebviewMessage({ type: "userPrompt", prompt: "first" }, deps);
  });
}

test("a paused or edited initial submission returns to the pending list", async () => {
  const deps = createDeps();
  deps.sessionManager.handleUserPrompt = async (content) => {
    const first = deps.sessionManager.enqueuePrompt("session-1", content);
    postUndoState(deps.sessionManager, deps.postMessage);
    await undoAction(deps, "edit", { id: first.id });
    assert.equal((deps.messages.filter((m: any) => m.type === "undoState").at(-1) as any).preparing, undefined);
    await undoAction(deps, "cancel", { id: first.id });
    deps.sessionManager.getQueuePausedReason = () => "interrupted";
    postUndoState(deps.sessionManager, deps.postMessage);
    const paused = deps.messages.filter((m: any) => m.type === "undoState").at(-1) as any;
    assert.equal(paused.preparing, undefined);
    assert.equal(paused.queued[0].id, first.id);
  };
  await handleWebviewMessage({ type: "userPrompt", prompt: "first" }, deps);
});

test("messages submitted while busy remain pending until core prepares them", async () => {
  const deps = createDeps();
  deps.sessionManager.getSession("session-1")!.status = "processing";
  await handleWebviewMessage({ type: "userPrompt", prompt: "wait for current request" }, deps);
  const state = deps.messages.filter((m: any) => m.type === "undoState").at(-1) as any;
  assert.equal(state.preparing, undefined);
  assert.equal(state.queued.length, 1);
});
