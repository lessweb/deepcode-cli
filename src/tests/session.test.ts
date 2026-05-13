import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { SessionManager, type SessionMessage } from "../session";

const originalFetch = globalThis.fetch;
const originalHome = process.env.HOME;
const tempDirs: string[] = [];

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }

  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("SessionManager preserves structured system content when building OpenAI messages", () => {
  const manager = new SessionManager({
    projectRoot: process.cwd(),
    createOpenAIClient: () => ({
      client: null,
      model: "test-model",
      thinkingEnabled: false,
    }),
    getResolvedSettings: () => ({}),
    renderMarkdown: (text) => text,
    onAssistantMessage: () => {},
  });

  const messages: SessionMessage[] = [
    {
      id: "system-image",
      sessionId: "session-1",
      role: "system",
      content: "The read tool has loaded `pixel.png`.",
      contentParams: [
        {
          type: "image_url",
          image_url: { url: "data:image/png;base64,abc123" },
        },
      ],
      messageParams: null,
      compacted: false,
      visible: false,
      createTime: "2026-01-01T00:00:00.000Z",
      updateTime: "2026-01-01T00:00:00.000Z",
    },
  ];

  const openAIMessages = (manager as any).buildOpenAIMessages(messages) as Array<{
    role: string;
    content: unknown;
  }>;

  assert.equal(openAIMessages.length, 1);
  assert.equal(openAIMessages[0]?.role, "system");
  assert.deepEqual(openAIMessages[0]?.content, [
    { type: "text", text: "The read tool has loaded `pixel.png`." },
    {
      type: "image_url",
      image_url: { url: "data:image/png;base64,abc123" },
    },
  ]);
});

test("SessionManager preserves empty reasoning content on assistant tool calls", () => {
  const manager = new SessionManager({
    projectRoot: process.cwd(),
    createOpenAIClient: () => ({
      client: null,
      model: "test-model",
      thinkingEnabled: false,
    }),
    getResolvedSettings: () => ({}),
    renderMarkdown: (text) => text,
    onAssistantMessage: () => {},
  });

  const message = (manager as any).buildAssistantMessage(
    "session-1",
    "",
    [
      {
        id: "call-1",
        type: "function",
        function: { name: "read", arguments: "{}" },
      },
    ],
    ""
  ) as SessionMessage;

  assert.deepEqual(message.messageParams, {
    tool_calls: [
      {
        id: "call-1",
        type: "function",
        function: { name: "read", arguments: "{}" },
      },
    ],
    reasoning_content: "",
  });

  const openAIMessages = (manager as any).buildOpenAIMessages([message], true) as Array<{
    reasoning_content?: string;
  }>;

  assert.equal(openAIMessages[0]?.reasoning_content, "");
});

test("SessionManager repairs legacy thinking tool calls missing reasoning content", () => {
  const manager = new SessionManager({
    projectRoot: process.cwd(),
    createOpenAIClient: () => ({
      client: null,
      model: "test-model",
      thinkingEnabled: false,
    }),
    getResolvedSettings: () => ({}),
    renderMarkdown: (text) => text,
    onAssistantMessage: () => {},
  });

  const messages: SessionMessage[] = [
    {
      id: "assistant-tool",
      sessionId: "session-1",
      role: "assistant",
      content: "",
      contentParams: null,
      messageParams: {
        tool_calls: [
          {
            id: "call-1",
            type: "function",
            function: { name: "read", arguments: "{}" },
          },
        ],
      },
      compacted: false,
      visible: false,
      createTime: "2026-01-01T00:00:00.000Z",
      updateTime: "2026-01-01T00:00:00.000Z",
    },
  ];

  const thinkingMessages = (manager as any).buildOpenAIMessages(messages, true) as Array<{
    reasoning_content?: string;
  }>;
  const nonThinkingMessages = (manager as any).buildOpenAIMessages(messages, false) as Array<{
    reasoning_content?: string;
  }>;

  assert.equal(thinkingMessages[0]?.reasoning_content, "");
  assert.equal(Object.prototype.hasOwnProperty.call(nonThinkingMessages[0] ?? {}, "reasoning_content"), false);
});

test("SessionManager replays normal assistant messages with reasoning content in thinking mode", () => {
  const manager = new SessionManager({
    projectRoot: process.cwd(),
    createOpenAIClient: () => ({
      client: null,
      model: "test-model",
      thinkingEnabled: false,
    }),
    getResolvedSettings: () => ({}),
    renderMarkdown: (text) => text,
    onAssistantMessage: () => {},
  });

  const messages: SessionMessage[] = [
    {
      id: "assistant-final",
      sessionId: "session-1",
      role: "assistant",
      content: "Final answer",
      contentParams: null,
      messageParams: null,
      compacted: false,
      visible: true,
      createTime: "2026-01-01T00:00:00.000Z",
      updateTime: "2026-01-01T00:00:00.000Z",
    },
  ];

  const thinkingMessages = (manager as any).buildOpenAIMessages(messages, true) as Array<{
    reasoning_content?: string;
  }>;
  const nonThinkingMessages = (manager as any).buildOpenAIMessages(messages, false) as Array<{
    reasoning_content?: string;
  }>;

  assert.equal(thinkingMessages[0]?.reasoning_content, "");
  assert.equal(Object.prototype.hasOwnProperty.call(nonThinkingMessages[0] ?? {}, "reasoning_content"), false);
});

test("SessionManager normalizes legacy sessions without activeTokens to zero", () => {
  const workspace = createTempDir("deepcode-legacy-active-tokens-workspace-");
  const home = createTempDir("deepcode-legacy-active-tokens-home-");
  process.env.HOME = home;

  const projectCode = workspace.replace(/[\\/]/g, "-").replace(/:/g, "");
  const projectDir = path.join(home, ".deepcode", "projects", projectCode);
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(
    path.join(projectDir, "sessions-index.json"),
    JSON.stringify({
      version: 1,
      originalPath: workspace,
      entries: [
        {
          id: "legacy-session",
          status: "completed",
          usage: { total_tokens: 123 },
          createTime: "2026-01-01T00:00:00.000Z",
          updateTime: "2026-01-01T00:00:00.000Z",
        },
      ],
    }),
    "utf8"
  );

  const manager = createSessionManager(workspace, "machine-id-legacy");

  assert.equal(manager.getSession("legacy-session")?.activeTokens, 0);
});

test("SessionManager marks skills loaded from existing session messages", async () => {
  const workspace = createTempDir("deepcode-loaded-skills-workspace-");
  const home = createTempDir("deepcode-loaded-skills-home-");
  process.env.HOME = home;

  const skillDir = path.join(home, ".agents", "skills", "lessweb-starter");
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, "SKILL.md"),
    "---\nname: lessweb-starter\ndescription: Create Lessweb projects\n---\n# Lessweb Starter\n",
    "utf8"
  );

  const projectCode = workspace.replace(/[\\/]/g, "-").replace(/:/g, "");
  const projectDir = path.join(home, ".deepcode", "projects", projectCode);
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(
    path.join(projectDir, "loaded-session.jsonl"),
    `${JSON.stringify({
      id: "skill-message",
      sessionId: "loaded-session",
      role: "system",
      content: "Use the skill document below",
      contentParams: null,
      messageParams: null,
      compacted: false,
      visible: true,
      createTime: "2026-01-01T00:00:00.000Z",
      updateTime: "2026-01-01T00:00:00.000Z",
      meta: {
        skill: {
          name: "lessweb-starter",
          path: "~/.agents/skills/lessweb-starter/SKILL.md",
          description: "Create Lessweb projects",
          isLoaded: true,
        },
      },
    })}\n`,
    "utf8"
  );

  const manager = createSessionManager(workspace, "machine-id-loaded-skills");
  const loadedSkill = (await manager.listSkills("loaded-session")).find((skill) => skill.name === "lessweb-starter");

  assert.equal(loadedSkill?.isLoaded, true);
});

test("SessionManager lists project skills from .agents with legacy .deepcode compatibility", async () => {
  const workspace = createTempDir("deepcode-project-skills-workspace-");
  const home = createTempDir("deepcode-project-skills-home-");
  process.env.HOME = home;

  const userSkillDir = path.join(home, ".agents", "skills", "shared");
  fs.mkdirSync(userSkillDir, { recursive: true });
  fs.writeFileSync(
    path.join(userSkillDir, "SKILL.md"),
    "---\nname: shared\ndescription: User-level skill\n---\n# Shared\n",
    "utf8"
  );

  const legacyProjectSkillDir = path.join(workspace, ".deepcode", "skills", "legacy");
  fs.mkdirSync(legacyProjectSkillDir, { recursive: true });
  fs.writeFileSync(
    path.join(legacyProjectSkillDir, "SKILL.md"),
    "---\nname: legacy\ndescription: Legacy project skill\n---\n# Legacy\n",
    "utf8"
  );

  const projectAgentsSkillDir = path.join(workspace, ".agents", "skills", "shared");
  fs.mkdirSync(projectAgentsSkillDir, { recursive: true });
  fs.writeFileSync(
    path.join(projectAgentsSkillDir, "SKILL.md"),
    "---\nname: shared\ndescription: Project .agents skill\n---\n# Shared\n",
    "utf8"
  );

  const manager = createSessionManager(workspace, "machine-id-project-skills");
  const skills = await manager.listSkills();
  const legacySkill = skills.find((skill) => skill.name === "legacy");
  const sharedSkill = skills.find((skill) => skill.name === "shared");

  assert.equal(legacySkill?.path, "./.deepcode/skills/legacy/SKILL.md");
  assert.equal(legacySkill?.description, "Legacy project skill");
  assert.equal(sharedSkill?.path, "./.agents/skills/shared/SKILL.md");
  assert.equal(sharedSkill?.description, "Project .agents skill");
});

test("SessionManager dispose disconnects MCP servers", async () => {
  const workspace = createTempDir("deepcode-mcp-dispose-workspace-");
  const serverPath = path.join(workspace, "mcp-server.cjs");
  fs.writeFileSync(
    serverPath,
    `
const readline = require("readline");
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
function send(message) {
  process.stdout.write(JSON.stringify(message) + "\\n");
}
rl.on("line", (line) => {
  const request = JSON.parse(line);
  if (!("id" in request)) {
    return;
  }
  if (request.method === "initialize") {
    send({ jsonrpc: "2.0", id: request.id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} } } });
    return;
  }
  if (request.method === "tools/list") {
    send({ jsonrpc: "2.0", id: request.id, result: { tools: [{ name: "echo", inputSchema: { type: "object", properties: {} } }] } });
    return;
  }
  send({ jsonrpc: "2.0", id: request.id, result: { content: [] } });
});
`,
    "utf8"
  );

  const manager = createSessionManager(workspace, "machine-id-mcp-dispose");
  await manager.initMcpServers({ smoke: { command: process.execPath, args: [serverPath] } });

  assert.deepEqual(manager.getMcpStatus(), [{ name: "smoke", connected: true, toolCount: 1, tools: ["echo"] }]);

  manager.dispose();

  assert.deepEqual(manager.getMcpStatus(), []);
});

test("createSession stores /init and sends the active .deepcode project AGENTS path to the LLM", async () => {
  const workspace = createTempDir("deepcode-init-deepcode-workspace-");
  const home = createTempDir("deepcode-init-deepcode-home-");
  process.env.HOME = home;
  globalThis.fetch = (async () => ({ ok: true, text: async () => "" }) as Response) as typeof fetch;

  fs.mkdirSync(path.join(workspace, ".deepcode"), { recursive: true });
  fs.writeFileSync(path.join(workspace, ".deepcode", "AGENTS.md"), "deepcode project instructions", "utf8");
  fs.writeFileSync(path.join(workspace, "AGENTS.md"), "root project instructions", "utf8");

  const manager = createSessionManager(workspace, "machine-id-init-deepcode");
  (manager as any).activateSession = async () => {};

  const sessionId = await manager.createSession({ text: "/init" });
  const messages = manager.listSessionMessages(sessionId);
  const userMessage = messages.find((message) => message.role === "user");
  const openAIMessages = (manager as any).buildOpenAIMessages(messages, false) as Array<{
    role: string;
    content: string;
  }>;
  const openAIUserMessage = openAIMessages.find((message) => message.role === "user");
  const systemContents = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content ?? "");

  assert.equal(userMessage?.content, "/init");
  assert.match(openAIUserMessage?.content ?? "", /Update \.\/\.deepcode\/AGENTS\.md/);
  assert.doesNotMatch(openAIUserMessage?.content ?? "", /Update \.\/AGENTS\.md/);
  assert.ok(systemContents.includes("deepcode project instructions"));
  assert.ok(!systemContents.includes("root project instructions"));
});

test("replySession stores /init and sends the active root project AGENTS path to the LLM", async () => {
  const workspace = createTempDir("deepcode-init-root-workspace-");
  const home = createTempDir("deepcode-init-root-home-");
  process.env.HOME = home;
  globalThis.fetch = (async () => ({ ok: true, text: async () => "" }) as Response) as typeof fetch;

  fs.writeFileSync(path.join(workspace, "AGENTS.md"), "root project instructions", "utf8");

  const manager = createSessionManager(workspace, "machine-id-init-root");
  (manager as any).activateSession = async () => {};

  const sessionId = await manager.createSession({ text: "first prompt" });
  await manager.replySession(sessionId, { text: "/init" });
  const messages = manager.listSessionMessages(sessionId);
  const userMessages = messages.filter((message) => message.role === "user");
  const replyMessage = userMessages[userMessages.length - 1];
  const openAIMessages = (manager as any).buildOpenAIMessages(messages, false) as Array<{
    role: string;
    content: string;
  }>;
  const openAIUserMessages = openAIMessages.filter((message) => message.role === "user");
  const openAIReplyMessage = openAIUserMessages[openAIUserMessages.length - 1];

  assert.equal(replyMessage?.content, "/init");
  assert.match(openAIReplyMessage?.content ?? "", /Update \.\/AGENTS\.md/);
});

test("createSession stores /init and sends generate prompt when no project AGENTS file is effective", async () => {
  const workspace = createTempDir("deepcode-init-generate-workspace-");
  const home = createTempDir("deepcode-init-generate-home-");
  process.env.HOME = home;
  globalThis.fetch = (async () => ({ ok: true, text: async () => "" }) as Response) as typeof fetch;

  fs.mkdirSync(path.join(home, ".deepcode"), { recursive: true });
  fs.writeFileSync(path.join(home, ".deepcode", "AGENTS.md"), "user instructions", "utf8");

  const manager = createSessionManager(workspace, "machine-id-init-generate");
  (manager as any).activateSession = async () => {};

  const sessionId = await manager.createSession({ text: "/init" });
  const messages = manager.listSessionMessages(sessionId);
  const userMessage = messages.find((message) => message.role === "user");
  const openAIMessages = (manager as any).buildOpenAIMessages(messages, false) as Array<{
    role: string;
    content: string;
  }>;
  const openAIUserMessage = openAIMessages.find((message) => message.role === "user");

  assert.equal(userMessage?.content, "/init");
  assert.match(openAIUserMessage?.content ?? "", /Generate a file named \.\/AGENTS\.md/);
  assert.doesNotMatch(openAIUserMessage?.content ?? "", /Update \.\/AGENTS\.md/);
});

test("createSession reports a new prompt with the machineId token", async () => {
  const workspace = createTempDir("deepcode-session-workspace-");
  const home = createTempDir("deepcode-session-home-");
  process.env.HOME = home;

  const fetchCalls: Array<{ input: string | URL; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    fetchCalls.push({ input, init });
    return {
      ok: true,
      text: async () => "",
    } as Response;
  }) as typeof fetch;

  const manager = createSessionManager(workspace, "machine-id-123");
  const activatedSessionIds: string[] = [];
  (manager as any).activateSession = async (sessionId: string) => {
    activatedSessionIds.push(sessionId);
  };

  const sessionId = await manager.createSession({ text: "hello world" });
  await flushPromises();

  assert.equal(activatedSessionIds.length, 1);
  assert.equal(activatedSessionIds[0], sessionId);
  assert.equal(fetchCalls.length, 1);
  assert.equal(String(fetchCalls[0].input), "https://deepcode.vegamo.cn/api/plugin/new");
  assert.equal(fetchCalls[0].init?.method, "POST");
  assert.deepEqual(JSON.parse(String(fetchCalls[0].init?.body)), {});
  assert.equal((fetchCalls[0].init?.headers as Record<string, string>).Token, "machine-id-123");
});

test("replySession reports a new prompt with the machineId token", async () => {
  const workspace = createTempDir("deepcode-reply-workspace-");
  const home = createTempDir("deepcode-reply-home-");
  process.env.HOME = home;

  const fetchCalls: Array<{ input: string | URL; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    fetchCalls.push({ input, init });
    return {
      ok: true,
      text: async () => "",
    } as Response;
  }) as typeof fetch;

  const manager = createSessionManager(workspace, "machine-id-456");
  (manager as any).activateSession = async () => {};

  const sessionId = await manager.createSession({ text: "first prompt" });
  await flushPromises();
  fetchCalls.length = 0;

  await manager.replySession(sessionId, { text: "second prompt" });
  await flushPromises();

  assert.equal(fetchCalls.length, 1);
  assert.equal(String(fetchCalls[0].input), "https://deepcode.vegamo.cn/api/plugin/new");
  assert.equal(fetchCalls[0].init?.method, "POST");
  assert.deepEqual(JSON.parse(String(fetchCalls[0].init?.body)), {});
  assert.equal((fetchCalls[0].init?.headers as Record<string, string>).Token, "machine-id-456");
});

test("replySession preserves raw session messages when a previous tool call is pending", async () => {
  const workspace = createTempDir("deepcode-pending-tool-workspace-");
  const home = createTempDir("deepcode-pending-tool-home-");
  process.env.HOME = home;

  globalThis.fetch = (async () =>
    ({
      ok: true,
      text: async () => "",
    }) as Response) as typeof fetch;

  const manager = createSessionManager(workspace, "machine-id-pending-tool");
  (manager as any).activateSession = async () => {};

  const sessionId = await manager.createSession({ text: "first prompt" });
  const assistantMessage = (manager as any).buildAssistantMessage(
    sessionId,
    "I will run a tool.",
    [
      {
        id: "call-1",
        type: "function",
        function: { name: "bash", arguments: '{"command":"sleep 100"}' },
      },
    ],
    ""
  ) as SessionMessage;
  (manager as any).appendSessionMessage(sessionId, assistantMessage);

  await manager.replySession(sessionId, { text: "second prompt" });

  const messages = manager.listSessionMessages(sessionId);
  const assistantIndex = messages.findIndex((message) => message.id === assistantMessage.id);
  assert.notEqual(assistantIndex, -1);
  assert.equal(messages[assistantIndex + 1]?.role, "user");
  assert.equal(messages[assistantIndex + 1]?.content, "second prompt");
  assert.equal(
    messages.some((message) => String(message.content).includes("Previous tool call did not complete.")),
    false
  );
});

test("buildOpenAIMessages inserts interrupted results for missing tool messages", () => {
  const manager = createSessionManager(process.cwd(), "machine-id-missing-tool");
  const assistantMessage = (manager as any).buildAssistantMessage(
    "session-1",
    "I will run a tool.",
    [
      {
        id: "call-1",
        type: "function",
        function: { name: "bash", arguments: '{"command":"sleep 100"}' },
      },
    ],
    ""
  ) as SessionMessage;
  const userMessage = buildTestMessage("user-after-tool-call", "session-1", "user", "continue");

  const openAIMessages = (manager as any).buildOpenAIMessages([assistantMessage, userMessage], false) as Array<{
    role: string;
    content: string;
    tool_call_id?: string;
  }>;

  assert.equal(openAIMessages.length, 3);
  assert.equal(openAIMessages[0]?.role, "assistant");
  assert.equal(openAIMessages[1]?.role, "tool");
  assert.equal(openAIMessages[1]?.tool_call_id, "call-1");
  assert.match(openAIMessages[1]?.content ?? "", /Previous tool call did not complete/);
  assert.equal(openAIMessages[2]?.role, "user");
});

test("buildOpenAIMessages keeps only the first non-interrupted tool result for a tool call", () => {
  const manager = createSessionManager(process.cwd(), "machine-id-duplicate-tool");
  const assistantMessage = (manager as any).buildAssistantMessage(
    "session-1",
    "",
    [
      {
        id: "call-1",
        type: "function",
        function: { name: "bash", arguments: '{"command":"date"}' },
      },
    ],
    ""
  ) as SessionMessage;
  const successToolMessage = (manager as any).buildToolMessage(
    "session-1",
    "call-1",
    JSON.stringify({ ok: true, name: "bash", output: "2026-05-07 星期四\n" }),
    { name: "bash", arguments: '{"command":"date"}' }
  ) as SessionMessage;
  const interruptedToolMessage = (manager as any).buildToolMessage(
    "session-1",
    "call-1",
    JSON.stringify({
      ok: false,
      name: "bash",
      error: "Previous tool call did not complete.",
      metadata: { interrupted: true },
    }),
    { name: "bash", arguments: '{"command":"date"}' }
  ) as SessionMessage;

  const openAIMessages = (manager as any).buildOpenAIMessages(
    [assistantMessage, successToolMessage, interruptedToolMessage],
    false
  ) as Array<{ role: string; content: string; tool_call_id?: string }>;
  const toolMessages = openAIMessages.filter((message) => message.role === "tool");

  assert.equal(toolMessages.length, 1);
  assert.equal(toolMessages[0]?.tool_call_id, "call-1");
  assert.match(toolMessages[0]?.content ?? "", /2026-05-07/);
  assert.doesNotMatch(toolMessages[0]?.content ?? "", /Previous tool call did not complete/);
});

test("buildOpenAIMessages prefers a later real tool result over an earlier interrupted placeholder", () => {
  const manager = createSessionManager(process.cwd(), "machine-id-prefer-real-tool");
  const assistantMessage = (manager as any).buildAssistantMessage(
    "session-1",
    "",
    [
      {
        id: "call-1",
        type: "function",
        function: { name: "bash", arguments: '{"command":"date"}' },
      },
    ],
    ""
  ) as SessionMessage;
  const interruptedToolMessage = (manager as any).buildToolMessage(
    "session-1",
    "call-1",
    JSON.stringify({
      ok: false,
      name: "bash",
      error: "Previous tool call did not complete.",
      metadata: { interrupted: true },
    }),
    { name: "bash", arguments: '{"command":"date"}' }
  ) as SessionMessage;
  const successToolMessage = (manager as any).buildToolMessage(
    "session-1",
    "call-1",
    JSON.stringify({ ok: true, name: "bash", output: "real result" }),
    { name: "bash", arguments: '{"command":"date"}' }
  ) as SessionMessage;

  const openAIMessages = (manager as any).buildOpenAIMessages(
    [assistantMessage, interruptedToolMessage, successToolMessage],
    false
  ) as Array<{ role: string; content: string; tool_call_id?: string }>;
  const toolMessages = openAIMessages.filter((message) => message.role === "tool");

  assert.equal(toolMessages.length, 1);
  assert.equal(toolMessages[0]?.tool_call_id, "call-1");
  assert.match(toolMessages[0]?.content ?? "", /real result/);
});

test("buildOpenAIMessages ignores orphan tool messages", () => {
  const manager = createSessionManager(process.cwd(), "machine-id-orphan-tool");
  const userMessage = buildTestMessage("user-1", "session-1", "user", "hello");
  const orphanToolMessage = (manager as any).buildToolMessage(
    "session-1",
    "call-orphan",
    JSON.stringify({ ok: true, name: "bash", output: "orphan" }),
    { name: "bash", arguments: '{"command":"echo orphan"}' }
  ) as SessionMessage;

  const openAIMessages = (manager as any).buildOpenAIMessages([userMessage, orphanToolMessage], false) as Array<{
    role: string;
  }>;

  assert.deepEqual(
    openAIMessages.map((message) => message.role),
    ["user"]
  );
});

test("buildOpenAIMessages moves a later paired tool message behind its assistant", () => {
  const manager = createSessionManager(process.cwd(), "machine-id-later-tool");
  const assistantMessage = (manager as any).buildAssistantMessage(
    "session-1",
    "",
    [
      {
        id: "call-1",
        type: "function",
        function: { name: "bash", arguments: '{"command":"date"}' },
      },
    ],
    ""
  ) as SessionMessage;
  const userMessage = buildTestMessage("user-between", "session-1", "user", "continue");
  const toolMessage = (manager as any).buildToolMessage(
    "session-1",
    "call-1",
    JSON.stringify({ ok: true, name: "bash", output: "paired later" }),
    { name: "bash", arguments: '{"command":"date"}' }
  ) as SessionMessage;

  const openAIMessages = (manager as any).buildOpenAIMessages(
    [assistantMessage, userMessage, toolMessage],
    false
  ) as Array<{ role: string; content: string }>;

  assert.deepEqual(
    openAIMessages.map((message) => message.role),
    ["assistant", "tool", "user"]
  );
  assert.match(openAIMessages[1]?.content ?? "", /paired later/);
});

test("buildOpenAIMessages preserves a complete multi-tool happy path", () => {
  const manager = createSessionManager(process.cwd(), "machine-id-multi-tool-happy");
  const assistantMessage = (manager as any).buildAssistantMessage(
    "session-1",
    "",
    [
      {
        id: "call-1",
        type: "function",
        function: { name: "read", arguments: '{"file_path":"/tmp/a.txt"}' },
      },
      {
        id: "call-2",
        type: "function",
        function: { name: "bash", arguments: '{"command":"pwd"}' },
      },
    ],
    ""
  ) as SessionMessage;
  const firstToolMessage = (manager as any).buildToolMessage(
    "session-1",
    "call-1",
    JSON.stringify({ ok: true, name: "read", content: "file content" }),
    { name: "read", arguments: '{"file_path":"/tmp/a.txt"}' }
  ) as SessionMessage;
  const secondToolMessage = (manager as any).buildToolMessage(
    "session-1",
    "call-2",
    JSON.stringify({ ok: true, name: "bash", output: "/tmp\n" }),
    { name: "bash", arguments: '{"command":"pwd"}' }
  ) as SessionMessage;
  const userMessage = buildTestMessage("user-after-complete-tools", "session-1", "user", "thanks");

  const openAIMessages = (manager as any).buildOpenAIMessages(
    [assistantMessage, firstToolMessage, secondToolMessage, userMessage],
    false
  ) as Array<{ role: string; content: string; tool_call_id?: string }>;

  assert.deepEqual(
    openAIMessages.map((message) => message.role),
    ["assistant", "tool", "tool", "user"]
  );
  assert.deepEqual(
    openAIMessages.filter((message) => message.role === "tool").map((message) => message.tool_call_id),
    ["call-1", "call-2"]
  );
  assert.equal(
    openAIMessages.some((message) => message.content.includes("Previous tool call did not complete.")),
    false
  );
});

test("buildOpenAIMessages preserves a real failed tool result", () => {
  const manager = createSessionManager(process.cwd(), "machine-id-real-failed-tool");
  const assistantMessage = (manager as any).buildAssistantMessage(
    "session-1",
    "",
    [
      {
        id: "call-1",
        type: "function",
        function: { name: "bash", arguments: '{"command":"false"}' },
      },
    ],
    ""
  ) as SessionMessage;
  const failedToolMessage = (manager as any).buildToolMessage(
    "session-1",
    "call-1",
    JSON.stringify({ ok: false, name: "bash", error: "Command failed", metadata: { exitCode: 1 } }),
    { name: "bash", arguments: '{"command":"false"}' }
  ) as SessionMessage;

  const openAIMessages = (manager as any).buildOpenAIMessages([assistantMessage, failedToolMessage], false) as Array<{
    role: string;
    content: string;
    tool_call_id?: string;
  }>;

  assert.deepEqual(
    openAIMessages.map((message) => message.role),
    ["assistant", "tool"]
  );
  assert.equal(openAIMessages[1]?.tool_call_id, "call-1");
  assert.match(openAIMessages[1]?.content ?? "", /Command failed/);
  assert.doesNotMatch(openAIMessages[1]?.content ?? "", /Previous tool call did not complete/);
});

test("buildOpenAIMessages repairs mixed missing duplicate and orphan tool messages", () => {
  const manager = createSessionManager(process.cwd(), "machine-id-mixed-tool-badcase");
  const assistantMessage = (manager as any).buildAssistantMessage(
    "session-1",
    "",
    [
      {
        id: "call-1",
        type: "function",
        function: { name: "read", arguments: '{"file_path":"/tmp/missing.txt"}' },
      },
      {
        id: "call-2",
        type: "function",
        function: { name: "bash", arguments: '{"command":"pwd"}' },
      },
    ],
    ""
  ) as SessionMessage;
  const orphanToolMessage = (manager as any).buildToolMessage(
    "session-1",
    "call-orphan",
    JSON.stringify({ ok: true, name: "bash", output: "orphan" }),
    { name: "bash", arguments: '{"command":"echo orphan"}' }
  ) as SessionMessage;
  const pairedToolMessage = (manager as any).buildToolMessage(
    "session-1",
    "call-2",
    JSON.stringify({ ok: true, name: "bash", output: "/tmp\n" }),
    { name: "bash", arguments: '{"command":"pwd"}' }
  ) as SessionMessage;
  const duplicateToolMessage = (manager as any).buildToolMessage(
    "session-1",
    "call-2",
    JSON.stringify({ ok: true, name: "bash", output: "duplicate" }),
    { name: "bash", arguments: '{"command":"pwd"}' }
  ) as SessionMessage;
  const userMessage = buildTestMessage("user-after-mixed-tools", "session-1", "user", "continue");

  const openAIMessages = (manager as any).buildOpenAIMessages(
    [assistantMessage, orphanToolMessage, pairedToolMessage, duplicateToolMessage, userMessage],
    false
  ) as Array<{ role: string; content: string; tool_call_id?: string }>;
  const toolMessages = openAIMessages.filter((message) => message.role === "tool");

  assert.deepEqual(
    openAIMessages.map((message) => message.role),
    ["assistant", "tool", "tool", "user"]
  );
  assert.deepEqual(
    toolMessages.map((message) => message.tool_call_id),
    ["call-1", "call-2"]
  );
  assert.match(toolMessages[0]?.content ?? "", /Previous tool call did not complete/);
  assert.match(toolMessages[1]?.content ?? "", /\/tmp/);
  assert.equal(
    openAIMessages.some((message) => message.content.includes("orphan")),
    false
  );
  assert.equal(
    openAIMessages.some((message) => message.content.includes("duplicate")),
    false
  );
});

test("buildOpenAIMessages ignores tool messages that appear before their assistant", () => {
  const manager = createSessionManager(process.cwd(), "machine-id-tool-before-assistant");
  const earlyToolMessage = (manager as any).buildToolMessage(
    "session-1",
    "call-1",
    JSON.stringify({ ok: true, name: "bash", output: "too early" }),
    { name: "bash", arguments: '{"command":"date"}' }
  ) as SessionMessage;
  const assistantMessage = (manager as any).buildAssistantMessage(
    "session-1",
    "",
    [
      {
        id: "call-1",
        type: "function",
        function: { name: "bash", arguments: '{"command":"date"}' },
      },
    ],
    ""
  ) as SessionMessage;

  const openAIMessages = (manager as any).buildOpenAIMessages([earlyToolMessage, assistantMessage], false) as Array<{
    role: string;
    content: string;
    tool_call_id?: string;
  }>;

  assert.deepEqual(
    openAIMessages.map((message) => message.role),
    ["assistant", "tool"]
  );
  assert.equal(openAIMessages[1]?.tool_call_id, "call-1");
  assert.match(openAIMessages[1]?.content ?? "", /Previous tool call did not complete/);
  assert.doesNotMatch(openAIMessages[1]?.content ?? "", /too early/);
});

test("SessionManager accumulates response usage while active tokens track the latest response", async () => {
  const workspace = createTempDir("deepcode-usage-workspace-");
  const home = createTempDir("deepcode-usage-home-");
  process.env.HOME = home;

  const responses = [
    createChatResponse("first", {
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
      prompt_tokens_details: { cached_tokens: 7 },
      completion_tokens_details: { reasoning_tokens: 3 },
      prompt_cache_hit_tokens: 7,
      prompt_cache_miss_tokens: 3,
    }),
    createChatResponse("second", {
      prompt_tokens: 20,
      completion_tokens: 7,
      total_tokens: 27,
      prompt_tokens_details: { cached_tokens: 11 },
      completion_tokens_details: { reasoning_tokens: 4 },
      prompt_cache_hit_tokens: 11,
      prompt_cache_miss_tokens: 9,
    }),
  ];
  const manager = createMockedClientSessionManager(workspace, responses);

  const sessionId = await manager.createSession({ text: "" });
  await manager.replySession(sessionId, { text: "" });

  const session = manager.getSession(sessionId);
  const usage = session?.usage as Record<string, any>;
  assert.equal(session?.activeTokens, 27);
  assert.equal(usage.prompt_tokens, 30);
  assert.equal(usage.completion_tokens, 12);
  assert.equal(usage.total_tokens, 42);
  assert.equal(usage.prompt_tokens_details.cached_tokens, 18);
  assert.equal(usage.completion_tokens_details.reasoning_tokens, 7);
  assert.equal(usage.prompt_cache_hit_tokens, 18);
  assert.equal(usage.prompt_cache_miss_tokens, 12);
});

test("SessionManager resets active tokens to latest post-compaction response usage", async () => {
  const workspace = createTempDir("deepcode-compact-usage-workspace-");
  const home = createTempDir("deepcode-compact-usage-home-");
  process.env.HOME = home;

  const responses = [
    createChatResponse("large", {
      prompt_tokens: 139_990,
      completion_tokens: 10,
      total_tokens: 140_000,
    }),
    createChatResponse("summary", {
      prompt_tokens: 100,
      completion_tokens: 23,
      total_tokens: 123,
    }),
    createChatResponse("after compact", {
      prompt_tokens: 5,
      completion_tokens: 2,
      total_tokens: 7,
    }),
  ];
  const manager = createMockedClientSessionManager(workspace, responses);

  const sessionId = await manager.createSession({ text: "" });
  assert.equal(manager.getSession(sessionId)?.activeTokens, 140_000);

  await manager.replySession(sessionId, { text: "" });

  const session = manager.getSession(sessionId);
  const usage = session?.usage as Record<string, any>;
  assert.equal(session?.activeTokens, 7);
  assert.equal(usage.prompt_tokens, 140_095);
  assert.equal(usage.completion_tokens, 35);
  assert.equal(usage.total_tokens, 140_130);
});

test("SessionManager streams chat completions and counts reasoning progress", async () => {
  const workspace = createTempDir("deepcode-stream-workspace-");
  const home = createTempDir("deepcode-stream-home-");
  process.env.HOME = home;

  const progressEvents: Array<{
    phase: string;
    estimatedTokens: number;
    formattedTokens: string;
  }> = [];
  const client = {
    chat: {
      completions: {
        create: async (request: Record<string, unknown>) => {
          assert.equal(request.stream, true);
          assert.deepEqual(request.stream_options, { include_usage: true });
          return createChatStreamResponse([
            { choices: [{ delta: { reasoning_content: "思考" } }] },
            { choices: [{ delta: { content: "hello" } }] },
            {
              choices: [],
              usage: {
                prompt_tokens: 2,
                completion_tokens: 3,
                total_tokens: 5,
              },
            },
          ]);
        },
      },
    },
  };

  const manager = new SessionManager({
    projectRoot: workspace,
    createOpenAIClient: () => ({
      client: client as any,
      model: "test-model",
      baseURL: "https://api.deepseek.com",
      thinkingEnabled: false,
    }),
    getResolvedSettings: () => ({}),
    renderMarkdown: (text) => text,
    onAssistantMessage: () => {},
    onLlmStreamProgress: (progress) => {
      progressEvents.push({
        phase: progress.phase,
        estimatedTokens: progress.estimatedTokens,
        formattedTokens: progress.formattedTokens,
      });
    },
  });

  const sessionId = await manager.createSession({ text: "" });
  const assistantMessage = manager.listSessionMessages(sessionId).find((message) => message.role === "assistant");

  assert.equal(assistantMessage?.content, "hello");
  assert.equal((assistantMessage?.messageParams as any)?.reasoning_content, "思考");
  assert.equal(manager.getSession(sessionId)?.activeTokens, 5);
  assert.deepEqual(
    progressEvents.map((event) => event.phase),
    ["start", "update", "update", "end"]
  );
  assert.equal(progressEvents[1]?.estimatedTokens, 1);
  assert.equal(progressEvents[2]?.formattedTokens, "3");
});

test("SessionManager cancels skill matching before a session is created", async () => {
  const workspace = createTempDir("deepcode-skill-abort-workspace-");
  const home = createTempDir("deepcode-skill-abort-home-");
  process.env.HOME = home;

  const skillDir = path.join(home, ".agents", "skills", "demo");
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), "---\nname: demo\ndescription: Demo skill\n---\n# Demo\n", "utf8");

  // eslint-disable-next-line prefer-const -- must be declared before client which references it
  let manager: SessionManager;
  const client = {
    chat: {
      completions: {
        create: async (_request: Record<string, unknown>, options?: { signal?: AbortSignal }) => {
          return new Promise((_resolve, reject) => {
            const signal = options?.signal;
            signal?.addEventListener("abort", () => reject(new APIUserAbortError()), { once: true });
            queueMicrotask(() => manager.interruptActiveSession());
          });
        },
      },
    },
  };

  manager = createMockedClientSessionManagerWithClient(workspace, client);

  await manager.handleUserPrompt({ text: "please use demo" });

  assert.equal(manager.listSessions().length, 0);
});

test("SessionManager treats OpenAI APIUserAbortError as interrupted", async () => {
  const workspace = createTempDir("deepcode-api-abort-workspace-");
  const home = createTempDir("deepcode-api-abort-home-");
  process.env.HOME = home;

  let manager: SessionManager;
  const client = {
    chat: {
      completions: {
        create: async (_request: Record<string, unknown>, options?: { signal?: AbortSignal }) => {
          return new Promise((_resolve, reject) => {
            const signal = options?.signal;
            signal?.addEventListener("abort", () => reject(new APIUserAbortError()), { once: true });
          });
        },
      },
    },
  };

  // eslint-disable-next-line prefer-const -- declared before client, assigned after
  manager = new SessionManager({
    projectRoot: workspace,
    createOpenAIClient: () => ({
      client: client as any,
      model: "test-model",
      baseURL: "https://api.deepseek.com",
      thinkingEnabled: false,
    }),
    getResolvedSettings: () => ({}),
    renderMarkdown: (text) => text,
    onAssistantMessage: () => {},
    onSessionEntryUpdated: (entry) => {
      if (entry.status === "processing") {
        queueMicrotask(() => manager.interruptActiveSession());
      }
    },
  });

  await manager.handleUserPrompt({ text: "" });

  const activeSessionId = manager.getActiveSessionId();
  assert.ok(activeSessionId);
  const session = manager.getSession(activeSessionId);
  assert.equal(session?.status, "interrupted");
  assert.equal(session?.failReason, "interrupted");
});

function createSessionManager(projectRoot: string, machineId: string): SessionManager {
  return new SessionManager({
    projectRoot,
    createOpenAIClient: () => ({
      client: null,
      model: "test-model",
      baseURL: "https://api.deepseek.com",
      thinkingEnabled: false,
      machineId,
    }),
    getResolvedSettings: () => ({}),
    renderMarkdown: (text) => text,
    onAssistantMessage: () => {},
  });
}

function createMockedClientSessionManager(projectRoot: string, responses: unknown[]): SessionManager {
  const client = {
    chat: {
      completions: {
        create: async () => {
          const response = responses.shift();
          assert.ok(response, "expected a queued chat response");
          return response;
        },
      },
    },
  };

  return new SessionManager({
    projectRoot,
    createOpenAIClient: () => ({
      client: client as any,
      model: "test-model",
      baseURL: "https://api.deepseek.com",
      thinkingEnabled: false,
    }),
    getResolvedSettings: () => ({}),
    renderMarkdown: (text) => text,
    onAssistantMessage: () => {},
  });
}

function createMockedClientSessionManagerWithClient(projectRoot: string, client: unknown): SessionManager {
  return new SessionManager({
    projectRoot,
    createOpenAIClient: () => ({
      client: client as any,
      model: "test-model",
      baseURL: "https://api.deepseek.com",
      thinkingEnabled: false,
    }),
    getResolvedSettings: () => ({}),
    renderMarkdown: (text) => text,
    onAssistantMessage: () => {},
  });
}

class APIUserAbortError extends Error {}

function createChatResponse(content: string, usage: Record<string, unknown>): unknown {
  return {
    choices: [{ message: { content } }],
    usage,
  };
}

function buildTestMessage(
  id: string,
  sessionId: string,
  role: SessionMessage["role"],
  content: string
): SessionMessage {
  return {
    id,
    sessionId,
    role,
    content,
    contentParams: null,
    messageParams: null,
    compacted: false,
    visible: true,
    createTime: "2026-01-01T00:00:00.000Z",
    updateTime: "2026-01-01T00:00:00.000Z",
  };
}

async function* createChatStreamResponse(chunks: Record<string, unknown>[]): AsyncGenerator<Record<string, unknown>> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

function createTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function flushPromises(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}
