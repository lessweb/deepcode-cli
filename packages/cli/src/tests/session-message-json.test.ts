import { test } from "node:test";
import assert from "node:assert/strict";
import type { SessionMessage } from "@vegamo/deepcode-core";
import { formatSessionMessageJson } from "../session-message-json";

test("SessionMessage JSON omits empty values recursively without changing the message", () => {
  const message: SessionMessage = {
    id: "message-id",
    sessionId: "session-id",
    role: "assistant",
    content: "",
    contentParams: null,
    messageParams: {
      reasoning_content: "reasoning",
      tool_calls: [],
      empty: { nested: [null, undefined, "", {}, []] },
      values: [0, false, "text", null],
      count: 0,
      disabled: false,
      arguments: '{"empty":null,"text":""}',
    },
    compacted: false,
    visible: false,
    createTime: "2026-01-01T00:00:00.000Z",
    updateTime: "2026-01-01T00:00:00.000Z",
    meta: { omittedImages: [], userPrompt: {} },
    html: "",
    checkpointHash: undefined,
  };
  const original = structuredClone(message);

  assert.deepEqual(JSON.parse(formatSessionMessageJson(message)), {
    id: message.id,
    sessionId: message.sessionId,
    role: "assistant",
    messageParams: {
      reasoning_content: "reasoning",
      values: [0, false, "text"],
      count: 0,
      disabled: false,
      arguments: '{"empty":null,"text":""}',
    },
    compacted: false,
    visible: false,
    createTime: message.createTime,
    updateTime: message.updateTime,
  });
  assert.deepEqual(message, original);
});
