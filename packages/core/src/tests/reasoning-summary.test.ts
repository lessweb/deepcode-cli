import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { summarizeReasoning } from "../common/reasoning-summary";
import { SessionManager, type SessionMessage } from "../session";
import type { CreateOpenAIClient } from "../common/tool-types";

const settings = { reasoningSummary: "on" as const, reasoningSummaryModel: "summary-model" };
const reasoning = "思".repeat(400);
function factory(create: (request: any, options: any) => any): CreateOpenAIClient {
  return () => ({
    model: "main-model",
    baseURL: "https://example.com",
    thinkingEnabled: true,
    reasoningEffort: "max",
    client: { chat: { completions: { create } } } as any,
  });
}

test("summary gates skip requests, including Unicode character boundaries", async () => {
  const client = factory(() => {
    assert.fail("unexpected request");
  });
  const signal = new AbortController().signal;
  for (const config of [undefined, { ...settings, reasoningSummary: "off" as const }])
    assert.equal(await summarizeReasoning(client, config, "", reasoning, "标题", signal), undefined);
  for (const text of [null, "", "思".repeat(399), "🚀".repeat(399)])
    assert.equal(await summarizeReasoning(client, settings, "", text, "标题", signal), undefined);
  for (const title of [undefined, null, "", "  "])
    assert.equal(await summarizeReasoning(client, settings, "", reasoning, title, signal), undefined);
  assert.equal(await summarizeReasoning(client, settings, "已有正文", reasoning, "标题", signal), undefined);
});

test("summary uses exact prompt and configured model with thinking explicitly disabled", async () => {
  const signal = new AbortController().signal;
  const text = "🚀".repeat(400);
  const client = factory(async (request, options) => {
    assert.deepEqual(request, {
      model: "summary-model",
      thinking: { type: "disabled" },
      messages: [
        {
          role: "user",
          content: `压缩为一两句且说人话，用与文本「标题」相同的语言回复，不要解释：\n\`\`\`\n${text}\n\`\`\``,
        },
      ],
    });
    assert.deepEqual(options, { signal, timeout: 30_000, maxRetries: 0 });
    return { choices: [{ message: { content: "简短摘要" } }] };
  });
  assert.equal(await summarizeReasoning(client, settings, " \n", text, "标题", signal), "简短摘要");
});

test("summary failures, timeouts and empty results return no summary", async () => {
  const signal = new AbortController().signal;
  for (const create of [
    () => {
      throw new Error("network failure");
    },
    () => {
      throw Object.assign(new Error("timeout"), { name: "APIConnectionTimeoutError" });
    },
    () => ({ choices: [] }),
    () => ({ choices: [{ message: { content: " \n" } }] }),
  ])
    assert.equal(await summarizeReasoning(factory(create), settings, " ", reasoning, "标题", signal), undefined);
});

async function sessionFixture(t: TestContext, create: (request: any, options: any) => any) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "reasoning-summary-session-"));
  const shown: SessionMessage[] = [];
  const manager = new SessionManager({
    projectRoot: root,
    createOpenAIClient: factory(create),
    getResolvedSettings: () => ({
      model: "main-model",
      experimental: settings,
      history: { persistence: "none", maxBytes: 0 },
    }),
    renderMarkdown: (text) => text,
    onAssistantMessage: (message) => shown.push(message),
  });
  t.after(() => {
    manager.dispose();
    fs.rmSync(root, { recursive: true, force: true });
  });
  (manager as any).getProjectStorage = () => ({
    projectCode: "test",
    projectDir: path.join(root, "storage"),
    sessionsIndexPath: path.join(root, "storage", "sessions-index.json"),
  });
  (manager as any).maybeGenerateSessionTitle = () => {};
  (manager as any).reportNewPrompt = () => {};
  manager.listSkills = async () => [];
  const activate = (manager as any).runSessionIterations;
  (manager as any).runSessionIterations = async () => {};
  const id = await manager.createSession({ text: "标题" });
  (manager as any).runSessionIterations = activate;
  return { manager, id, shown };
}

test("summary is persisted in metadata before tool execution, preserving original content, reasoning and calls", async (t) => {
  const f = await sessionFixture(t, () => ({ choices: [{ message: { content: "摘要" } }] }));
  const toolCalls = [{ id: "call-1", type: "function", function: { name: "UpdatePlan", arguments: "{}" } }];
  let completions = 0;
  (f.manager as any).requestSessionCompletion = async () => ({
    choices: [
      {
        message:
          completions++ === 0
            ? { content: "", reasoning_content: reasoning, tool_calls: toolCalls }
            : { content: "完成" },
      },
    ],
  });
  let toolsRun = 0;
  (f.manager as any).appendToolMessages = async () => {
    toolsRun++;
    const message = f.manager.listSessionMessages(f.id).find((m) => m.role === "assistant")!;
    assert.equal(message.content, "");
    assert.equal(message.meta?.reasoningSummary, "摘要");
    assert.equal(message.meta?.asThinking, true);
    assert.ok(message.meta?.permissions?.length);
    assert.deepEqual(message.messageParams, { reasoning_content: reasoning, tool_calls: toolCalls });
    assert.equal(f.shown[0].content, "");
    assert.equal(f.shown[0].meta?.reasoningSummary, "摘要");
    return { waitingForUser: false };
  };
  await f.manager.activateSession(f.id);
  assert.ok(toolsRun > 0);
  assert.equal(f.manager.getSession(f.id)?.assistantReply, "完成");
  assert.equal(f.shown.length, 2);
});

test("reasoning-only final response keeps its original reply; summary failure leaves metadata unset", async (t) => {
  for (const fail of [false, true]) {
    const f = await sessionFixture(t, () => {
      if (fail) throw new Error("unavailable");
      return { choices: [{ message: { content: "摘要" } }] };
    });
    (f.manager as any).requestSessionCompletion = async () => ({
      choices: [{ message: { content: "", reasoning_content: reasoning } }],
    });
    await f.manager.activateSession(f.id);
    assert.equal(f.manager.getSession(f.id)?.assistantReply, "");
    assert.notEqual(f.manager.getSession(f.id)?.status, "failed");
    const saved = f.manager.listSessionMessages(f.id).find((m) => m.role === "assistant")!;
    assert.equal(saved.content, "");
    assert.equal(saved.meta?.reasoningSummary, fail ? undefined : "摘要");
  }
});

test("subsequent model requests exclude generated summaries while replaying original reasoning and tool calls", async (t) => {
  const summary = "已按要求生成4套不同配色的16张图";
  const toolCalls = [
    {
      id: "call-summary-test",
      type: "function",
      function: { name: "UpdatePlan", arguments: JSON.stringify({ plan: "- [ ] Create images" }) },
    },
  ];
  let mainCalls = 0;
  let summaryCalls = 0;
  const requests: any[] = [];
  const f = await sessionFixture(t, (request) => {
    if (request.model === settings.reasoningSummaryModel) {
      summaryCalls++;
      return { choices: [{ message: { content: summary } }] };
    }
    requests.push(request);
    return {
      choices: [
        {
          message:
            mainCalls++ === 0
              ? { content: "", reasoning_content: reasoning, tool_calls: toolCalls }
              : { content: "继续处理" },
          finish_reason: mainCalls === 1 ? "tool_calls" : "stop",
        },
      ],
    };
  });
  await f.manager.activateSession(f.id);
  assert.equal(mainCalls, 2);
  assert.equal(summaryCalls, 1);
  const saved = f.manager.listSessionMessages(f.id).find((m) => m.role === "assistant")!;
  assert.equal(saved.content, "");
  assert.equal(saved.meta?.reasoningSummary, summary);
  const replayed = requests[1].messages.find((m: any) => m.role === "assistant");
  assert.deepEqual(replayed, { role: "assistant", content: "", reasoning_content: reasoning, tool_calls: toolCalls });
  assert.ok(requests[1].messages.some((m: any) => m.role === "tool" && m.tool_call_id === "call-summary-test"));
  assert.equal(JSON.stringify(requests).includes(summary), false);
  assert.equal(f.manager.getSession(f.id)?.assistantReply, "继续处理");
});

test("cancellation during summary stops saving and tool execution, including late success", async (t) => {
  for (const lateSuccess of [false, true]) {
    const controller = new AbortController();
    const f = await sessionFixture(t, () => {
      controller.abort();
      if (!lateSuccess) throw new Error("aborted");
      return { choices: [{ message: { content: "摘要" } }] };
    });
    (f.manager as any).requestSessionCompletion = async () => ({
      choices: [
        {
          message: {
            content: "",
            reasoning_content: reasoning,
            tool_calls: [{ id: "call-1", type: "function", function: { name: "UpdatePlan", arguments: "{}" } }],
          },
        },
      ],
    });
    (f.manager as any).appendToolMessages = async () => {
      assert.fail("tools must not execute");
    };
    await f.manager.activateSession(f.id, controller);
    assert.equal(f.manager.getSession(f.id)?.status, "interrupted");
    assert.equal(f.manager.listSessionMessages(f.id).filter((m) => m.role === "assistant").length, 0);
    assert.equal(f.shown.length, 0);
  }
});
