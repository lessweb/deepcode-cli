import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { syncBuiltinESMExports } from "node:module";
import OpenAI from "openai";
import { SessionManager } from "../session";
import type { PermissionSettings } from "../settings";

function fixture(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "session-permissions-"));
  const workspace = path.join(root, "project");
  const home = path.join(root, "user");
  fs.mkdirSync(workspace);
  t.mock.method(os, "homedir", () => home);
  syncBuiltinESMExports();
  const managers: SessionManager[] = [];
  t.after(() => {
    for (const manager of managers) manager.dispose();
    t.mock.restoreAll();
    syncBuiltinESMExports();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const settings: Required<PermissionSettings> = {
    allow: [],
    deny: [],
    ask: [],
    defaultMode: "askAll",
    addWorkingDirs: [],
  };
  function create() {
    const responses: unknown[] = [];
    const client = new OpenAI({ apiKey: "test" });
    t.mock.method(client.chat.completions, "create", async (request: OpenAI.ChatCompletionCreateParams) => {
      if (request.response_format?.type === "json_object") {
        return { choices: [{ message: { content: '{"skillNames": []}' } }] };
      }
      return responses.shift() ?? { choices: [{ message: { content: "done" } }] };
    });
    const manager = new SessionManager({
      projectRoot: workspace,
      createOpenAIClient: () => ({
        client,
        model: "test",
        baseURL: "",
        thinkingEnabled: false,
        telemetryEnabled: false,
      }),
      getResolvedSettings: () => ({ model: "test", permissions: settings }),
      renderMarkdown: (text) => text,
      onAssistantMessage() {},
    });
    managers.push(manager);
    function write(id: string) {
      responses.push({
        choices: [
          {
            message: {
              content: "",
              tool_calls: [
                {
                  id,
                  type: "function",
                  function: {
                    name: "Write",
                    arguments: JSON.stringify({ file_path: path.join(workspace, `${id}.txt`), content: id }),
                  },
                },
              ],
            },
          },
        ],
      });
    }
    return { manager, write };
  }
  return { root, workspace, home, settings, create };
}

test("session grants resume pending tools and authorize later turns across Plan transitions without persistence", async (t) => {
  const f = fixture(t);
  const { manager, write } = f.create();
  write("first");
  const id = await manager.createSession({ planMode: true });
  assert.equal(manager.getSession(id)?.status, "ask_permission");
  write("second");
  await manager.replySession(id, {
    text: "/continue",
    planMode: true,
    permissions: [{ toolCallId: "first", permission: "allow" }],
    sessionAllows: ["write-in-cwd"],
  });
  assert.equal(manager.getSession(id)?.status, "completed");
  assert.equal(fs.readFileSync(path.join(f.workspace, "second.txt"), "utf8"), "second");
  for (const planMode of [false, true]) {
    write(`mode-${planMode}`);
    await manager.replySession(id, { text: "/continue", planMode });
    assert.equal(manager.getSession(id)?.status, "completed");
  }
  await manager.replySession(id, { text: "hello", sessionAllows: ["write-in-cwd"] });
  assert.ok(manager.listSessionMessages(id).some((message) => message.role === "user" && message.content === "hello"));
  assert.doesNotMatch(JSON.stringify(manager.listSessionMessages(id)), /sessionAllows/);
  assert.doesNotMatch(JSON.stringify(manager.getSession(id)), /sessionAllows/);
  assert.equal(fs.existsSync(path.join(f.workspace, ".deepcode", "settings.json")), false);
  assert.equal(fs.existsSync(path.join(f.home, ".deepcode", "settings.json")), false);
  f.settings.deny.push("write-in-cwd");
  write("denied");
  await manager.replySession(id, { text: "/continue", planMode: true });
  assert.equal(fs.existsSync(path.join(f.workspace, "denied.txt")), false);
  assert.match(
    manager.listSessionMessages(id).find((m) => m.role === "tool" && m.content?.includes("User denied"))?.content ?? "",
    /User denied/
  );
});

test("new, forked and reloaded sessions do not inherit grants, while switching back preserves them", async (t) => {
  const f = fixture(t);
  const { manager, write } = f.create();
  const original = await manager.createSession({});
  await manager.replySession(original, { text: "/continue", sessionAllows: ["write-in-cwd"] });
  write("new-session");
  const fresh = await manager.createSession({});
  assert.equal(manager.getSession(fresh)?.status, "ask_permission");
  const fork = manager.forkSession(original);
  write("fork-session");
  await manager.replySession(fork, { text: "/continue" });
  assert.equal(manager.getSession(fork)?.status, "ask_permission");
  write("back-to-original");
  await manager.replySession(original, { text: "/continue" });
  assert.equal(manager.getSession(original)?.status, "completed");
  const reloaded = f.create();
  reloaded.write("after-restart");
  await reloaded.manager.replySession(original, { text: "/continue" });
  assert.equal(reloaded.manager.getSession(original)?.status, "ask_permission");
});

test("deleting a session releases its grants even if its ID is reused", async (t) => {
  const f = fixture(t);
  const { manager, write } = f.create();
  const id = await manager.createSession({});
  await manager.replySession(id, { text: "/continue", sessionAllows: ["write-in-cwd"] });
  assert.equal(manager.deleteSession(id), true);
  write("reused-id");
  await manager.createSession({}, undefined, id);
  assert.equal(manager.getSession(id)?.status, "ask_permission");
  assert.equal(fs.existsSync(path.join(f.workspace, "reused-id.txt")), false);
});
