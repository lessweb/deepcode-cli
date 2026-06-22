import { test } from "node:test";
import assert from "node:assert/strict";
import { OpenAIMessageConverter } from "../common/openai-message-converter";
import type { SessionMessage } from "../session";

// ---------------------------------------------------------------------------
// Test helpers — build SessionMessage objects without needing SessionManager
// ---------------------------------------------------------------------------

function msg(overrides: Partial<SessionMessage> & { role: SessionMessage["role"] }): SessionMessage {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    id: overrides.id ?? "msg-1",
    sessionId: overrides.sessionId ?? "session-1",
    role: overrides.role,
    content: overrides.content ?? null,
    contentParams: overrides.contentParams ?? null,
    messageParams: overrides.messageParams ?? null,
    compacted: overrides.compacted ?? false,
    visible: overrides.visible ?? true,
    createTime: overrides.createTime ?? now,
    updateTime: overrides.updateTime ?? now,
    meta: overrides.meta,
  };
}

function assistantMsg(
  id: string,
  toolCalls?: Array<{ id: string; type?: string; function: { name: string; arguments: string } }>,
  reasoningContent?: string | null
): SessionMessage {
  const hasTcs = toolCalls && toolCalls.length > 0;
  const hasReasoning = reasoningContent !== undefined && reasoningContent !== null;
  const messageParams: Record<string, unknown> | null = hasTcs || hasReasoning ? {} : null;
  if (hasTcs) (messageParams as Record<string, unknown>).tool_calls = toolCalls;
  if (hasReasoning) (messageParams as Record<string, unknown>).reasoning_content = reasoningContent;
  return msg({
    id,
    role: "assistant",
    content: "",
    messageParams,
    visible: false,
  });
}

function toolMsg(
  id: string,
  toolCallId: string,
  content: string,
  toolFunction?: { name: string; arguments: string }
): SessionMessage {
  return msg({
    id,
    role: "tool",
    content,
    messageParams: { tool_call_id: toolCallId },
    meta: toolFunction ? { function: toolFunction } : undefined,
  });
}

function userMsg(id: string, content: string): SessionMessage {
  return msg({ id, role: "user", content });
}

// ---------------------------------------------------------------------------
// Converter fixtures
// ---------------------------------------------------------------------------

function converter(opts?: { renderInitPrompt?: () => string }) {
  return new OpenAIMessageConverter(opts);
}

// ---------------------------------------------------------------------------
// buildMessages — content handling
// ---------------------------------------------------------------------------

test("OpenAIMessageConverter preserves image content for multimodal models", () => {
  const c = converter();
  const messages: SessionMessage[] = [
    msg({
      role: "system",
      content: "Loaded pixel.png",
      contentParams: [{ type: "image_url", image_url: { url: "data:image/png;base64,abc" } }],
    }),
  ];

  const result = c.buildMessages(messages, false, "gpt-4o") as Array<{ role: string; content: unknown }>;

  assert.equal(result.length, 1);
  assert.equal(result[0]?.role, "system");
  assert.deepEqual(result[0]?.content, [
    { type: "text", text: "Loaded pixel.png" },
    { type: "image_url", image_url: { url: "data:image/png;base64,abc" } },
  ]);
});

test("OpenAIMessageConverter filters image content for non-multimodal models", () => {
  const c = converter();
  const messages: SessionMessage[] = [
    msg({
      role: "system",
      content: "Loaded pixel.png",
      contentParams: [{ type: "image_url", image_url: { url: "data:image/png;base64,abc" } }],
    }),
  ];

  const result = c.buildMessages(messages, false, "deepseek-chat") as Array<{ role: string; content: unknown }>;

  assert.equal(result.length, 1);
  assert.deepEqual(result[0]?.content, [{ type: "text", text: "Loaded pixel.png" }]);
});

test("OpenAIMessageConverter injects reasoning_content in thinking mode", () => {
  const c = converter();
  const messages: SessionMessage[] = [msg({ role: "assistant", content: "Final answer", messageParams: null })];

  const thinking = c.buildMessages(messages, true, "test-model") as Array<{ reasoning_content?: string }>;
  const nonThinking = c.buildMessages(messages, false, "test-model") as Array<{ reasoning_content?: string }>;

  assert.equal(thinking[0]?.reasoning_content, "");
  assert.equal(Object.prototype.hasOwnProperty.call(nonThinking[0] ?? {}, "reasoning_content"), false);
});

test("OpenAIMessageConverter preserves existing reasoning_content from messageParams", () => {
  const c = converter();
  const messages: SessionMessage[] = [
    msg({
      role: "assistant",
      content: "answer",
      messageParams: { reasoning_content: "deep thought" },
    }),
  ];

  const result = c.buildMessages(messages, false, "test-model") as Array<{ reasoning_content?: string }>;

  assert.equal(result[0]?.reasoning_content, "deep thought");
});

test("OpenAIMessageConverter uses /init prompt via renderInitPrompt callback", () => {
  const c = converter({ renderInitPrompt: () => "EXPANDED INIT PROMPT" });
  const messages: SessionMessage[] = [msg({ role: "user", content: "/init" })];

  const result = c.buildMessages(messages, false, "test-model") as Array<{ content: string }>;

  assert.equal(result[0]?.content, "EXPANDED INIT PROMPT");
});

test("OpenAIMessageConverter skips compacted messages", () => {
  const c = converter();
  const messages: SessionMessage[] = [
    userMsg("u1", "hello"),
    msg({ id: "a1", role: "assistant", content: "hi", compacted: true }),
    userMsg("u2", "still here?"),
    msg({ id: "a2", role: "assistant", content: "yes" }),
  ];

  const result = c.buildMessages(messages, false, "test-model") as Array<{ role: string }>;

  assert.deepEqual(
    result.map((m) => m.role),
    ["user", "user", "assistant"]
  );
});

// ---------------------------------------------------------------------------
// buildMessages — tool-call pairing
// ---------------------------------------------------------------------------

test("OpenAIMessageConverter preserves a complete multi-tool happy path", () => {
  const c = converter();
  const messages: SessionMessage[] = [
    assistantMsg("a1", [
      { id: "call-1", type: "function", function: { name: "read", arguments: '{"file_path":"/tmp/a.txt"}' } },
      { id: "call-2", type: "function", function: { name: "bash", arguments: '{"command":"pwd"}' } },
    ]),
    toolMsg("t1", "call-1", JSON.stringify({ ok: true, name: "read", content: "file content" }), {
      name: "read",
      arguments: '{"file_path":"/tmp/a.txt"}',
    }),
    toolMsg("t2", "call-2", JSON.stringify({ ok: true, name: "bash", output: "/tmp\n" }), {
      name: "bash",
      arguments: '{"command":"pwd"}',
    }),
    userMsg("u1", "thanks"),
  ];

  const result = c.buildMessages(messages, false, "test-model") as Array<{
    role: string;
    tool_call_id?: string;
    content: string;
  }>;

  assert.deepEqual(
    result.map((m) => m.role),
    ["assistant", "tool", "tool", "user"]
  );
  assert.deepEqual(
    result.filter((m) => m.role === "tool").map((m) => m.tool_call_id),
    ["call-1", "call-2"]
  );
  const hasInterrupted = result.some((m) => m.content.includes("Previous tool call did not complete"));
  assert.equal(hasInterrupted, false);
});

test("OpenAIMessageConverter inserts interrupted backfill for missing tool messages", () => {
  const c = converter();
  const messages: SessionMessage[] = [
    assistantMsg("a1", [
      { id: "call-1", type: "function", function: { name: "bash", arguments: '{"command":"sleep 100"}' } },
    ]),
    userMsg("u1", "continue"),
  ];

  const result = c.buildMessages(messages, false, "test-model") as Array<{
    role: string;
    content: string;
    tool_call_id?: string;
  }>;

  assert.equal(result.length, 3);
  assert.equal(result[0]?.role, "assistant");
  assert.equal(result[1]?.role, "tool");
  assert.equal(result[1]?.tool_call_id, "call-1");
  assert.match(result[1]?.content ?? "", /Previous tool call did not complete/);
  assert.equal(result[2]?.role, "user");
});

test("OpenAIMessageConverter ignores orphan tool messages", () => {
  const c = converter();
  const messages: SessionMessage[] = [
    userMsg("u1", "hello"),
    toolMsg("t1", "call-orphan", JSON.stringify({ ok: true, name: "bash", output: "orphan" }), {
      name: "bash",
      arguments: '{"command":"echo orphan"}',
    }),
  ];

  const result = c.buildMessages(messages, false, "test-model") as Array<{ role: string }>;

  assert.deepEqual(
    result.map((m) => m.role),
    ["user"]
  );
});

test("OpenAIMessageConverter prefers first non-interrupted tool result for a tool call", () => {
  const c = converter();
  const messages: SessionMessage[] = [
    assistantMsg("a1", [
      { id: "call-1", type: "function", function: { name: "bash", arguments: '{"command":"date"}' } },
    ]),
    toolMsg("t1", "call-1", JSON.stringify({ ok: true, name: "bash", output: "2026-05-07\n" }), {
      name: "bash",
      arguments: '{"command":"date"}',
    }),
    toolMsg(
      "t2",
      "call-1",
      JSON.stringify({
        ok: false,
        name: "bash",
        error: "Previous tool call did not complete.",
        metadata: { interrupted: true },
      }),
      { name: "bash", arguments: '{"command":"date"}' }
    ),
  ];

  const result = c.buildMessages(messages, false, "test-model") as Array<{
    role: string;
    content: string;
    tool_call_id?: string;
  }>;
  const toolResults = result.filter((m) => m.role === "tool");

  assert.equal(toolResults.length, 1);
  assert.equal(toolResults[0]?.tool_call_id, "call-1");
  assert.match(toolResults[0]?.content ?? "", /2026-05-07/);
  assert.doesNotMatch(toolResults[0]?.content ?? "", /Previous tool call did not complete/);
});

test("OpenAIMessageConverter prefers later real result over earlier interrupted placeholder", () => {
  const c = converter();
  const messages: SessionMessage[] = [
    assistantMsg("a1", [
      { id: "call-1", type: "function", function: { name: "bash", arguments: '{"command":"date"}' } },
    ]),
    toolMsg(
      "t1",
      "call-1",
      JSON.stringify({
        ok: false,
        name: "bash",
        error: "Previous tool call did not complete.",
        metadata: { interrupted: true },
      }),
      { name: "bash", arguments: '{"command":"date"}' }
    ),
    toolMsg("t2", "call-1", JSON.stringify({ ok: true, name: "bash", output: "real result" }), {
      name: "bash",
      arguments: '{"command":"date"}',
    }),
  ];

  const result = c.buildMessages(messages, false, "test-model") as Array<{
    role: string;
    content: string;
    tool_call_id?: string;
  }>;
  const toolResults = result.filter((m) => m.role === "tool");

  assert.equal(toolResults.length, 1);
  assert.match(toolResults[0]?.content ?? "", /real result/);
});

test("OpenAIMessageConverter preserves a real failed tool result", () => {
  const c = converter();
  const messages: SessionMessage[] = [
    assistantMsg("a1", [
      { id: "call-1", type: "function", function: { name: "bash", arguments: '{"command":"false"}' } },
    ]),
    toolMsg(
      "t1",
      "call-1",
      JSON.stringify({ ok: false, name: "bash", error: "Command failed", metadata: { exitCode: 1 } }),
      { name: "bash", arguments: '{"command":"false"}' }
    ),
  ];

  const result = c.buildMessages(messages, false, "test-model") as Array<{
    role: string;
    content: string;
    tool_call_id?: string;
  }>;

  assert.deepEqual(
    result.map((m) => m.role),
    ["assistant", "tool"]
  );
  assert.match(result[1]?.content ?? "", /Command failed/);
  assert.doesNotMatch(result[1]?.content ?? "", /Previous tool call did not complete/);
});

test("OpenAIMessageConverter repairs mixed missing/duplicate/orphan tool messages", () => {
  const c = converter();
  const messages: SessionMessage[] = [
    assistantMsg("a1", [
      { id: "call-1", type: "function", function: { name: "read", arguments: '{"file_path":"/tmp/missing.txt"}' } },
      { id: "call-2", type: "function", function: { name: "bash", arguments: '{"command":"pwd"}' } },
    ]),
    toolMsg("t-orphan", "call-orphan", JSON.stringify({ ok: true, name: "bash", output: "orphan" }), {
      name: "bash",
      arguments: '{"command":"echo orphan"}',
    }),
    toolMsg("t1", "call-2", JSON.stringify({ ok: true, name: "bash", output: "/tmp\n" }), {
      name: "bash",
      arguments: '{"command":"pwd"}',
    }),
    toolMsg("t2", "call-2", JSON.stringify({ ok: true, name: "bash", output: "duplicate" }), {
      name: "bash",
      arguments: '{"command":"pwd"}',
    }),
    userMsg("u1", "continue"),
  ];

  const result = c.buildMessages(messages, false, "test-model") as Array<{
    role: string;
    content: string;
    tool_call_id?: string;
  }>;
  const toolResults = result.filter((m) => m.role === "tool");

  assert.deepEqual(
    result.map((m) => m.role),
    ["assistant", "tool", "tool", "user"]
  );
  assert.deepEqual(
    toolResults.map((m) => m.tool_call_id),
    ["call-1", "call-2"]
  );
  assert.match(toolResults[0]?.content ?? "", /Previous tool call did not complete/);
  assert.match(toolResults[1]?.content ?? "", /\/tmp/);
  assert.equal(
    result.some((m) => m.content.includes("orphan")),
    false
  );
  assert.equal(
    result.some((m) => m.content.includes("duplicate")),
    false
  );
});

test("OpenAIMessageConverter ignores tool messages before their assistant", () => {
  const c = converter();
  const messages: SessionMessage[] = [
    toolMsg("t1", "call-1", JSON.stringify({ ok: true, name: "bash", output: "too early" }), {
      name: "bash",
      arguments: '{"command":"date"}',
    }),
    assistantMsg("a1", [
      { id: "call-1", type: "function", function: { name: "bash", arguments: '{"command":"date"}' } },
    ]),
  ];

  const result = c.buildMessages(messages, false, "test-model") as Array<{
    role: string;
    content: string;
    tool_call_id?: string;
  }>;

  assert.deepEqual(
    result.map((m) => m.role),
    ["assistant", "tool"]
  );
  assert.match(result[1]?.content ?? "", /Previous tool call did not complete/);
  assert.doesNotMatch(result[1]?.content ?? "", /too early/);
});

// ---------------------------------------------------------------------------
// getTrailingPendingToolCallMessage
// ---------------------------------------------------------------------------

test("OpenAIMessageConverter.getTrailingPendingToolCallMessage finds pending tools", () => {
  const c = converter();
  const messages: SessionMessage[] = [
    userMsg("u1", "hello"),
    assistantMsg("a1", [
      { id: "call-1", type: "function", function: { name: "bash", arguments: '{"command":"date"}' } },
    ]),
  ];

  const result = c.getTrailingPendingToolCallMessage(messages);

  assert.notEqual(result.message, null);
  assert.deepEqual(
    result.toolCalls.map((tc) => (tc as { id: string }).id),
    ["call-1"]
  );
});

test("OpenAIMessageConverter.getTrailingPendingToolCallMessage returns empty when latest is user", () => {
  const c = converter();
  const messages: SessionMessage[] = [userMsg("u1", "hello")];

  const result = c.getTrailingPendingToolCallMessage(messages);

  assert.equal(result.message, null);
  assert.deepEqual(result.toolCalls, []);
});

test("OpenAIMessageConverter.getTrailingPendingToolCallMessage returns empty when no tool calls", () => {
  const c = converter();
  const messages: SessionMessage[] = [msg({ id: "a1", role: "assistant", content: "done" })];

  const result = c.getTrailingPendingToolCallMessage(messages);

  assert.equal(result.message, null);
  assert.deepEqual(result.toolCalls, []);
});

test("OpenAIMessageConverter.getTrailingPendingToolCallMessage skips compacted messages", () => {
  const c = converter();
  const messages: SessionMessage[] = [
    userMsg("u1", "hello"),
    msg({
      id: "a1",
      role: "assistant",
      content: "",
      messageParams: {
        tool_calls: [{ id: "call-1", type: "function", function: { name: "bash", arguments: "{}" } }],
      },
      compacted: true,
    }),
    msg({ id: "a2", role: "assistant", content: "done" }),
  ];

  const result = c.getTrailingPendingToolCallMessage(messages);

  assert.equal(result.message, null);
  assert.deepEqual(result.toolCalls, []);
});

// ---------------------------------------------------------------------------
// findToolFunction
// ---------------------------------------------------------------------------

test("OpenAIMessageConverter.findToolFunction finds matching tool function", () => {
  const c = converter();
  const toolCalls = [
    { id: "call-1", type: "function", function: { name: "read", arguments: '{"file_path":"/tmp/a.txt"}' } },
    { id: "call-2", type: "function", function: { name: "bash", arguments: '{"command":"pwd"}' } },
  ];

  const found = c.findToolFunction(toolCalls, "call-1") as { name: string };
  assert.equal(found?.name, "read");

  const notFound = c.findToolFunction(toolCalls, "call-3");
  assert.equal(notFound, null);
});

test("OpenAIMessageConverter.findToolFunction handles null/empty toolCalls", () => {
  const c = converter();

  assert.equal(c.findToolFunction([], "call-1"), null);

  const toolCalls = [null, undefined, { noId: true }];
  assert.equal(c.findToolFunction(toolCalls as unknown[], "call-1"), null);
});
