import { test } from "node:test";
import assert from "node:assert/strict";
import { createContextStatusProvider } from "../ui/statusline/context-provider";

test("context statusline provider reports context usage percentage (#234)", async () => {
  const provider = createContextStatusProvider("ctx", undefined, false, undefined);
  const text = await provider.fetch({
    projectRoot: "/tmp",
    signal: new AbortController().signal,
    getSessionInfo: () => ({
      activeSessionId: "s1",
      messageCount: 10,
      requestCount: 2,
      totalTokens: 100000,
      activeTokens: 131072,
      maxContextTokens: 1024 * 1024,
      model: "deepseek-v4-flash",
      thinkingEnabled: false,
      reasoningEffort: "high",
      toolUsage: {},
    }),
  });
  assert.equal(text, "ctx 13%");
});

test("context statusline provider returns empty without an active session (#234)", async () => {
  const provider = createContextStatusProvider("ctx");
  const text = await provider.fetch({
    projectRoot: "/tmp",
    signal: new AbortController().signal,
    getSessionInfo: () => null,
  });
  assert.equal(text, "");
});
