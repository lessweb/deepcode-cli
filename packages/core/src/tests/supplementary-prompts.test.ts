import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { MAX_SUPPLEMENTARY_PROMPTS, SessionManager, type SessionMessage } from "../session";
import type { MultimodalMode } from "../common/model-capabilities";

const originalFetch = globalThis.fetch;
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const tempDirs: string[] = [];

function setHomeDir(dir: string): void {
  process.env.HOME = dir;
  if (process.platform === "win32") {
    process.env.USERPROFILE = dir;
  }
}

function createTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
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

type CapturedRequest = {
  messages: Array<{ role: string; content: unknown }>;
};

type TestClient = {
  chat: {
    completions: {
      create: (request: unknown, options?: { signal?: AbortSignal }) => Promise<unknown>;
    };
  };
};

function isSkillMatchingRequest(request: any): boolean {
  return request?.response_format?.type === "json_object";
}

function createSkillMatchingResponse(): unknown {
  return { choices: [{ message: { content: JSON.stringify({ skillNames: [] }) } }] };
}

function createChatResponse(content: string): unknown {
  return {
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };
}

function createClientMock(options: {
  responses: unknown[];
  requests: CapturedRequest[];
  onRequest?: (request: CapturedRequest, index: number) => void;
}): TestClient {
  return {
    chat: {
      completions: {
        create: async (request: unknown) => {
          if (isSkillMatchingRequest(request)) {
            return createSkillMatchingResponse();
          }
          const captured = request as CapturedRequest;
          options.onRequest?.(captured, options.requests.length);
          options.requests.push(captured);
          const response = options.responses.shift();
          assert.ok(response, "expected a queued chat response");
          if (response instanceof Error) {
            throw response;
          }
          return response;
        },
      },
    },
  };
}

/**
 * Client whose second call behaves like a long streaming answer: it emits one
 * chunk and then stays open until the request is aborted, which is what
 * `steerActiveSession()` does when the user sends new guidance.
 */
function createSteerableClient(options: {
  requests: CapturedRequest[];
  firstResponse: unknown;
  streamedContent: string;
  onStreamStarted: () => void;
  followUpResponses: unknown[];
}): TestClient {
  let callIndex = 0;
  return {
    chat: {
      completions: {
        create: async (request: unknown, requestOptions?: { signal?: AbortSignal }) => {
          if (isSkillMatchingRequest(request)) {
            return createSkillMatchingResponse();
          }
          options.requests.push(request as CapturedRequest);
          const index = callIndex;
          callIndex += 1;

          if (index === 0) {
            return options.firstResponse;
          }
          if (index === 1) {
            const signal = requestOptions?.signal;
            const streamedContent = options.streamedContent;
            const onStreamStarted = options.onStreamStarted;
            return (async function* streamUntilAborted() {
              yield { choices: [{ delta: { content: streamedContent } }] };
              onStreamStarted();
              await new Promise<void>((_resolve, reject) => {
                const abort = () => {
                  const error = new Error("Request was aborted.");
                  error.name = "AbortError";
                  reject(error);
                };
                if (signal?.aborted) {
                  abort();
                  return;
                }
                signal?.addEventListener("abort", abort, { once: true });
              });
              yield { choices: [{ delta: {}, finish_reason: "stop" }] };
            })();
          }

          const response = options.followUpResponses.shift();
          assert.ok(response, "expected a queued follow-up response");
          return response;
        },
      },
    },
  };
}

function createTestManager(options: {
  projectRoot: string;
  client: TestClient;
  model?: string;
  multimodal?: MultimodalMode;
  onSupplementaryQueueChanged?: (sessionId: string, pending: unknown[]) => void;
  onSupplementaryPromptInjected?: (message: SessionMessage) => void;
}): SessionManager {
  const model = options.model ?? "test-model";
  return new SessionManager({
    projectRoot: options.projectRoot,
    createOpenAIClient: () => ({
      client: options.client as any,
      model,
      thinkingEnabled: false,
      baseURL: "https://api.deepseek.com",
      machineId: "machine-id-supplementary",
      telemetryEnabled: false,
    }),
    getResolvedSettings: () => ({ model, multimodal: options.multimodal }),
    renderMarkdown: (text) => text,
    onAssistantMessage: () => {},
    onSupplementaryQueueChanged: options.onSupplementaryQueueChanged as any,
    onSupplementaryPromptInjected: options.onSupplementaryPromptInjected,
  });
}

function stubTelemetry(): void {
  globalThis.fetch = (async () => ({ ok: true, text: async () => "" }) as Response) as typeof fetch;
}

function findInjectedMessages(messages: SessionMessage[]): SessionMessage[] {
  return messages.filter((message) => message.meta?.isSupplementary === true);
}

test("addSupplementaryPrompt queues guidance in order and notifies the caller", () => {
  const workspace = createTempDir("deepcode-supplementary-workspace-");
  const home = createTempDir("deepcode-supplementary-home-");
  setHomeDir(home);

  const updates: Array<{ sessionId: string; count: number }> = [];
  const client = createClientMock({ responses: [], requests: [] });
  const manager = createTestManager({
    projectRoot: workspace,
    client,
    onSupplementaryQueueChanged: (sessionId, pending) => updates.push({ sessionId, count: pending.length }),
  });

  const sessionId = "session-supplementary";
  (manager as any).updateSessionEntry = () => null;
  (manager as any).getSession = () => ({ id: sessionId });

  const first = manager.addSupplementaryPrompt(sessionId, { text: "  use postgres  " });
  const second = manager.addSupplementaryPrompt(sessionId, {
    text: "and add an index",
    imageUrls: ["https://example.com/a.png"],
  });

  assert.equal(first?.id, 1);
  assert.equal(first?.text, "use postgres");
  assert.equal(second?.id, 2);
  assert.deepEqual(second?.imageUrls, ["https://example.com/a.png"]);
  assert.deepEqual(
    manager.listPendingSupplementaryPrompts(sessionId).map((entry) => entry.text),
    ["use postgres", "and add an index"]
  );
  assert.equal(manager.countPendingSupplementaryPrompts(sessionId), 2);
  assert.deepEqual(updates, [
    { sessionId, count: 1 },
    { sessionId, count: 2 },
  ]);
});

test("listPendingSupplementaryPrompts returns copies that cannot mutate the queue", () => {
  const manager = createTestManager({
    projectRoot: createTempDir("deepcode-supplementary-copy-workspace-"),
    client: createClientMock({ responses: [], requests: [] }),
  });

  const sessionId = "session-copy";
  (manager as any).getSession = () => ({ id: sessionId });
  manager.addSupplementaryPrompt(sessionId, { text: "keep me" });

  const pending = manager.listPendingSupplementaryPrompts(sessionId);
  pending[0]!.text = "mutated";
  pending.push({ id: 99, text: "extra", imageUrls: [], createTime: "" });

  assert.deepEqual(
    manager.listPendingSupplementaryPrompts(sessionId).map((entry) => entry.text),
    ["keep me"]
  );
});

test("addSupplementaryPrompt ignores empty prompts, unknown sessions and a full queue", () => {
  const manager = createTestManager({
    projectRoot: createTempDir("deepcode-supplementary-limits-workspace-"),
    client: createClientMock({ responses: [], requests: [] }),
  });

  const sessionId = "session-limits";
  (manager as any).getSession = (id: string) => (id === sessionId ? { id: sessionId } : null);

  assert.equal(manager.addSupplementaryPrompt(sessionId, { text: "   " }), null);
  assert.equal(manager.addSupplementaryPrompt("missing-session", { text: "hello" }), null);
  assert.equal(manager.addSupplementaryPrompt(null, { text: "hello" }), null);
  assert.equal(manager.countPendingSupplementaryPrompts(sessionId), 0);

  for (let index = 0; index < MAX_SUPPLEMENTARY_PROMPTS; index += 1) {
    assert.ok(manager.addSupplementaryPrompt(sessionId, { text: `prompt ${index}` }));
  }
  assert.equal(manager.addSupplementaryPrompt(sessionId, { text: "overflow" }), null);
  assert.equal(manager.countPendingSupplementaryPrompts(sessionId), MAX_SUPPLEMENTARY_PROMPTS);
});

test("cancelSupplementaryPrompt removes the newest entry by default and any entry by id", () => {
  const manager = createTestManager({
    projectRoot: createTempDir("deepcode-supplementary-cancel-workspace-"),
    client: createClientMock({ responses: [], requests: [] }),
  });

  const sessionId = "session-cancel";
  (manager as any).getSession = () => ({ id: sessionId });
  manager.addSupplementaryPrompt(sessionId, { text: "first" });
  manager.addSupplementaryPrompt(sessionId, { text: "second" });
  manager.addSupplementaryPrompt(sessionId, { text: "third" });

  assert.equal(manager.cancelSupplementaryPrompt(sessionId), true);
  assert.deepEqual(
    manager.listPendingSupplementaryPrompts(sessionId).map((entry) => entry.text),
    ["first", "second"]
  );

  assert.equal(manager.cancelSupplementaryPrompt(sessionId, 1), true);
  assert.deepEqual(
    manager.listPendingSupplementaryPrompts(sessionId).map((entry) => entry.text),
    ["second"]
  );

  assert.equal(manager.cancelSupplementaryPrompt(sessionId, 404), false);
  assert.equal(manager.cancelSupplementaryPrompt("missing-session"), false);
  assert.equal(manager.cancelSupplementaryPrompt(sessionId), true);
  assert.equal(manager.cancelSupplementaryPrompt(sessionId), false);
});

test("guidance sent while the model is working is injected into the running turn", async () => {
  const workspace = createTempDir("deepcode-supplementary-turn-workspace-");
  const home = createTempDir("deepcode-supplementary-turn-home-");
  setHomeDir(home);
  stubTelemetry();

  const requests: CapturedRequest[] = [];
  const injected: SessionMessage[] = [];
  const client = createClientMock({
    responses: [createChatResponse("initial answer"), createChatResponse("revised answer")],
    requests,
    // Simulate the user typing a new instruction while the first LLM call runs.
    onRequest: (_request, index) => {
      if (index === 0) {
        assert.equal(
          manager.addSupplementaryPrompt(sessionId, { text: "stop, use apache instead" })?.text,
          "stop, use apache instead"
        );
      }
    },
  });
  const manager = createTestManager({
    projectRoot: workspace,
    client,
    onSupplementaryPromptInjected: (message) => injected.push(message),
  });

  const sessionId = await manager.createSession({ text: "install nginx" });
  requests.length = 0;

  await manager.activateSession(sessionId);

  // The first request of the turn has no guidance yet, the second one does.
  assert.equal(requests.length, 2);
  const firstTurnMessages = requests[0]!.messages.filter((message) => message.role === "user");
  const revisionMessages = requests[1]!.messages.filter((message) => message.role === "user");
  assert.deepEqual(
    firstTurnMessages.map((message) => message.content),
    ["install nginx"]
  );
  assert.deepEqual(
    revisionMessages.map((message) => message.content),
    ["install nginx", "stop, use apache instead"]
  );

  // The guidance is persisted as a user message that arrives after the work done so far.
  const messages = manager.listSessionMessages(sessionId);
  const stored = findInjectedMessages(messages);
  assert.equal(stored.length, 1);
  assert.equal(stored[0]!.content, "stop, use apache instead");
  assert.equal(stored[0]!.visible, true);
  assert.equal(stored[0]!.meta?.userPrompt?.text, "stop, use apache instead");
  assert.equal(injected.length, 1);
  assert.equal(injected[0]!.id, stored[0]!.id);

  const assistantIndex = messages.findIndex((message) => message.content === "initial answer");
  const injectedIndex = messages.findIndex((message) => message.id === stored[0]!.id);
  assert.ok(assistantIndex !== -1 && injectedIndex > assistantIndex);

  assert.equal(manager.countPendingSupplementaryPrompts(sessionId), 0);
});

test("guidance queued before a turn is part of the first LLM call of that turn", async () => {
  const workspace = createTempDir("deepcode-supplementary-pending-workspace-");
  const home = createTempDir("deepcode-supplementary-pending-home-");
  setHomeDir(home);
  stubTelemetry();

  const requests: CapturedRequest[] = [];
  const client = createClientMock({
    responses: [createChatResponse("initial answer"), createChatResponse("answer with guidance")],
    requests,
  });
  const manager = createTestManager({ projectRoot: workspace, client });

  const sessionId = await manager.createSession({ text: "first task" });
  requests.length = 0;

  manager.addSupplementaryPrompt(sessionId, { text: "prefer TypeScript" });
  await manager.activateSession(sessionId);

  assert.equal(requests.length, 1);
  assert.deepEqual(
    requests[0]!.messages.filter((message) => message.role === "user").map((message) => message.content),
    ["first task", "prefer TypeScript"]
  );
  assert.equal(manager.countPendingSupplementaryPrompts(sessionId), 0);
});

test("guidance with an image is injected as a user message that carries the image", async () => {
  const workspace = createTempDir("deepcode-supplementary-image-workspace-");
  const home = createTempDir("deepcode-supplementary-image-home-");
  setHomeDir(home);
  stubTelemetry();

  const requests: CapturedRequest[] = [];
  const client = createClientMock({
    responses: [createChatResponse("initial answer"), createChatResponse("locked")],
    requests,
  });
  const manager = createTestManager({
    projectRoot: workspace,
    client,
    model: "test-vision-model",
    multimodal: "on",
  });

  const sessionId = await manager.createSession({ text: "build the layout" });
  requests.length = 0;

  manager.addSupplementaryPrompt(sessionId, {
    text: "match this design",
    imageUrls: ["https://example.com/design.png"],
  });
  await manager.activateSession(sessionId);

  const userMessages = requests[0]!.messages.filter((message) => message.role === "user");
  assert.deepEqual(
    userMessages.map((message) => message.content),
    [
      "build the layout",
      [
        { type: "text", text: "match this design" },
        { type: "image_url", image_url: { url: "https://example.com/design.png" } },
      ],
    ]
  );

  const stored = findInjectedMessages(manager.listSessionMessages(sessionId));
  assert.equal(stored.length, 1);
  assert.deepEqual(stored[0]!.meta?.userPrompt?.imageUrls, ["https://example.com/design.png"]);
});

test("guidance sent while the model is writing cuts the answer short and keeps the turn alive", async () => {
  const workspace = createTempDir("deepcode-steer-workspace-");
  const home = createTempDir("deepcode-steer-home-");
  setHomeDir(home);
  stubTelemetry();

  const requests: CapturedRequest[] = [];
  let markStreamStarted: () => void = () => {};
  const streamStarted = new Promise<void>((resolve) => {
    markStreamStarted = resolve;
  });
  const client = createSteerableClient({
    requests,
    firstResponse: createChatResponse("initial answer"),
    streamedContent: "Here is the first half",
    onStreamStarted: () => markStreamStarted(),
    followUpResponses: [createChatResponse("revised answer")],
  });
  const injected: SessionMessage[] = [];
  const manager = createTestManager({
    projectRoot: workspace,
    client,
    onSupplementaryPromptInjected: (message) => injected.push(message),
  });

  const sessionId = await manager.createSession({ text: "install nginx" });
  requests.length = 0;

  const turn = manager.activateSession(sessionId);
  await streamStarted;

  // The user changes direction while the answer is still streaming.
  assert.ok(manager.addSupplementaryPrompt(sessionId, { text: "use apache instead" }));
  assert.equal(manager.steerActiveSession(), true);
  await turn;

  // The turn continued with the guidance instead of ending or failing.
  assert.equal(requests.length, 2);
  const followUp = requests[1]!.messages;
  assert.deepEqual(
    followUp.filter((message) => message.role === "user").map((message) => message.content),
    ["install nginx", "use apache instead"]
  );
  // The follow-up request keeps the earlier answer, the cut-short answer and the
  // guidance, in that order.
  assert.deepEqual(
    followUp.filter((message) => message.role === "assistant").map((message) => message.content),
    ["initial answer", "Here is the first half"]
  );

  // What the model had written is kept in the transcript and marked as cut short.
  const stored = manager.listSessionMessages(sessionId);
  const partial = stored.find((message) => message.content === "Here is the first half");
  assert.equal(partial?.role, "assistant");
  assert.equal(partial?.meta?.interrupted, true);
  assert.equal(partial?.visible, true);
  const partialIndex = stored.findIndex((message) => message.id === partial?.id);
  const guidanceIndex = stored.findIndex((message) => message.meta?.isSupplementary === true);
  assert.ok(partialIndex !== -1 && guidanceIndex > partialIndex);

  // The session finished normally, so a steered answer is not an interruption.
  assert.equal(manager.getSession(sessionId)?.status, "completed");
  assert.equal(manager.countPendingSupplementaryPrompts(sessionId), 0);
  assert.equal(injected.length, 1);
});

test("steerActiveSession does nothing when no answer is streaming", async () => {
  const workspace = createTempDir("deepcode-steer-idle-workspace-");
  const home = createTempDir("deepcode-steer-idle-home-");
  setHomeDir(home);
  stubTelemetry();

  const requests: CapturedRequest[] = [];
  const client = createClientMock({ responses: [createChatResponse("done")], requests });
  const manager = createTestManager({ projectRoot: workspace, client });

  const sessionId = await manager.createSession({ text: "start" });

  // No request in flight: the guidance stays queued for the next request boundary,
  // and a tool that is executing is therefore never killed by typing.
  assert.equal(manager.steerActiveSession(), false);
  assert.ok(manager.addSupplementaryPrompt(sessionId, { text: "also add tests" }));
  assert.equal(manager.steerActiveSession(), false);
  assert.equal(manager.countPendingSupplementaryPrompts(sessionId), 1);
});
