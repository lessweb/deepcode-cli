import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { SessionManager } from "../session";
import { handleBashTool } from "../tools/bash-handler";
import * as state from "../common/state";
import type { ToolExecutionContext } from "../tools/executor";

const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function setHomeDir(dir: string): void {
  process.env.HOME = dir;
  if (process.platform === "win32") {
    process.env.USERPROFILE = dir;
  }
}

function createSessionManager(projectRoot: string): SessionManager {
  return new SessionManager({
    projectRoot,
    createOpenAIClient: () => ({
      client: null,
      model: "test",
      baseURL: "https://api.test.com",
      thinkingEnabled: false,
      reasoningEffort: "high",
      debugLogEnabled: false,
      env: {},
    }),
    getResolvedSettings: () => ({ model: "test" }),
    renderMarkdown: (text: string) => text,
    onAssistantMessage: () => {},
  });
}

afterEach(() => {
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

test("SessionManager.deleteSession clears state cache for that session", async () => {
  const home = createTempDir("deepcode-mem-home-");
  const projectRoot = createTempDir("deepcode-mem-workspace-");
  setHomeDir(home);
  const manager = createSessionManager(projectRoot);

  const sessionId = await manager.createSession({ text: "seed" });
  const filePath = path.join(projectRoot, "a.txt");
  fs.writeFileSync(filePath, "hello");
  state.recordFileState(sessionId, { filePath, content: "hello", timestamp: Date.now() }, { incrementVersion: true });
  const snippet = state.createSnippet(sessionId, filePath, 1, 1, "hello");
  const fileVersionBeforeDelete = state.getFileVersion(sessionId, filePath);

  assert.ok(state.wasFileRead(sessionId, filePath));
  assert.ok(snippet);
  assert.ok(state.getSnippet(sessionId, snippet!.id));
  assert.equal(fileVersionBeforeDelete, 1);

  assert.equal(manager.deleteSession(sessionId), true);
  assert.equal(state.wasFileRead(sessionId, filePath), false);
  assert.equal(state.getSnippet(sessionId, snippet!.id), null);
  assert.equal(state.getFileVersion(sessionId, filePath), 0);
});

test("SessionManager.createSession auto-prune clears dropped session state cache", async () => {
  const home = createTempDir("deepcode-mem-home-");
  const projectRoot = createTempDir("deepcode-mem-workspace-");
  setHomeDir(home);
  const manager = createSessionManager(projectRoot);

  const firstSession = await manager.createSession({ text: "first" });
  const filePath = path.join(projectRoot, "first.txt");
  fs.writeFileSync(filePath, "first");
  state.recordFileState(firstSession, { filePath, content: "first", timestamp: Date.now() });
  assert.equal(state.wasFileRead(firstSession, filePath), true);

  for (let i = 0; i < 60; i += 1) {
    await manager.createSession({ text: `session-${i}` });
  }

  const remaining = manager.listSessions().map((entry) => entry.id);
  assert.equal(remaining.includes(firstSession), false);
  assert.equal(state.wasFileRead(firstSession, filePath), false);
});

test("SessionManager.deleteSession clears controller map entry", async () => {
  const home = createTempDir("deepcode-mem-home-");
  const projectRoot = createTempDir("deepcode-mem-workspace-");
  setHomeDir(home);
  const manager = createSessionManager(projectRoot);

  const sessionId = await manager.createSession({ text: "seed" });
  const controllers = (manager as unknown as { sessionControllers: Map<string, AbortController> }).sessionControllers;
  controllers.set(sessionId, new AbortController());
  assert.equal(controllers.has(sessionId), true);

  assert.equal(manager.deleteSession(sessionId), true);
  assert.equal(controllers.has(sessionId), false);
});

test("SessionManager.dispose aborts and clears controllers", () => {
  const projectRoot = createTempDir("deepcode-mem-workspace-");
  const manager = createSessionManager(projectRoot);
  const controllers = (manager as unknown as { sessionControllers: Map<string, AbortController> }).sessionControllers;

  const controllerA = new AbortController();
  const controllerB = new AbortController();
  controllers.set("a", controllerA);
  controllers.set("b", controllerB);
  assert.equal(controllers.size, 2);

  manager.dispose();
  assert.equal(controllers.size, 0);
});

test("Deleted session id reuse should reset bash cwd to project root", async () => {
  const home = createTempDir("deepcode-mem-home-");
  const projectRoot = createTempDir("deepcode-mem-workspace-");
  setHomeDir(home);
  const manager = createSessionManager(projectRoot);

  const sessionId = await manager.createSession({ text: "bash-session" });
  const sub = path.join(projectRoot, "sub");
  fs.mkdirSync(sub, { recursive: true });

  const context: ToolExecutionContext = {
    sessionId,
    projectRoot,
    toolCall: { id: "call-1", type: "function", function: { name: "bash", arguments: "{}" } },
    createOpenAIClient: () => ({
      client: null,
      model: "test",
      baseURL: "",
      thinkingEnabled: false,
      reasoningEffort: "high",
      debugLogEnabled: false,
      env: {},
    }),
  };

  const first = await handleBashTool({ command: `cd "${sub}" && pwd` }, context);
  assert.equal(first.ok, true);

  assert.equal(manager.deleteSession(sessionId), true);

  const second = await handleBashTool({ command: "pwd" }, context);
  assert.equal(second.ok, true);

  const output = (second.output ?? "").trim();
  const metadataCwd =
    second.metadata && typeof second.metadata.cwd === "string" ? (second.metadata.cwd as string) : null;
  const observedCwd = (metadataCwd ?? output).replace(/\\/g, "/").replace(/\/+$/, "");
  const normalizedSub = fs.realpathSync(sub).replace(/\\/g, "/").replace(/\/+$/, "");
  assert.notEqual(
    observedCwd,
    normalizedSub,
    `expected cwd not to stay on deleted session subdir ${normalizedSub}, got output=${output}, metadata.cwd=${String(metadataCwd)}`
  );
});

test("deleteSession should not kill untracked stale persisted pids", async () => {
  const home = createTempDir("deepcode-mem-home-");
  const projectRoot = createTempDir("deepcode-mem-workspace-");
  setHomeDir(home);
  const manager = createSessionManager(projectRoot);
  const sessionId = await manager.createSession({ text: "stale-pid" });

  const privateManager = manager as unknown as {
    updateSessionEntry: (
      sessionId: string,
      updater: (entry: { processes: Map<string, { startTime: string; command: string }> | null }) => {
        processes: Map<string, { startTime: string; command: string }> | null;
      }
    ) => unknown;
  };
  privateManager.updateSessionEntry(sessionId, (entry) => ({
    ...entry,
    processes: new Map([["999999", { startTime: new Date().toISOString(), command: "sleep 999" }]]),
  }));

  const originalKill = process.kill;
  let killCalls = 0;
  const mockedKill = ((pid: number, signal?: NodeJS.Signals | number) => {
    killCalls += 1;
    return originalKill(pid, signal);
  }) as typeof process.kill;
  process.kill = mockedKill;
  try {
    assert.equal(manager.deleteSession(sessionId), true);
  } finally {
    process.kill = originalKill;
  }

  assert.equal(killCalls, 0);
});
