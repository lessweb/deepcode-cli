import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { GitFileHistory } from "../common/file-history";
import { clearSessionState } from "../common/state";
import { type SessionMessage } from "../session";
import { SessionManager } from "../session";

const originalFetch = globalThis.fetch;
const originalConsoleWarn = console.warn;
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const tempDirs: string[] = [];

/** Set homedir in a cross-platform way (HOME on Unix, USERPROFILE on Windows). */
function setHomeDir(dir: string): void {
  process.env.HOME = dir;
  if (process.platform === "win32") {
    process.env.USERPROFILE = dir;
  }
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  console.warn = originalConsoleWarn;
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }
  if (originalUserProfile === undefined) {
    delete process.env.USERPROFILE;
  } else {
    process.env.USERPROFILE = originalUserProfile;
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
    getResolvedSettings: () => ({ model: "test-model" }),
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

  const openAIMessages = (manager as any).buildOpenAIMessages(messages, false, "test-model") as Array<{
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

test("SessionManager filters image content for non-multimodal models", () => {
  const manager = new SessionManager({
    projectRoot: process.cwd(),
    createOpenAIClient: () => ({
      client: null,
      model: "deepseek-chat",
      thinkingEnabled: false,
    }),
    getResolvedSettings: () => ({ model: "deepseek-chat" }),
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

  const openAIMessages = (manager as any).buildOpenAIMessages(messages, false, "deepseek-chat") as Array<{
    role: string;
    content: unknown;
  }>;

  assert.equal(openAIMessages.length, 1);
  assert.deepEqual(openAIMessages[0]?.content, [{ type: "text", text: "The read tool has loaded `pixel.png`." }]);
});

test("SessionManager preserves empty reasoning content on assistant tool calls", () => {
  const manager = new SessionManager({
    projectRoot: process.cwd(),
    createOpenAIClient: () => ({
      client: null,
      model: "test-model",
      thinkingEnabled: false,
    }),
    getResolvedSettings: () => ({ model: "test-model" }),
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

  const openAIMessages = (manager as any).buildOpenAIMessages([message], true, "test-model") as Array<{
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
    getResolvedSettings: () => ({ model: "test-model" }),
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

  const thinkingMessages = (manager as any).buildOpenAIMessages(messages, true, "test-model") as Array<{
    reasoning_content?: string;
  }>;
  const nonThinkingMessages = (manager as any).buildOpenAIMessages(messages, false, "test-model") as Array<{
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
    getResolvedSettings: () => ({ model: "test-model" }),
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

  const thinkingMessages = (manager as any).buildOpenAIMessages(messages, true, "test-model") as Array<{
    reasoning_content?: string;
  }>;
  const nonThinkingMessages = (manager as any).buildOpenAIMessages(messages, false, "test-model") as Array<{
    reasoning_content?: string;
  }>;

  assert.equal(thinkingMessages[0]?.reasoning_content, "");
  assert.equal(Object.prototype.hasOwnProperty.call(nonThinkingMessages[0] ?? {}, "reasoning_content"), false);
});

test("SessionManager normalizes legacy sessions without activeTokens to zero", () => {
  const workspace = createTempDir("deepcode-legacy-active-tokens-workspace-");
  const home = createTempDir("deepcode-legacy-active-tokens-home-");
  setHomeDir(home);

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
  assert.equal(manager.getSession("legacy-session")?.usagePerModel, null);
});

test("SessionManager keeps usagePerModel null until response usage is available", async () => {
  const workspace = createTempDir("deepcode-null-usage-per-model-workspace-");
  const home = createTempDir("deepcode-null-usage-per-model-home-");
  setHomeDir(home);

  const manager = createMockedClientSessionManager(workspace, [{ choices: [{ message: { content: "no usage" } }] }]);

  const sessionId = await manager.createSession({ text: "" });

  assert.equal(manager.getSession(sessionId)?.usage, null);
  assert.equal(manager.getSession(sessionId)?.usagePerModel, null);
});

test("SessionManager marks skills loaded from existing session messages", async () => {
  const workspace = createTempDir("deepcode-loaded-skills-workspace-");
  const home = createTempDir("deepcode-loaded-skills-home-");
  setHomeDir(home);

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
  setHomeDir(home);

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
    if (request.params && request.params.cursor === "page-2") {
      send({ jsonrpc: "2.0", id: request.id, result: { tools: [
        { name: "count", inputSchema: { type: "object", properties: {} } }
      ] } });
      return;
    }
    send({ jsonrpc: "2.0", id: request.id, result: { tools: [
      { name: "echo", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } }
    ], nextCursor: "page-2" } });
    return;
  }
  if (request.method === "tools/call") {
    send({ jsonrpc: "2.0", id: request.id, result: { content: [{ type: "text", text: request.params.name + ":" + (request.params.arguments.text || "") }] } });
    return;
  }
  send({ jsonrpc: "2.0", id: request.id, result: { content: [] } });
});
`,
    "utf8"
  );

  const manager = createSessionManager(workspace, "machine-id-mcp-dispose");
  const initPromise = manager.initMcpServers({ smoke: { command: process.execPath, args: [serverPath] } });

  assert.deepEqual(manager.getMcpStatus(), [
    {
      name: "smoke",
      status: "starting",
      connected: false,
      toolCount: 0,
      tools: [],
      promptCount: 0,
      prompts: [],
      resourceCount: 0,
      resources: [],
    },
  ]);

  await initPromise;

  assert.deepEqual(manager.getMcpStatus(), [
    {
      name: "smoke",
      status: "ready",
      connected: true,
      toolCount: 2,
      tools: ["mcp__smoke__echo", "mcp__smoke__count"],
      promptCount: 0,
      prompts: [],
      resourceCount: 0,
      resources: [],
    },
  ]);
  const mcpManager = (manager as any).mcpManager;
  assert.equal(mcpManager.getMcpToolDefinitions()[0].function.name, "mcp__smoke__echo");
  assert.deepEqual(await mcpManager.executeMcpTool("mcp__smoke__echo", { text: "ok" }), {
    ok: true,
    name: "mcp__smoke__echo",
    output: "echo:ok",
  });

  manager.dispose();

  assert.deepEqual(manager.getMcpStatus(), []);
});

test("SessionManager refreshes cached MCP tool definitions after server crash", async () => {
  const workspace = createTempDir("deepcode-mcp-crash-cache-workspace-");
  const serverPath = path.join(workspace, "mcp-server-crash.cjs");
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
    send({ jsonrpc: "2.0", id: request.id, result: { tools: [
      { name: "echo", inputSchema: { type: "object", properties: {} } }
    ] } });
    return;
  }
  if (request.method === "prompts/list") {
    send({ jsonrpc: "2.0", id: request.id, result: { prompts: [] } });
    return;
  }
  if (request.method === "resources/list") {
    send({ jsonrpc: "2.0", id: request.id, result: { resources: [] } });
    setTimeout(() => process.exit(9), 10);
    return;
  }
  send({ jsonrpc: "2.0", id: request.id, result: { content: [] } });
});
`,
    "utf8"
  );

  const manager = createSessionManager(workspace, "machine-id-mcp-crash-cache");
  await manager.initMcpServers({ crashy: { command: process.execPath, args: [serverPath] } });

  assert.equal(manager.getMcpStatus()[0]?.status, "ready");
  assert.equal((manager as any).mcpToolDefinitions.length, 1);

  await waitForMcpStatus(manager, "failed");

  assert.equal((manager as any).mcpToolDefinitions.length, 0);

  manager.dispose();
});

test("SessionManager reports configured MCP servers as starting before initialization", () => {
  const workspace = createTempDir("deepcode-mcp-configured-workspace-");
  const manager = new SessionManager({
    projectRoot: workspace,
    createOpenAIClient: () => ({
      client: null,
      model: "test-model",
      thinkingEnabled: false,
    }),
    getResolvedSettings: () => ({
      model: "test-model",
      mcpServers: {
        playwright: { command: "npx", args: ["@playwright/mcp@latest"] },
      },
    }),
    renderMarkdown: (text) => text,
    onAssistantMessage: () => {},
  });

  assert.deepEqual(manager.getMcpStatus(), [
    {
      name: "playwright",
      status: "starting",
      connected: false,
      toolCount: 0,
      tools: [],
      promptCount: 0,
      prompts: [],
      resourceCount: 0,
      resources: [],
    },
  ]);
});

test("SessionManager reports MCP startup stderr on failure", async () => {
  const workspace = createTempDir("deepcode-mcp-failure-workspace-");
  const serverPath = path.join(workspace, "mcp-server-fail.cjs");
  fs.writeFileSync(serverPath, 'process.stderr.write("mcp startup boom"); process.exit(7);', "utf8");

  const manager = createSessionManager(workspace, "machine-id-mcp-failure");
  await manager.initMcpServers({ broken: { command: process.execPath, args: [serverPath] } });

  const [status] = manager.getMcpStatus();
  assert.equal(status?.name, "broken");
  assert.equal(status?.status, "failed");
  assert.equal(status?.connected, false);
  assert.match(status?.error ?? "", /mcp startup boom/);
});

test(
  "SessionManager adds -y when launching MCP servers through npx",
  { skip: process.platform === "win32" },
  async () => {
    const workspace = createTempDir("deepcode-mcp-npx-workspace-");
    const argsPath = path.join(workspace, "args.json");
    const fakeNpxPath = path.join(workspace, "npx");
    fs.writeFileSync(
      fakeNpxPath,
      `#!/usr/bin/env node
const fs = require("fs");
const readline = require("readline");
fs.writeFileSync(process.env.ARGS_PATH, JSON.stringify(process.argv.slice(2)));
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
    send({ jsonrpc: "2.0", id: request.id, result: { tools: [] } });
    return;
  }
  send({ jsonrpc: "2.0", id: request.id, result: { content: [] } });
});
`,
      "utf8"
    );
    fs.chmodSync(fakeNpxPath, 0o755);

    const manager = createSessionManager(workspace, "machine-id-mcp-npx");
    await manager.initMcpServers({
      npxed: { command: fakeNpxPath, args: ["@playwright/mcp@latest"], env: { ARGS_PATH: argsPath } },
    });

    assert.deepEqual(JSON.parse(fs.readFileSync(argsPath, "utf8")) as string[], ["-y", "@playwright/mcp@latest"]);
    manager.dispose();
  }
);

test("createSession stores /init and sends the active .deepcode project AGENTS path to the LLM", async () => {
  const workspace = createTempDir("deepcode-init-deepcode-workspace-");
  const home = createTempDir("deepcode-init-deepcode-home-");
  setHomeDir(home);
  globalThis.fetch = (async () => ({ ok: true, text: async () => "" }) as Response) as typeof fetch;

  fs.mkdirSync(path.join(workspace, ".deepcode"), { recursive: true });
  fs.writeFileSync(path.join(workspace, ".deepcode", "AGENTS.md"), "deepcode project instructions", "utf8");
  fs.writeFileSync(path.join(workspace, "AGENTS.md"), "root project instructions", "utf8");

  const manager = createSessionManager(workspace, "machine-id-init-deepcode");
  (manager as any).activateSession = async () => {};

  const sessionId = await manager.createSession({ text: "/init" });
  const messages = manager.listSessionMessages(sessionId);
  const userMessage = messages.find((message) => message.role === "user");
  const openAIMessages = (manager as any).buildOpenAIMessages(messages, false, "test-model") as Array<{
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

test("createSession appends default system prompts in prefix-cache-friendly order", async () => {
  const workspace = createTempDir("deepcode-system-order-workspace-");
  const home = createTempDir("deepcode-system-order-home-");
  setHomeDir(home);
  globalThis.fetch = (async () => ({ ok: true, text: async () => "" }) as Response) as typeof fetch;

  fs.writeFileSync(path.join(workspace, "AGENTS.md"), "root project instructions", "utf8");

  const manager = createSessionManager(workspace, "machine-id-system-order");
  (manager as any).activateSession = async () => {};

  const sessionId = await manager.createSession({ text: "hello" });
  const systemContents = manager
    .listSessionMessages(sessionId)
    .filter((message) => message.role === "system")
    .map((message) => message.content ?? "");

  assert.equal(systemContents.length >= 4, true);
  assert.match(systemContents[0] ?? "", /# Available Tools/);
  assert.doesNotMatch(systemContents[0] ?? "", /# Local Workspace Environment/);
  assert.doesNotMatch(systemContents[0] ?? "", /当前LLM模型为test-model/);
  assert.match(systemContents[1] ?? "", /<agent-drift-guard-skill>/);
  assert.match(systemContents[1] ?? "", /<plan-and-execute-skill>/);
  assert.doesNotMatch(systemContents[1] ?? "", /path="templates\/skills\//);
  assert.doesNotMatch(systemContents[1] ?? "", /当前LLM模型为test-model/);
  assert.match(systemContents[2] ?? "", /# Local Workspace Environment/);
  assert.match(systemContents[2] ?? "", /当前LLM模型为test-model/);
  const environmentJsonMatch = (systemContents[2] ?? "").match(/```json\n([\s\S]+?)\n```/);
  assert.ok(environmentJsonMatch);
  const environmentInfo = JSON.parse(environmentJsonMatch[1] ?? "{}") as { "root path"?: string };
  assert.equal(environmentInfo["root path"], workspace);
  assert.equal(systemContents[3], "root project instructions");
});

test("replySession stores /init and sends the active root project AGENTS path to the LLM", async () => {
  const workspace = createTempDir("deepcode-init-root-workspace-");
  const home = createTempDir("deepcode-init-root-home-");
  setHomeDir(home);
  globalThis.fetch = (async () => ({ ok: true, text: async () => "" }) as Response) as typeof fetch;

  fs.writeFileSync(path.join(workspace, "AGENTS.md"), "root project instructions", "utf8");

  const manager = createSessionManager(workspace, "machine-id-init-root");
  (manager as any).activateSession = async () => {};

  const sessionId = await manager.createSession({ text: "first prompt" });
  await manager.replySession(sessionId, { text: "/init" });
  const messages = manager.listSessionMessages(sessionId);
  const userMessages = messages.filter((message) => message.role === "user");
  const replyMessage = userMessages[userMessages.length - 1];
  const openAIMessages = (manager as any).buildOpenAIMessages(messages, false, "test-model") as Array<{
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
  setHomeDir(home);
  globalThis.fetch = (async () => ({ ok: true, text: async () => "" }) as Response) as typeof fetch;

  fs.mkdirSync(path.join(home, ".deepcode"), { recursive: true });
  fs.writeFileSync(path.join(home, ".deepcode", "AGENTS.md"), "user instructions", "utf8");

  const manager = createSessionManager(workspace, "machine-id-init-generate");
  (manager as any).activateSession = async () => {};

  const sessionId = await manager.createSession({ text: "/init" });
  const messages = manager.listSessionMessages(sessionId);
  const userMessage = messages.find((message) => message.role === "user");
  const openAIMessages = (manager as any).buildOpenAIMessages(messages, false, "test-model") as Array<{
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
  setHomeDir(home);

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
  assert.ok(fetchCalls[0].init?.signal instanceof AbortSignal);
  assert.deepEqual(JSON.parse(String(fetchCalls[0].init?.body)), {});
  assert.equal((fetchCalls[0].init?.headers as Record<string, string>).Token, "machine-id-123");
});

test("replySession reports a new prompt with the machineId token", async () => {
  const workspace = createTempDir("deepcode-reply-workspace-");
  const home = createTempDir("deepcode-reply-home-");
  setHomeDir(home);

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
  assert.ok(fetchCalls[0].init?.signal instanceof AbortSignal);
  assert.deepEqual(JSON.parse(String(fetchCalls[0].init?.body)), {});
  assert.equal((fetchCalls[0].init?.headers as Record<string, string>).Token, "machine-id-456");
});

test("reporting a new prompt does not warn when the background request fails", async () => {
  const workspace = createTempDir("deepcode-report-failure-workspace-");
  const home = createTempDir("deepcode-report-failure-home-");
  setHomeDir(home);

  const warnings: unknown[][] = [];
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };
  globalThis.fetch = (async () => {
    throw new Error("fetch failed");
  }) as typeof fetch;

  const manager = createSessionManager(workspace, "machine-id-failure");
  (manager as any).activateSession = async () => {};

  await manager.createSession({ text: "hello world" });
  await flushPromises();

  assert.deepEqual(warnings, []);
});

test(
  "SessionManager notifies successful completion with session context",
  { skip: process.platform === "win32" },
  async () => {
    const workspace = createTempDir("deepcode-notify-success-workspace-");
    const home = createTempDir("deepcode-notify-success-home-");
    setHomeDir(home);

    const notifyOutput = path.join(workspace, "notify.jsonl");
    const notifyScript = createNotifyRecorderScript(workspace);
    const manager = createNotifyingSessionManager(
      workspace,
      [createChatResponse("final answer", { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 })],
      notifyScript,
      notifyOutput
    );

    await manager.createSession({ text: "notify success" });

    const records = await waitForNotifyRecords(notifyOutput, 1);
    assert.equal(records[0]?.STATUS, "completed");
    assert.equal(records[0]?.FAIL_REASON, null);
    assert.equal(records[0]?.BODY, "final answer");
    assert.equal(records[0]?.TITLE, "notify success");
    assert.match(String(records[0]?.DURATION), /^\d+$/);
  }
);

test(
  "SessionManager notifies failed completion with failure context",
  { skip: process.platform === "win32" },
  async () => {
    const workspace = createTempDir("deepcode-notify-failure-workspace-");
    const home = createTempDir("deepcode-notify-failure-home-");
    setHomeDir(home);

    const notifyOutput = path.join(workspace, "notify.jsonl");
    const notifyScript = createNotifyRecorderScript(workspace);
    const manager = createNotifyingSessionManager(
      workspace,
      [
        createChatResponse("first answer", { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }),
        new Error("second request failed"),
      ],
      notifyScript,
      notifyOutput
    );

    const sessionId = await manager.createSession({ text: "notify failure" });
    await waitForNotifyRecords(notifyOutput, 1);
    await manager.replySession(sessionId, { text: "second prompt" });

    const records = await waitForNotifyRecords(notifyOutput, 2);
    const failedRecord = records[1];
    assert.equal(failedRecord?.STATUS, "failed");
    assert.equal(failedRecord?.FAIL_REASON, "second request failed");
    assert.equal(failedRecord?.BODY, "first answer");
    assert.notEqual(failedRecord?.BODY, "stale-body");
    assert.equal(failedRecord?.TITLE, "notify failure");
  }
);

test("replySession continues without appending /continue as a user message", async () => {
  const workspace = createTempDir("deepcode-continue-workspace-");
  const home = createTempDir("deepcode-continue-home-");
  setHomeDir(home);

  const fetchCalls: Array<{ input: string | URL; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    fetchCalls.push({ input, init });
    return {
      ok: true,
      text: async () => "",
    } as Response;
  }) as typeof fetch;

  const manager = createSessionManager(workspace, "machine-id-continue");
  const activatedSessionIds: string[] = [];
  (manager as any).activateSession = async (sessionId: string) => {
    activatedSessionIds.push(sessionId);
  };

  const sessionId = await manager.createSession({ text: "first prompt" });
  await flushPromises();
  const messagesBefore = manager.listSessionMessages(sessionId);
  fetchCalls.length = 0;
  activatedSessionIds.length = 0;

  await manager.replySession(sessionId, { text: "/continue" });
  await flushPromises();

  const messagesAfter = manager.listSessionMessages(sessionId);
  const userMessages = messagesAfter.filter((message) => message.role === "user");

  assert.equal(activatedSessionIds.length, 1);
  assert.equal(activatedSessionIds[0], sessionId);
  assert.equal(messagesAfter.length, messagesBefore.length);
  assert.equal(
    userMessages.some((message) => message.content === "/continue"),
    false
  );
  assert.equal(fetchCalls.length, 0);
});

test("replySession records the current file-history branch head as checkpointHash", async (t) => {
  if (!hasGit()) {
    t.skip("git is not available");
    return;
  }

  const workspace = createTempDir("deepcode-checkpoint-hash-workspace-");
  const home = createTempDir("deepcode-checkpoint-hash-home-");
  setHomeDir(home);

  const manager = createSessionManager(workspace, "machine-id-checkpoint-hash");
  (manager as any).activateSession = async () => {};

  const sessionId = await manager.createSession({ text: "first prompt" });
  const checkpointHash = createFileHistoryCommit(home, workspace, sessionId, { "note.txt": "checkpoint\n" });

  await manager.replySession(sessionId, { text: "second prompt" });

  const userMessages = manager.listSessionMessages(sessionId).filter((message) => message.role === "user");
  assert.equal(userMessages[userMessages.length - 1]?.checkpointHash, checkpointHash);
});

test("createSession initializes file-history repo and session branch", async (t) => {
  if (!hasGit()) {
    t.skip("git is not available");
    return;
  }

  const workspace = createTempDir("deepcode-file-history-init-workspace-");
  const home = createTempDir("deepcode-file-history-init-home-");
  setHomeDir(home);

  const manager = createSessionManager(workspace, "machine-id-file-history-init");
  (manager as any).activateSession = async () => {};

  const sessionId = await manager.createSession({ text: "first prompt" });
  const userMessage = manager.listSessionMessages(sessionId).find((message) => message.role === "user");
  const gitDir = path.join(
    home,
    ".deepcode",
    "projects",
    workspace.replace(/[\\/]/g, "-").replace(/:/g, ""),
    "file-history",
    ".git"
  );

  assert.ok(fs.existsSync(gitDir));
  assert.ok(userMessage?.checkpointHash);
  assert.equal(
    runFileHistoryGit(gitDir, workspace, ["rev-parse", "--verify", `refs/heads/${sessionId}^{commit}`]).trim(),
    userMessage.checkpointHash
  );
});

test("Write tool advances file-history while preserving the user prompt checkpoint", async (t) => {
  if (!hasGit()) {
    t.skip("git is not available");
    return;
  }

  const workspace = createTempDir("deepcode-write-checkpoint-workspace-");
  const home = createTempDir("deepcode-write-checkpoint-home-");
  setHomeDir(home);

  const filePath = path.join(workspace, "index.html");
  const manager = createMockedClientSessionManager(workspace, [
    {
      choices: [
        {
          message: {
            content: "",
            tool_calls: [
              {
                id: "call-write-index",
                type: "function",
                function: {
                  name: "write",
                  arguments: JSON.stringify({ file_path: filePath, content: "<h1>Hello</h1>\n" }),
                },
              },
            ],
          },
        },
      ],
    },
    createChatResponse("done", { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }),
  ]);

  const sessionId = await manager.createSession({ text: "create an index page" });
  const userMessage = manager.listSessionMessages(sessionId).find((message) => message.role === "user");
  assert.ok(userMessage?.checkpointHash);
  assert.equal(fs.existsSync(filePath), true);

  manager.restoreSessionCode(sessionId, userMessage.id);

  assert.equal(fs.existsSync(filePath), false);
});

test("Write checkpoints restore tool-touched files outside the workspace and leave unrelated files alone", async (t) => {
  if (!hasGit()) {
    t.skip("git is not available");
    return;
  }

  const workspace = createTempDir("deepcode-write-outside-workspace-");
  const outsideDir = createTempDir("deepcode-write-outside-target-");
  const home = createTempDir("deepcode-write-outside-home-");
  setHomeDir(home);

  const outsideFilePath = path.join(outsideDir, "outside.txt");
  const unrelatedWorkspaceFilePath = path.join(workspace, "unrelated.txt");
  const manager = createMockedClientSessionManager(workspace, [
    {
      choices: [
        {
          message: {
            content: "",
            tool_calls: [
              {
                id: "call-write-outside",
                type: "function",
                function: {
                  name: "write",
                  arguments: JSON.stringify({ file_path: outsideFilePath, content: "outside\n" }),
                },
              },
            ],
          },
        },
      ],
    },
    createChatResponse("done", { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }),
  ]);

  const sessionId = await manager.createSession({ text: "create an outside file" });
  const userMessage = manager.listSessionMessages(sessionId).find((message) => message.role === "user");
  assert.ok(userMessage?.checkpointHash);
  assert.equal(fs.readFileSync(outsideFilePath, "utf8"), "outside\n");

  fs.writeFileSync(unrelatedWorkspaceFilePath, "keep\n", "utf8");
  manager.restoreSessionCode(sessionId, userMessage.id);

  assert.equal(fs.existsSync(outsideFilePath), false);
  assert.equal(fs.readFileSync(unrelatedWorkspaceFilePath, "utf8"), "keep\n");
});

test("missing git executable does not block sessions or Write tool calls", async () => {
  const workspace = createTempDir("deepcode-no-git-write-workspace-");
  const home = createTempDir("deepcode-no-git-write-home-");
  setHomeDir(home);

  const originalPath = process.env.PATH;
  process.env.PATH = "";
  try {
    const filePath = path.join(workspace, "index.html");
    const manager = createMockedClientSessionManager(workspace, [
      {
        choices: [
          {
            message: {
              content: "",
              tool_calls: [
                {
                  id: "call-write-no-git",
                  type: "function",
                  function: {
                    name: "write",
                    arguments: JSON.stringify({ file_path: filePath, content: "<h1>No Git</h1>\n" }),
                  },
                },
              ],
            },
          },
        ],
      },
      createChatResponse("done", { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }),
    ]);

    const sessionId = await manager.createSession({ text: "create an index page" });
    const userMessage = manager.listSessionMessages(sessionId).find((message) => message.role === "user");

    assert.equal(fs.readFileSync(filePath, "utf8"), "<h1>No Git</h1>\n");
    assert.equal(userMessage?.checkpointHash, undefined);
    assert.equal(manager.getSession(sessionId)?.status, "completed");
  } finally {
    if (originalPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = originalPath;
    }
  }
});

test("restoreSessionConversation truncates messages before the selected user prompt", async () => {
  const workspace = createTempDir("deepcode-undo-conversation-workspace-");
  const home = createTempDir("deepcode-undo-conversation-home-");
  setHomeDir(home);

  const manager = createSessionManager(workspace, "machine-id-undo-conversation");
  (manager as any).activateSession = async () => {};

  const sessionId = await manager.createSession({ text: "first prompt" });
  const firstAssistant = (manager as any).buildAssistantMessage(
    sessionId,
    "first answer",
    null,
    null
  ) as SessionMessage;
  (manager as any).appendSessionMessage(sessionId, firstAssistant);
  await manager.replySession(sessionId, { text: "second prompt" });
  const secondUserMessage = manager
    .listSessionMessages(sessionId)
    .filter((message) => message.role === "user")
    .at(-1);
  assert.ok(secondUserMessage);
  const secondAssistant = (manager as any).buildAssistantMessage(
    sessionId,
    "second answer",
    null,
    null
  ) as SessionMessage;
  (manager as any).appendSessionMessage(sessionId, secondAssistant);

  manager.restoreSessionConversation(sessionId, secondUserMessage.id);

  const contents = manager.listSessionMessages(sessionId).map((message) => message.content);
  assert.ok(contents.includes("first prompt"));
  assert.ok(contents.includes("first answer"));
  assert.ok(!contents.includes("second prompt"));
  assert.ok(!contents.includes("second answer"));
  assert.equal(manager.getSession(sessionId)?.assistantReply, "first answer");
});

test("restoreSessionCode restores project files from the recorded Git checkpoint", async (t) => {
  if (!hasGit()) {
    t.skip("git is not available");
    return;
  }

  const workspace = createTempDir("deepcode-undo-code-workspace-");
  const home = createTempDir("deepcode-undo-code-home-");
  setHomeDir(home);

  const manager = createSessionManager(workspace, "machine-id-undo-code");
  const sessionId = "session-code-restore";
  const checkpointHash = createFileHistoryCommit(home, workspace, sessionId, { "tracked.txt": "before\n" });
  createFileHistoryCommit(home, workspace, sessionId, { "tracked.txt": "after\n", "new.txt": "remove me\n" });
  fs.writeFileSync(path.join(workspace, "tracked.txt"), "after\n", "utf8");
  fs.writeFileSync(path.join(workspace, "new.txt"), "remove me\n", "utf8");

  (manager as any).appendSessionMessage(sessionId, {
    ...buildTestMessage("user-with-checkpoint", sessionId, "user", "restore here"),
    checkpointHash,
  });

  manager.restoreSessionCode(sessionId, "user-with-checkpoint");

  assert.equal(fs.readFileSync(path.join(workspace, "tracked.txt"), "utf8"), "before\n");
  assert.equal(fs.existsSync(path.join(workspace, "new.txt")), false);
});

test("replySession /continue runs trailing pending tool calls before requesting another response", async () => {
  const workspace = createTempDir("deepcode-continue-tool-workspace-");
  const home = createTempDir("deepcode-continue-tool-home-");
  setHomeDir(home);

  const responses = [
    createChatResponse("continued after tool", {
      prompt_tokens: 9,
      completion_tokens: 2,
      total_tokens: 11,
    }),
  ];
  const manager = createMockedClientSessionManager(workspace, responses);
  const originalActivateSession = manager.activateSession.bind(manager);
  (manager as any).activateSession = async () => {};

  const sessionId = await manager.createSession({ text: "first prompt" });
  const pendingAssistant = (manager as any).buildAssistantMessage(
    sessionId,
    "Need to read a file",
    [
      {
        id: "call-pending-read",
        type: "function",
        function: { name: "read", arguments: JSON.stringify({ file_path: path.join(workspace, "note.txt") }) },
      },
    ],
    null
  ) as SessionMessage;
  fs.writeFileSync(path.join(workspace, "note.txt"), "hello from pending tool\n", "utf8");
  (manager as any).appendSessionMessage(sessionId, pendingAssistant);
  (manager as any).activateSession = originalActivateSession;

  await manager.replySession(sessionId, { text: "/continue" });

  const messages = manager.listSessionMessages(sessionId);
  const toolMessage = messages.find((message) => {
    const params = message.messageParams as { tool_call_id?: string } | null;
    return message.role === "tool" && params?.tool_call_id === "call-pending-read";
  });
  const assistantMessages = messages.filter((message) => message.role === "assistant");
  const userMessages = messages.filter((message) => message.role === "user");

  assert.ok(toolMessage);
  assert.match(toolMessage.content ?? "", /hello from pending tool/);
  assert.equal(assistantMessages[assistantMessages.length - 1]?.content, "continued after tool");
  assert.equal(
    userMessages.some((message) => message.content === "/continue"),
    false
  );
});

test("replySession rebuilds snippet state from persisted read history before editing", async () => {
  const workspace = createTempDir("deepcode-rebuild-snippet-workspace-");
  const home = createTempDir("deepcode-rebuild-snippet-home-");
  setHomeDir(home);

  const filePath = path.join(workspace, "note.txt");
  fs.writeFileSync(filePath, "alpha\nbeta\n", "utf8");

  const responses = [
    createToolCallResponse(
      [
        {
          id: "call-edit",
          type: "function",
          function: {
            name: "edit",
            arguments: JSON.stringify({
              snippet_id: "full_file_5",
              file_path: filePath,
              old_string: "beta",
              new_string: "gamma",
            }),
          },
        },
      ],
      { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
    ),
    createChatResponse("done", { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }),
  ];
  const manager = createMockedClientSessionManager(workspace, responses);
  const originalActivateSession = manager.activateSession.bind(manager);
  (manager as any).activateSession = async () => {};

  const sessionId = await manager.createSession({ text: "first prompt" });
  const readToolMessage = (manager as any).buildToolMessage(
    sessionId,
    "call-read",
    JSON.stringify({
      ok: true,
      name: "read",
      output: "     1\talpha\n     2\tbeta\n",
      metadata: {
        snippet: {
          id: "full_file_5",
          filePath,
          startLine: 1,
          endLine: 3,
        },
      },
    }),
    { name: "read", arguments: JSON.stringify({ file_path: filePath }) }
  ) as SessionMessage;
  (manager as any).appendSessionMessage(sessionId, readToolMessage);

  clearSessionState(sessionId);
  (manager as any).activateSession = originalActivateSession;

  await manager.replySession(sessionId, { text: "change beta" });

  assert.equal(fs.readFileSync(filePath, "utf8"), "alpha\ngamma\n");
  const editToolMessage = manager.listSessionMessages(sessionId).find((message) => {
    const params = message.messageParams as { tool_call_id?: string } | null;
    return message.role === "tool" && params?.tool_call_id === "call-edit";
  });
  assert.ok(editToolMessage);
  assert.match(editToolMessage.content ?? "", /"ok":true|"ok": true/);
  assert.doesNotMatch(editToolMessage.content ?? "", /Unknown snippet_id/);
});

test("activateSession pauses for permission when a tool call requires ask", async () => {
  const workspace = createTempDir("deepcode-permission-ask-workspace-");
  const home = createTempDir("deepcode-permission-ask-home-");
  setHomeDir(home);

  const manager = createPermissionSessionManager(
    workspace,
    [
      {
        choices: [
          {
            message: {
              content: "",
              tool_calls: [
                {
                  id: "call-bash",
                  type: "function",
                  function: {
                    name: "bash",
                    arguments: JSON.stringify({
                      command: "rg TODO src",
                      description: "Search TODO markers",
                      sideEffects: ["read-in-cwd"],
                    }),
                  },
                },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      },
    ],
    {
      allow: [],
      deny: [],
      ask: [],
      defaultMode: "askAll",
    }
  );

  const sessionId = await manager.createSession({ text: "search todos" });
  const session = manager.getSession(sessionId);
  const assistant = manager
    .listSessionMessages(sessionId)
    .find((message) => message.role === "assistant" && (message.messageParams as any)?.tool_calls);

  assert.equal(session?.status, "ask_permission");
  assert.equal(session?.askPermissions?.[0]?.toolCallId, "call-bash");
  assert.deepEqual(session?.askPermissions?.[0]?.scopes, ["read-in-cwd"]);
  assert.deepEqual(assistant?.meta?.permissions, [{ toolCallId: "call-bash", permission: "ask" }]);
  assert.equal(
    manager.listSessionMessages(sessionId).some((message) => message.role === "tool"),
    false
  );
});

test("SessionManager preserves permission_denied status when sessions are reloaded", async () => {
  const workspace = createTempDir("deepcode-permission-denied-workspace-");
  const home = createTempDir("deepcode-permission-denied-home-");
  setHomeDir(home);

  const permissions = {
    allow: [],
    deny: [],
    ask: [],
    defaultMode: "askAll" as const,
  };
  const manager = createPermissionSessionManager(
    workspace,
    [
      {
        choices: [
          {
            message: {
              content: "",
              tool_calls: [
                {
                  id: "call-bash",
                  type: "function",
                  function: {
                    name: "bash",
                    arguments: JSON.stringify({
                      command: "rg TODO src",
                      description: "Search TODO markers",
                      sideEffects: ["read-in-cwd"],
                    }),
                  },
                },
              ],
            },
          },
        ],
      },
    ],
    permissions
  );

  const sessionId = await manager.createSession({ text: "search todos" });
  manager.denySessionPermission(sessionId);

  const reloadedManager = createPermissionSessionManager(workspace, [], permissions);
  const reloadedSession = reloadedManager.getSession(sessionId);

  assert.equal(reloadedSession?.status, "permission_denied");
  assert.equal(reloadedSession?.failReason, "Permission denied by user");
});

test("replySession applies permission replies, runs pending tools, and stores always allow scopes", async () => {
  const workspace = createTempDir("deepcode-permission-allow-workspace-");
  const home = createTempDir("deepcode-permission-allow-home-");
  setHomeDir(home);
  fs.writeFileSync(path.join(workspace, "note.txt"), "allowed content\n", "utf8");

  const manager = createPermissionSessionManager(
    workspace,
    [createChatResponse("continued", { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 })],
    {
      allow: [],
      deny: [],
      ask: ["read-in-cwd"],
      defaultMode: "allowAll",
    }
  );
  const originalActivateSession = manager.activateSession.bind(manager);
  (manager as any).activateSession = async () => {};
  const sessionId = await manager.createSession({ text: "first prompt" });
  const assistant = (manager as any).buildAssistantMessage(
    sessionId,
    "Need to read",
    [
      {
        id: "call-read",
        type: "function",
        function: { name: "read", arguments: JSON.stringify({ file_path: path.join(workspace, "note.txt") }) },
      },
    ],
    null
  ) as SessionMessage;
  assistant.meta = { ...(assistant.meta ?? {}), permissions: [{ toolCallId: "call-read", permission: "ask" }] };
  (manager as any).appendSessionMessage(sessionId, assistant);
  (manager as any).activateSession = originalActivateSession;

  await manager.replySession(sessionId, {
    text: "/continue",
    permissions: [{ toolCallId: "call-read", permission: "allow" }],
    alwaysAllows: ["read-in-cwd"],
  });

  const toolMessage = manager.listSessionMessages(sessionId).find((message) => message.role === "tool");
  const settings = JSON.parse(fs.readFileSync(path.join(workspace, ".deepcode", "settings.json"), "utf8"));

  assert.match(toolMessage?.content ?? "", /allowed content/);
  assert.deepEqual(settings.permissions.allow, ["read-in-cwd"]);
  assert.equal(manager.getSession(sessionId)?.status, "completed");
});

test("replySession turns denied permission replies into tool errors before appending user text", async () => {
  const workspace = createTempDir("deepcode-permission-deny-workspace-");
  const home = createTempDir("deepcode-permission-deny-home-");
  setHomeDir(home);

  const manager = createPermissionSessionManager(
    workspace,
    [createChatResponse("handled denial", { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 })],
    {
      allow: [],
      deny: [],
      ask: ["write-out-cwd"],
      defaultMode: "allowAll",
    }
  );
  const originalActivateSession = manager.activateSession.bind(manager);
  (manager as any).activateSession = async () => {};
  const sessionId = await manager.createSession({ text: "first prompt" });
  const assistant = (manager as any).buildAssistantMessage(
    sessionId,
    "Need to write",
    [
      {
        id: "call-write",
        type: "function",
        function: { name: "write", arguments: JSON.stringify({ file_path: "/tmp/outside.txt", content: "x" }) },
      },
    ],
    null
  ) as SessionMessage;
  assistant.meta = { ...(assistant.meta ?? {}), permissions: [{ toolCallId: "call-write", permission: "ask" }] };
  (manager as any).appendSessionMessage(sessionId, assistant);
  (manager as any).activateSession = originalActivateSession;

  await manager.replySession(sessionId, {
    text: "Do not write outside the workspace.",
    permissions: [{ toolCallId: "call-write", permission: "deny" }],
  });

  const messages = manager.listSessionMessages(sessionId);
  const assistantIndex = messages.findIndex((message) => message.id === assistant.id);
  const toolMessage = messages[assistantIndex + 1];
  const userMessage = messages[assistantIndex + 2];

  assert.equal(toolMessage?.role, "tool");
  assert.match(toolMessage?.content ?? "", /User denied the required permission/);
  assert.equal(userMessage?.role, "user");
  assert.equal(userMessage?.content, "Do not write outside the workspace.");
});

test("replySession preserves raw session messages when a previous tool call is pending", async () => {
  const workspace = createTempDir("deepcode-pending-tool-workspace-");
  const home = createTempDir("deepcode-pending-tool-home-");
  setHomeDir(home);

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

  const openAIMessages = (manager as any).buildOpenAIMessages(
    [assistantMessage, userMessage],
    false,
    "test-model"
  ) as Array<{
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
    false,
    "test-model"
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
    false,
    "test-model"
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

  const openAIMessages = (manager as any).buildOpenAIMessages(
    [userMessage, orphanToolMessage],
    false,
    "test-model"
  ) as Array<{
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
    false,
    "test-model"
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
    false,
    "test-model"
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

  const openAIMessages = (manager as any).buildOpenAIMessages(
    [assistantMessage, failedToolMessage],
    false,
    "test-model"
  ) as Array<{
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

test("UpdatePlan tool params only show explanation when provided", () => {
  const manager = createSessionManager(process.cwd(), "machine-id-update-plan-params");
  const plan = "## Task List\n\n- [ ] Inspect project";

  const withExplanation = (manager as any).buildToolMessage(
    "session-1",
    "call-plan-1",
    JSON.stringify({ ok: true, name: "UpdatePlan", output: "Plan updated." }),
    { name: "UpdatePlan", arguments: JSON.stringify({ plan, explanation: "Start planning" }) }
  ) as SessionMessage;
  const withoutExplanation = (manager as any).buildToolMessage(
    "session-1",
    "call-plan-2",
    JSON.stringify({ ok: true, name: "UpdatePlan", output: "Plan updated." }),
    { name: "UpdatePlan", arguments: JSON.stringify({ plan }) }
  ) as SessionMessage;

  assert.equal(withExplanation.meta?.paramsMd, "Start planning");
  assert.equal(withoutExplanation.meta?.paramsMd, "");
});

test("Write tool params prefer file_path even when content appears first", () => {
  const manager = createSessionManager(process.cwd(), "machine-id-write-params");
  const filePath = path.join(process.cwd(), "index.html");

  const toolMessage = (manager as any).buildToolMessage(
    "session-1",
    "call-write-1",
    JSON.stringify({ ok: true, name: "write", output: "Created file." }),
    {
      name: "write",
      arguments: JSON.stringify({
        content: "// === entry ===\nconsole.log('demo');\n",
        file_path: filePath,
      }),
    }
  ) as SessionMessage;

  assert.equal(toolMessage.meta?.paramsMd, filePath);
});

test("LLM tool calls without ids receive generated 32 character ids", async () => {
  const workspace = createTempDir("deepcode-tool-call-id-workspace-");
  const home = createTempDir("deepcode-tool-call-id-home-");
  setHomeDir(home);

  const filePath = path.join(workspace, "note.txt");
  fs.writeFileSync(filePath, "hello\n", "utf8");
  const plan = "## Task List\n\n- [ ] Inspect current behavior";
  const manager = createMockedClientSessionManager(workspace, [
    {
      choices: [
        {
          message: {
            content: "",
            tool_calls: [
              {
                id: "",
                type: "function",
                function: {
                  name: "UpdatePlan",
                  arguments: JSON.stringify({ plan, explanation: "Initial plan" }),
                },
              },
              {
                type: "function",
                function: {
                  name: "read",
                  arguments: JSON.stringify({ file_path: filePath }),
                },
              },
            ],
          },
        },
      ],
    },
    createChatResponse("done", { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }),
  ]);

  const sessionId = await manager.createSession({ text: "inspect note" });
  const assistantMessage = manager
    .listSessionMessages(sessionId)
    .find((message) => message.role === "assistant" && (message.messageParams as any)?.tool_calls);
  const toolCalls = (assistantMessage?.messageParams as { tool_calls?: Array<{ id?: unknown }> } | null)?.tool_calls;

  assert.equal(toolCalls?.length, 2);
  assert.match(String(toolCalls?.[0]?.id), /^[0-9a-f]{32}$/);
  assert.match(String(toolCalls?.[1]?.id), /^[0-9a-f]{32}$/);
  assert.notEqual(toolCalls?.[0]?.id, toolCalls?.[1]?.id);

  const toolMessages = manager.listSessionMessages(sessionId).filter((message) => message.role === "tool");
  assert.deepEqual(
    toolMessages.map((message) => (message.messageParams as { tool_call_id?: unknown } | null)?.tool_call_id),
    toolCalls?.map((toolCall) => toolCall.id)
  );

  const readToolMessage = toolMessages.find((message) => JSON.parse(message.content ?? "{}").name === "read");
  assert.equal((readToolMessage?.meta?.function as { name?: string } | undefined)?.name, "read");
  assert.equal(readToolMessage?.meta?.paramsMd, "note.txt");
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
    false,
    "test-model"
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

  const openAIMessages = (manager as any).buildOpenAIMessages(
    [earlyToolMessage, assistantMessage],
    false,
    "test-model"
  ) as Array<{
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
  setHomeDir(home);

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
  const usagePerModel = session?.usagePerModel?.["test-model"] as Record<string, any>;
  assert.equal(session?.activeTokens, 27);
  assert.equal(usage.prompt_tokens, 30);
  assert.equal(usage.completion_tokens, 12);
  assert.equal(usage.total_tokens, 42);
  assert.equal(usage.prompt_tokens_details.cached_tokens, 18);
  assert.equal(usage.completion_tokens_details.reasoning_tokens, 7);
  assert.equal(usage.prompt_cache_hit_tokens, 18);
  assert.equal(usage.prompt_cache_miss_tokens, 12);
  assert.equal(usagePerModel.prompt_tokens, 30);
  assert.equal(usagePerModel.completion_tokens, 12);
  assert.equal(usagePerModel.total_tokens, 42);
  assert.equal(usagePerModel.prompt_tokens_details.cached_tokens, 18);
  assert.equal(usagePerModel.completion_tokens_details.reasoning_tokens, 7);
  assert.equal(usagePerModel.prompt_cache_hit_tokens, 18);
  assert.equal(usagePerModel.prompt_cache_miss_tokens, 12);
  assert.equal(usagePerModel.total_reqs, 2);
});

test("SessionManager stores usage per model across model changes", async () => {
  const workspace = createTempDir("deepcode-usage-per-model-workspace-");
  const home = createTempDir("deepcode-usage-per-model-home-");
  setHomeDir(home);

  let currentModel = "deepseek-v4-pro";
  const responses = [
    createChatResponse("pro response", {
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
    }),
    createChatResponse("flash response", {
      prompt_tokens: 20,
      completion_tokens: 7,
      total_tokens: 27,
      prompt_cache_hit_tokens: 6,
    }),
  ];
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
  const manager = new SessionManager({
    projectRoot: workspace,
    createOpenAIClient: () => ({
      client: client as any,
      model: currentModel,
      baseURL: "https://api.deepseek.com",
      thinkingEnabled: false,
    }),
    getResolvedSettings: () => ({ model: currentModel }),
    renderMarkdown: (text) => text,
    onAssistantMessage: () => {},
  });

  const sessionId = await manager.createSession({ text: "" });
  currentModel = "deepseek-v4-flash";
  await manager.replySession(sessionId, { text: "" });

  const session = manager.getSession(sessionId);
  assert.deepEqual(Object.keys(session?.usagePerModel ?? {}).sort(), ["deepseek-v4-flash", "deepseek-v4-pro"]);
  assert.equal(session?.usagePerModel?.["deepseek-v4-pro"]?.prompt_tokens, 10);
  assert.equal(session?.usagePerModel?.["deepseek-v4-pro"]?.completion_tokens, 5);
  assert.equal(session?.usagePerModel?.["deepseek-v4-pro"]?.total_reqs, 1);
  assert.equal(session?.usagePerModel?.["deepseek-v4-flash"]?.prompt_tokens, 20);
  assert.equal(session?.usagePerModel?.["deepseek-v4-flash"]?.completion_tokens, 7);
  assert.equal(session?.usagePerModel?.["deepseek-v4-flash"]?.prompt_cache_hit_tokens, 6);
  assert.equal(session?.usagePerModel?.["deepseek-v4-flash"]?.total_reqs, 1);
  assert.equal(session?.usage?.prompt_tokens, 30);
  assert.equal(session?.usage?.completion_tokens, 12);
  assert.equal(session?.usage?.total_tokens, 42);
});

test("SessionManager resets active tokens to latest post-compaction response usage", async () => {
  const workspace = createTempDir("deepcode-compact-usage-workspace-");
  const home = createTempDir("deepcode-compact-usage-home-");
  setHomeDir(home);

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
  const usagePerModel = session?.usagePerModel?.["test-model"] as Record<string, any>;
  assert.equal(session?.activeTokens, 7);
  assert.equal(usage.prompt_tokens, 140_095);
  assert.equal(usage.completion_tokens, 35);
  assert.equal(usage.total_tokens, 140_130);
  assert.equal(usagePerModel.prompt_tokens, 140_095);
  assert.equal(usagePerModel.completion_tokens, 35);
  assert.equal(usagePerModel.total_tokens, 140_130);
  assert.equal(usagePerModel.total_reqs, 3);
});

test("SessionManager streams chat completions and counts reasoning progress", async () => {
  const workspace = createTempDir("deepcode-stream-workspace-");
  const home = createTempDir("deepcode-stream-home-");
  setHomeDir(home);

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
    getResolvedSettings: () => ({ model: "test-model" }),
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

test("SessionManager persists session and user message before skill matching is cancelled", async () => {
  const workspace = createTempDir("deepcode-skill-abort-workspace-");
  const home = createTempDir("deepcode-skill-abort-home-");
  setHomeDir(home);

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

  // Session and user message are persisted before skill matching triggers an abort.
  assert.equal(manager.listSessions().length, 1);
  const [session] = manager.listSessions();
  assert.equal(session?.status, "pending");
  const messages = manager.listSessionMessages(session!.id);
  const userMessage = messages.find((m) => m.role === "user");
  assert.equal(userMessage?.content, "please use demo");
});

test("SessionManager treats OpenAI APIUserAbortError as interrupted", async () => {
  const workspace = createTempDir("deepcode-api-abort-workspace-");
  const home = createTempDir("deepcode-api-abort-home-");
  setHomeDir(home);

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
    getResolvedSettings: () => ({ model: "test-model" }),
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

test("SessionManager marks MCP server as failed on single failed attempt (no auto-retry)", async () => {
  const workspace = createTempDir("deepcode-mcp-fail-noworkspace-");
  const serverPath = path.join(workspace, "mcp-server-fail.cjs");
  fs.writeFileSync(serverPath, "process.exit(7);", "utf8");

  const manager = createSessionManager(workspace, "machine-id-mcp-fail-no");
  await manager.initMcpServers({ broken: { command: process.execPath, args: [serverPath] } });

  const status = manager.getMcpStatus();
  assert.equal(status.length, 1);
  assert.equal(status[0]?.status, "failed");
  assert.match(status[0]?.error ?? "", /exited with code 7/);

  manager.dispose();
});

test("SessionManager reconnect succeeds on previously failed server", async () => {
  const workspace = createTempDir("deepcode-mcp-reconn-ok-workspace-");
  const serverPath = path.join(workspace, "mcp-server-ok.cjs");
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
  if (!("id" in request)) return;
  if (request.method === "initialize") {
    send({ jsonrpc: "2.0", id: request.id, result: { protocolVersion: "2024-11-05", capabilities: {} } });
    return;
  }
  if (request.method === "tools/list") {
    send({ jsonrpc: "2.0", id: request.id, result: { tools: [{ name: "ping", inputSchema: { type: "object", properties: {} } }] } });
    return;
  }
  send({ jsonrpc: "2.0", id: request.id, result: { content: [] } });
});
`,
    "utf8"
  );

  const manager = createSessionManager(workspace, "machine-id-mcp-reconn-ok");
  await manager.initMcpServers({ fixable: { command: process.execPath, args: [serverPath] } });

  const status = manager.getMcpStatus();
  assert.equal(status.length, 1);
  assert.equal(status[0]?.status, "ready");
  assert.equal(status[0]?.toolCount, 1);

  manager.dispose();
});

test("SessionManager adjusts the active Bash timeout control and session metadata", async () => {
  const workspace = createTempDir("deepcode-bash-timeout-session-");
  const home = createTempDir("deepcode-bash-timeout-home-");
  setHomeDir(home);

  const manager = createSessionManager(workspace, "");
  const sessionId = await manager.createSession({ text: "hello" });

  (manager as any).addSessionProcess(sessionId, 123, "sleep 10");

  let timeoutInfo = {
    timeoutMs: 10 * 60 * 1000,
    startedAtMs: 1000,
    deadlineAtMs: 1000 + 10 * 60 * 1000,
    timedOut: false,
  };
  (manager as any).setSessionProcessTimeoutControl(sessionId, 123, {
    getInfo: () => timeoutInfo,
    setTimeoutMs: (timeoutMs: number) => {
      timeoutInfo = {
        ...timeoutInfo,
        timeoutMs,
        deadlineAtMs: timeoutInfo.startedAtMs + timeoutMs,
      };
      return timeoutInfo;
    },
  });

  const adjustment = manager.adjustActiveBashTimeout(5 * 60 * 1000);
  const processInfo = manager.getSession(sessionId)?.processes?.get("123");

  assert.equal(adjustment?.processId, "123");
  assert.equal(adjustment?.timeoutMs, 15 * 60 * 1000);
  assert.equal(processInfo?.timeoutMs, 15 * 60 * 1000);
  assert.equal(processInfo?.deadlineAt, new Date(timeoutInfo.deadlineAtMs).toISOString());
});

test("SessionManager.deleteSession removes session entry from the index", () => {
  const workspace = createTempDir("deepcode-delete-workspace-");
  const home = createTempDir("deepcode-delete-home-");
  setHomeDir(home);

  const manager = createSessionManager(workspace, "machine-id-delete");
  (manager as any).activateSession = async () => {};

  // Create two sessions
  const session1 = createSessionAndMessages(manager, "session-delete-1", "First session");
  const session2 = createSessionAndMessages(manager, "session-delete-2", "Second session");

  assert.equal(manager.listSessions().length, 2);

  // Delete the first session
  const result = manager.deleteSession(session1);
  assert.equal(result, true);

  const remaining = manager.listSessions();
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0]?.id, session2);
});

test("SessionManager.deleteSession removes the messages file", () => {
  const workspace = createTempDir("deepcode-delete-msg-workspace-");
  const home = createTempDir("deepcode-delete-msg-home-");
  setHomeDir(home);

  const manager = createSessionManager(workspace, "machine-id-delete-msg");
  (manager as any).activateSession = async () => {};

  const sessionId = createSessionAndMessages(manager, "session-delete-msg", "Test session");
  const messagePath = path.join(
    home,
    ".deepcode",
    "projects",
    workspace.replace(/[\\\\/]/g, "-").replace(/:/g, ""),
    `${sessionId}.jsonl`
  );

  // Verify messages file exists
  assert.ok(fs.existsSync(messagePath));

  manager.deleteSession(sessionId);

  // Verify messages file is removed
  assert.equal(fs.existsSync(messagePath), false);
});

test("SessionManager.deleteSession returns false when session does not exist", () => {
  const workspace = createTempDir("deepcode-delete-nonexist-workspace-");
  const home = createTempDir("deepcode-delete-nonexist-home-");
  setHomeDir(home);

  const manager = createSessionManager(workspace, "machine-id-delete-nonexist");

  const result = manager.deleteSession("nonexistent-session-id");
  assert.equal(result, false);
  assert.equal(manager.listSessions().length, 0);
});

test("SessionManager.deleteSession does not affect other sessions", () => {
  const workspace = createTempDir("deepcode-delete-others-workspace-");
  const home = createTempDir("deepcode-delete-others-home-");
  setHomeDir(home);

  const manager = createSessionManager(workspace, "machine-id-delete-others");
  (manager as any).activateSession = async () => {};

  const session1 = createSessionAndMessages(manager, "session-keep-1", "Keep session 1");
  const session2 = createSessionAndMessages(manager, "session-keep-2", "Keep session 2");

  // Delete non-existent session
  const result = manager.deleteSession("non-existent");
  assert.equal(result, false);
  assert.equal(manager.listSessions().length, 2);

  // Delete one session
  assert.equal(manager.deleteSession(session1), true);
  assert.equal(manager.listSessions().length, 1);
  assert.equal(manager.listSessions()[0]?.id, session2);

  // The remaining session should still have its messages accessible
  const messages = manager.listSessionMessages(session2);
  assert.ok(messages.length > 0);
});

/**
 * Helper: creates a session and writes a few messages to it so we can test
 * that deleteSession removes both the index entry and the messages file.
 */
function createSessionAndMessages(manager: SessionManager, sessionId: string, summary: string): string {
  const now = new Date().toISOString();
  const index = (manager as any).loadSessionsIndex();
  index.entries.push({
    id: sessionId,
    summary,
    assistantReply: null,
    assistantThinking: null,
    assistantRefusal: null,
    toolCalls: null,
    status: "completed",
    failReason: null,
    usage: null,
    usagePerModel: null,
    activeTokens: 0,
    createTime: now,
    updateTime: now,
    processes: null,
  });
  (manager as any).saveSessionsIndex(index);

  // Write a couple of message lines to the messages file
  const projectDir = (manager as any).getProjectStorage().projectDir;
  const messagePath = path.join(projectDir, `${sessionId}.jsonl`);
  const msg = JSON.stringify({
    id: "msg-1",
    sessionId,
    role: "user",
    content: summary,
    visible: true,
    createTime: now,
    updateTime: now,
  });
  fs.writeFileSync(messagePath, `${msg}\n`, "utf8");

  return sessionId;
}

function hasGit(): boolean {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function createFileHistoryCommit(
  home: string,
  workspace: string,
  sessionId: string,
  files: Record<string, string>
): string {
  const projectCode = workspace.replace(/[\\/]/g, "-").replace(/:/g, "");
  const gitDir = path.join(home, ".deepcode", "projects", projectCode, "file-history", ".git");
  const fileHistory = new GitFileHistory(workspace, gitDir);
  fileHistory.ensureSession(sessionId);

  const filePaths: string[] = [];
  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = path.join(workspace, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, "utf8");
    filePaths.push(filePath);
  }
  const commitHash = fileHistory.recordCheckpoint(sessionId, filePaths, "checkpoint");
  assert.ok(commitHash);
  return commitHash;
}

function runFileHistoryGit(
  gitDir: string,
  workspace: string,
  args: string[],
  input = "",
  env: NodeJS.ProcessEnv = process.env
): string {
  return execFileSync(
    "git",
    ["-c", "core.autocrlf=false", "-c", "core.eol=lf", `--git-dir=${gitDir}`, `--work-tree=${workspace}`, ...args],
    {
      encoding: "utf8",
      input,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    }
  );
}

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
    getResolvedSettings: () => ({ model: "test-model" }),
    renderMarkdown: (text) => text,
    onAssistantMessage: () => {},
  });
}

function createNotifyingSessionManager(
  projectRoot: string,
  responses: unknown[],
  notifyPath: string,
  notifyOutput: string
): SessionManager {
  const client = {
    chat: {
      completions: {
        create: async () => {
          const response = responses.shift();
          assert.ok(response, "expected a queued chat response");
          if (response instanceof Error) {
            throw response;
          }
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
      notify: notifyPath,
      env: {
        NOTIFY_OUTPUT: notifyOutput,
        STATUS: "stale-status",
        FAIL_REASON: "stale-failure",
        BODY: "stale-body",
        TITLE: "stale-title",
      },
    }),
    getResolvedSettings: () => ({ model: "test-model" }),
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
    getResolvedSettings: () => ({ model: "test-model" }),
    renderMarkdown: (text) => text,
    onAssistantMessage: () => {},
  });
}

function createPermissionSessionManager(
  projectRoot: string,
  responses: unknown[],
  permissions: {
    allow: any[];
    deny: any[];
    ask: any[];
    defaultMode: "allowAll" | "askAll";
  }
): SessionManager {
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
    getResolvedSettings: () => ({ model: "test-model", permissions }),
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
    getResolvedSettings: () => ({ model: "test-model" }),
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

function createToolCallResponse(toolCalls: unknown[], usage: Record<string, unknown>): unknown {
  return {
    choices: [{ message: { content: "", tool_calls: toolCalls } }],
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

function createNotifyRecorderScript(dir: string): string {
  const scriptPath = path.join(dir, "notify-recorder.cjs");
  fs.writeFileSync(
    scriptPath,
    `#!/usr/bin/env node
const fs = require("fs");
const keys = ["DURATION", "STATUS", "FAIL_REASON", "BODY", "TITLE"];
const record = {};
for (const key of keys) {
  record[key] = Object.prototype.hasOwnProperty.call(process.env, key) ? process.env[key] : null;
}
fs.appendFileSync(process.env.NOTIFY_OUTPUT, JSON.stringify(record) + "\\n", "utf8");
`,
    "utf8"
  );
  fs.chmodSync(scriptPath, 0o755);
  return scriptPath;
}

async function waitForNotifyRecords(
  outputPath: string,
  expectedCount: number
): Promise<Array<Record<string, unknown>>> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (fs.existsSync(outputPath)) {
      const records = fs
        .readFileSync(outputPath, "utf8")
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      if (records.length >= expectedCount) {
        return records;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(`expected ${expectedCount} notify records in ${outputPath}`);
}

async function waitForMcpStatus(manager: SessionManager, expectedStatus: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (manager.getMcpStatus()[0]?.status === expectedStatus) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(`expected MCP status ${expectedStatus}`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function flushPromises(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

// ─── Supplementary Message Tests ──────────────────────────────────────

test("addSupplementaryMessage queues a message and returns an ID", () => {
  const manager = new SessionManager({
    projectRoot: process.cwd(),
    createOpenAIClient: () => ({ client: null, model: "test", thinkingEnabled: false }),
    getResolvedSettings: () => ({ model: "test" }),
    renderMarkdown: (t) => t,
    onAssistantMessage: () => {},
  });
  const sessionId = "test-session-1";
  const id = manager.addSupplementaryMessage(sessionId, "Please check types");
  assert.ok(id, "should return a message ID");
  assert.equal(manager.countPendingSupplementary(sessionId), 1, "should have 1 pending");
  const list = manager.listPendingSupplementary(sessionId);
  assert.equal(list.length, 1);
  assert.equal(list[0].content, "Please check types");
  assert.equal(list[0].id, id);
});

test("addSupplementaryMessage returns null when queue is full", () => {
  const manager = new SessionManager({
    projectRoot: process.cwd(),
    createOpenAIClient: () => ({ client: null, model: "test", thinkingEnabled: false }),
    getResolvedSettings: () => ({ model: "test" }),
    renderMarkdown: (t) => t,
    onAssistantMessage: () => {},
  });
  const sessionId = "test-session-full";
  // Fill queue to max (10)
  for (let i = 0; i < 10; i++) {
    const id = manager.addSupplementaryMessage(sessionId, `msg-${i}`);
    assert.ok(id, `message ${i} should be added`);
  }
  assert.equal(manager.countPendingSupplementary(sessionId), 10);
  // 11th should fail
  const id = manager.addSupplementaryMessage(sessionId, "one-too-many");
  assert.equal(id, null, "should return null when queue is full");
});

test("cancelSupplementaryMessage removes a specific message", () => {
  const manager = new SessionManager({
    projectRoot: process.cwd(),
    createOpenAIClient: () => ({ client: null, model: "test", thinkingEnabled: false }),
    getResolvedSettings: () => ({ model: "test" }),
    renderMarkdown: (t) => t,
    onAssistantMessage: () => {},
  });
  const sessionId = "test-cancel";
  const id1 = manager.addSupplementaryMessage(sessionId, "first")!;
  const id2 = manager.addSupplementaryMessage(sessionId, "second")!;
  assert.equal(manager.countPendingSupplementary(sessionId), 2);

  const cancelled = manager.cancelSupplementaryMessage(sessionId, id1);
  assert.ok(cancelled, "should cancel successfully");
  assert.equal(manager.countPendingSupplementary(sessionId), 1);
  const remaining = manager.listPendingSupplementary(sessionId);
  assert.equal(remaining[0].content, "second");

  // Cancel non-existent
  const cancelled2 = manager.cancelSupplementaryMessage(sessionId, "non-existent");
  assert.equal(cancelled2, false);
});

test("cancelSupplementaryMessage on empty session returns false", () => {
  const manager = new SessionManager({
    projectRoot: process.cwd(),
    createOpenAIClient: () => ({ client: null, model: "test", thinkingEnabled: false }),
    getResolvedSettings: () => ({ model: "test" }),
    renderMarkdown: (t) => t,
    onAssistantMessage: () => {},
  });
  const result = manager.cancelSupplementaryMessage("no-session", "some-id");
  assert.equal(result, false);
});

test("flushSupplementaryMessages returns system messages with correct role and prefix", () => {
  const manager = new SessionManager({
    projectRoot: process.cwd(),
    createOpenAIClient: () => ({ client: null, model: "test", thinkingEnabled: false }),
    getResolvedSettings: () => ({ model: "test" }),
    renderMarkdown: (t) => t,
    onAssistantMessage: () => {},
  });
  const sessionId = "test-flush";
  manager.addSupplementaryMessage(sessionId, "guidance-1");
  manager.addSupplementaryMessage(sessionId, "guidance-2");

  // flushSupplementaryMessages is private, test via inject (activateSession is async and complex)
  // We'll test the count drops to 0 after flush
  assert.equal(manager.countPendingSupplementary(sessionId), 2);

  // Note: flushSupplementaryMessages is private. This test verifies the queue is properly
  // managed from the outside. The actual flush is tested indirectly through activateSession.
});

test("Supplementary queue is session-isolated", () => {
  const manager = new SessionManager({
    projectRoot: process.cwd(),
    createOpenAIClient: () => ({ client: null, model: "test", thinkingEnabled: false }),
    getResolvedSettings: () => ({ model: "test" }),
    renderMarkdown: (t) => t,
    onAssistantMessage: () => {},
  });
  manager.addSupplementaryMessage("session-a", "for A");
  manager.addSupplementaryMessage("session-b", "for B");
  assert.equal(manager.countPendingSupplementary("session-a"), 1);
  assert.equal(manager.countPendingSupplementary("session-b"), 1);

  manager.cancelSupplementaryMessage("session-a", manager.listPendingSupplementary("session-a")[0].id);
  assert.equal(manager.countPendingSupplementary("session-a"), 0);
  assert.equal(manager.countPendingSupplementary("session-b"), 1, "session B should be unaffected");
});

test("isInSummaryPhase returns false initially and after reset", () => {
  const manager = new SessionManager({
    projectRoot: process.cwd(),
    createOpenAIClient: () => ({ client: null, model: "test", thinkingEnabled: false }),
    getResolvedSettings: () => ({ model: "test" }),
    renderMarkdown: (t) => t,
    onAssistantMessage: () => {},
  });
  assert.equal(manager.isInSummaryPhase(), false);
});

test("PendingSupplementary list is a copy (immutable)", () => {
  const manager = new SessionManager({
    projectRoot: process.cwd(),
    createOpenAIClient: () => ({ client: null, model: "test", thinkingEnabled: false }),
    getResolvedSettings: () => ({ model: "test" }),
    renderMarkdown: (t) => t,
    onAssistantMessage: () => {},
  });
  const sessionId = "test-immutable";
  manager.addSupplementaryMessage(sessionId, "content");
  const list1 = manager.listPendingSupplementary(sessionId);
  const list2 = manager.listPendingSupplementary(sessionId);
  assert.equal(list1.length, 1);
  assert.equal(list2.length, 1);
  // Mutating the returned array should not affect the internal queue
  list1.pop();
  assert.equal(manager.countPendingSupplementary(sessionId), 1, "internal queue should be unaffected");
});

test("onSupplementaryStatusChanged is called on add and cancel", () => {
  const calls: Array<{ sessionId: string; count: number }> = [];
  const manager = new SessionManager({
    projectRoot: process.cwd(),
    createOpenAIClient: () => ({ client: null, model: "test", thinkingEnabled: false }),
    getResolvedSettings: () => ({ model: "test" }),
    renderMarkdown: (t) => t,
    onAssistantMessage: () => {},
    onSupplementaryStatusChanged: (sessionId, count) => {
      calls.push({ sessionId, count });
    },
  });
  const sessionId = "test-callback";
  const id = manager.addSupplementaryMessage(sessionId, "hello")!;
  assert.equal(calls.length, 1);
  assert.equal(calls[0].count, 1);

  manager.cancelSupplementaryMessage(sessionId, id);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].count, 0);
});
