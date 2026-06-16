import { test } from "node:test";
import assert from "node:assert/strict";
import { handleWebviewMessage, loadSession, type ProviderDeps } from "../provider.js";

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

  return {
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

test("userPrompt with text sends userMessage and loading states", async () => {
  const deps = createDeps();
  await handleWebviewMessage({ type: "userPrompt", prompt: "hello" }, deps);

  const types = deps.messages.map((m: any) => m.type);
  assert.ok(types.includes("userMessage"), `Expected userMessage, got: ${types.join(", ")}`);
  assert.ok(types.includes("loading"), `Expected loading, got: ${types.join(", ")}`);

  // Should end with loading: false
  const lastLoading = [...deps.messages].reverse().find((m: any) => m.type === "loading");
  assert.deepEqual(lastLoading, { type: "loading", value: false });
});

test("userPrompt with images sends userMessage with image placeholder", async () => {
  const deps = createDeps();
  await handleWebviewMessage({ type: "userPrompt", prompt: "", images: ["data:image/png;base64,abc"] }, deps);

  const userMsg = deps.messages.find((m: any) => m.type === "userMessage");
  assert.ok(userMsg, "Should send userMessage for images");
  assert.equal((userMsg as any).content, "粘贴的图像");
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
  await handleWebviewMessage({ type: "userPrompt", prompt: "hello" }, deps);

  const types = deps.messages.map((m: any) => m.type);
  assert.ok(types.includes("sessionStatus"), `Expected sessionStatus, got: ${types.join(", ")}`);
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
  assert.deepEqual(lastLoading, { type: "loading", value: false });
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
  assert.ok(Array.isArray(msg.sessions), "sessions should be an array");
  assert.ok(Array.isArray(msg.messages), "messages should be an array");
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
