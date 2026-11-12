import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { firstMessageTitlePrompt, recentConversationTitlePrompt, parseSessionTitle } from "../common/session-title";
import { SessionManager, type SessionMessage } from "../session";

const INSTRUCTIONS =
  "Generate a concise, single-line task title of at most 36 characters " +
  "and under five words where possible. Start with an imperative verb. " +
  "Capitalize only the first word unless the user's language, proper nouns, " +
  "acronyms, or code terms require otherwise. Preserve ticket references " +
  "exactly. Write in the user's language. Do not use quotes, markdown, " +
  "or trailing punctuation. Do not answer the request.";

test("title prompts preserve Codex instructions and bound UTF-8 without splitting characters", () => {
  assert.equal(firstMessageTitlePrompt("  Fix login \n"), `${INSTRUCTIONS}\n\nUser prompt:\nFix login`);
  for (const char of ["🚀", "漢", "x"]) {
    const prompt = firstMessageTitlePrompt(char.repeat(3000));
    assert.ok(Buffer.byteLength(prompt) <= 960);
    assert.ok(!prompt.includes("\ufffd"));
    assert.ok(prompt.endsWith(char));
  }
});

function message(id: string, role: SessionMessage["role"], content: string): SessionMessage {
  return {
    id,
    role,
    content,
    sessionId: "source",
    visible: true,
    compacted: false,
    contentParams: null,
    messageParams: null,
    createTime: "",
    updateTime: "",
  };
}

test("fork prompts use recent substantive messages in order and escape markup", () => {
  const messages = Array.from({ length: 10 }, (_, index) => message(String(index), "user", `task ${index}`));
  messages.push(message("system", "system", "excluded system"));
  messages.push(message("tool", "tool", "excluded tool"));
  messages.push({ ...message("thinking", "assistant", "excluded commentary"), meta: { asThinking: true } });
  messages.push({ ...message("hidden", "user", "excluded hidden"), visible: false });
  messages.push(message("latest", "user", "Fix <login> & retry"));
  const prompt = recentConversationTitlePrompt(messages)!;
  assert.ok(prompt.startsWith(`${INSTRUCTIONS}\nPrioritize the current task and latest substantive user request.`));
  assert.ok(!prompt.includes("task 2"));
  assert.ok(!prompt.includes("excluded"));
  assert.equal((prompt.match(/<message role=/g) ?? []).length, 8);
  assert.ok(prompt.indexOf("task 3") < prompt.indexOf("task 9"));
  assert.ok(prompt.endsWith('<message role="user">Fix &lt;login&gt; &amp; retry</message>\n</conversation>'));
  assert.equal(recentConversationTitlePrompt([]), null);
});

test("fork prompts bound dense Unicode and keep complete XML entities", () => {
  for (const char of ["🚀", "漢", "&", "<"]) {
    const messages = Array.from({ length: 8 }, (_, i) => message(String(i), "user", char.repeat(1000)));
    const prompt = recentConversationTitlePrompt(messages)!;
    assert.ok(Buffer.byteLength(prompt) <= 960);
    assert.ok(!prompt.includes("\ufffd"));
    assert.doesNotMatch(prompt, /&(?!amp;|lt;|gt;)/);
    assert.equal((prompt.match(/<\/message>/g) ?? []).length, 8);
  }
});

test("generated titles require one JSON field and normalize within 36 Unicode characters", () => {
  assert.equal(parseSessionTitle(JSON.stringify({ title: '"  Fix login  "' })), "Fix login");
  assert.equal(parseSessionTitle('{"title":"  \\"Fix\\n login!\\"  "}'), "Fix login");
  assert.equal(parseSessionTitle(JSON.stringify({ title: "🚀".repeat(40) })), "🚀".repeat(36));
  for (const response of ["Fix login", "{}", '{"title":42}', '{"title":""}', '{"title":"ok","extra":1}']) {
    assert.equal(parseSessionTitle(response), null);
  }
});

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deepcode-title-"));
  cleanups.push(() => fs.rmSync(root, { recursive: true, force: true }));
  const requests: any[] = [];
  const signals: AbortSignal[] = [];
  const completions: Array<(title: string) => void> = [];
  let activations = 0;
  function manager() {
    const instance = new SessionManager({
      projectRoot: root,
      createOpenAIClient: () => ({
        model: "configured-model",
        baseURL: "https://api.deepseek.com",
        thinkingEnabled: true,
        client: {
          chat: {
            completions: {
              create: (request: any, options: any) => {
                requests.push(request);
                signals.push(options.signal);
                return new Promise((resolve, reject) => {
                  completions.push((title) => resolve({ choices: [{ message: { content: title } }] }));
                  options.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
                });
              },
            },
          },
        } as any,
      }),
      getResolvedSettings: () => ({ model: "configured-model", history: { persistence: "none", maxBytes: 0 } }),
      renderMarkdown: (text) => text,
      onAssistantMessage: () => {},
    });
    // Keep persisted state and file-history operations inside the test workspace.
    (instance as any).getProjectStorage = () => ({
      projectCode: "test",
      projectDir: path.join(root, "storage"),
      sessionsIndexPath: path.join(root, "storage", "sessions-index.json"),
    });
    instance.listSkills = async () => [];
    (instance as any).reportNewPrompt = () => {};
    (instance as any).runSessionIterations = async () => {
      activations++;
    };
    cleanups.push(() => instance.dispose());
    return instance;
  }
  return { manager, requests, signals, completions, activations: () => activations };
}

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

test("first message names once in the background and writes to the originating session", async () => {
  const fixture = setup();
  const manager = fixture.manager();
  const id = await manager.createSession({ text: "Fix login" });
  assert.equal(fixture.activations(), 1);
  assert.equal(manager.getSession(id)?.summary, "Fix login");
  assert.equal(manager.getSession(id)?.autoTitlePending, false);
  assert.equal(fixture.requests.length, 1);
  assert.equal(fixture.requests[0].model, "configured-model");
  assert.deepEqual(fixture.requests[0].thinking, { type: "disabled" });
  assert.ok(!("reasoning_effort" in fixture.requests[0]));
  await manager.replySession(id, { text: "More detail" });
  assert.equal(fixture.requests.length, 1);
  manager.setActiveSessionId(null);
  fixture.completions[0]('{"title":"Repair login"}');
  await settle();
  assert.equal(manager.getSession(id)?.summary, "Repair login");
  assert.equal(manager.getActiveSessionId(), null);
  assert.equal(fixture.manager().getSession(id)?.summary, "Repair login");
});

test("fork survives reload and names only after its first actual user message", async () => {
  const fixture = setup();
  const sourceManager = fixture.manager();
  const source = await sourceManager.createSession({ text: "Build login" });
  fixture.completions[0]('{"title":"Build login"}');
  await settle();
  const fork = sourceManager.forkSession(source);
  assert.equal(fixture.requests.length, 1);
  const manager = fixture.manager();
  assert.equal(manager.getSession(fork)?.autoTitlePending, true);
  await manager.replySession(fork, { text: "/continue" });
  await manager.replySession(fork, { text: "yes", isAnswers: true });
  assert.equal(manager.getSession(fork)?.autoTitlePending, true);
  await manager.replySession(fork, { text: "Add logout" });
  assert.equal(fixture.requests.length, 2);
  assert.match(fixture.requests[1].messages[1].content, /Build login/);
  assert.match(fixture.requests[1].messages[1].content, /Add logout/);
  fixture.completions[1]('{"title":"Add logout"}');
  await settle();
  assert.equal(manager.getSession(fork)?.summary, "Add logout");
  assert.equal(manager.getSession(source)?.summary, "Build login");
  await fixture.manager().replySession(fork, { text: "Continue work" });
  assert.equal(fixture.requests.length, 2);
});

test("invalid naming results keep fallback and deleted sessions are not recreated", async () => {
  const fixture = setup();
  const manager = fixture.manager();
  const id = await manager.createSession({ text: "Fallback title" });
  fixture.completions[0]("invalid JSON");
  await settle();
  assert.equal(manager.getSession(id)?.summary, "Fallback title");
  await manager.replySession(id, { text: "next" });
  assert.equal(fixture.requests.length, 1);
  const fork = manager.forkSession(id);
  await manager.replySession(fork, { text: "New task" });
  manager.deleteSession(fork);
  fixture.completions[1]('{"title":"Too late"}');
  await settle();
  assert.equal(manager.getSession(fork), null);
});

test("title timeout is independent of the main turn and does not retry", async (context) => {
  const fixture = setup();
  const manager = fixture.manager();
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const id = await manager.createSession({ text: "Slow title" });
  assert.equal(fixture.signals[0].aborted, false);
  assert.equal(fixture.activations(), 1);
  context.mock.timers.tick(30_000);
  await settle();
  assert.equal(fixture.signals[0].aborted, true);
  assert.equal(manager.getSession(id)?.summary, "Slow title");
  await manager.replySession(id, { text: "Next turn" });
  assert.equal(fixture.requests.length, 1);
});

test("legacy sessions and empty first messages do not generate titles", async () => {
  const fixture = setup();
  const manager = fixture.manager();
  const id = await manager.createSession({ text: "" });
  assert.equal(manager.getSession(id)?.autoTitlePending, false);
  const index = (manager as any).loadSessionsIndex();
  delete index.entries[0].autoTitlePending;
  (manager as any).saveSessionsIndex(index);
  await fixture.manager().replySession(id, { text: "Legacy follow-up" });
  assert.equal(fixture.requests.length, 0);
});
