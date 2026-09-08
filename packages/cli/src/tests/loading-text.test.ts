import { test } from "node:test";
import assert from "node:assert/strict";
import stringWidth from "string-width";
import { buildLoadingText } from "../ui";

test("buildLoadingText returns plain Thinking... when no progress", () => {
  assert.equal(buildLoadingText({ progress: null, now: Date.now() }), "Thinking...");
});

test("buildLoadingText shows reconnect attempt before stream progress", () => {
  assert.equal(
    buildLoadingText({
      progress: null,
      retry: {
        requestId: "request-1",
        error: "HTTP 502: Bad Gateway",
        attempt: 2,
        maxRetries: 5,
        delayMs: 1600,
      },
      now: Date.now(),
    }),
    "Reconnecting... 2/5 (esc to interrupt)"
  );
});

test("buildLoadingText shows running process elapsed time before thinking progress", () => {
  const startedAt = "2026-04-28T00:00:00.000Z";
  const now = Date.parse(startedAt) + 5_750;
  const processes = new Map([["123", { startTime: startedAt, command: "yarn install" }]]);
  const text = buildLoadingText({
    processes,
    progress: {
      requestId: "r",
      startedAt,
      estimatedTokens: 850,
      formattedTokens: "850",
      phase: "update",
    },
    now,
  });
  assert.equal(text, "(5s) yarn install");
});

test("buildLoadingText formats long-running process time with minutes", () => {
  const startedAt = "2026-04-28T00:00:00.000Z";
  const now = Date.parse(startedAt) + 65_250;
  const processes = new Map([["web-search", { startTime: startedAt, command: "WebSearch: latest node release" }]]);
  assert.equal(buildLoadingText({ processes, progress: null, now }), "(1m5s) WebSearch: latest node release");
});

test("buildLoadingText returns plain Thinking... while elapsed below 3s", () => {
  const startedAt = "2026-04-28T00:00:00.000Z";
  const now = Date.parse(startedAt) + 1500;
  const text = buildLoadingText({
    progress: {
      requestId: "r",
      startedAt,
      estimatedTokens: 12,
      formattedTokens: "12",
      phase: "update",
    },
    now,
  });
  assert.equal(text, "Thinking...");
});

test("buildLoadingText shows elapsed seconds and tokens once past the threshold", () => {
  const startedAt = "2026-04-28T00:00:00.000Z";
  const now = Date.parse(startedAt) + 5_750;
  const text = buildLoadingText({
    progress: {
      requestId: "r",
      startedAt,
      estimatedTokens: 850,
      formattedTokens: "850",
      phase: "update",
    },
    now,
  });
  assert.equal(text, "Thinking... (5s) · ↓ 850 tokens");
});

test("buildLoadingText falls back to '0' when formattedTokens is missing", () => {
  const startedAt = "2026-04-28T00:00:00.000Z";
  const now = Date.parse(startedAt) + 4_000;
  const text = buildLoadingText({
    progress: {
      requestId: "r",
      startedAt,
      estimatedTokens: 0,
      formattedTokens: "",
      phase: "update",
    },
    now,
  });
  assert.equal(text, "Thinking... (4s) · ↓ 0 tokens");
});

test("buildLoadingText falls back to Thinking... when timestamp is unparseable", () => {
  const text = buildLoadingText({
    progress: {
      requestId: "r",
      startedAt: "not-a-date",
      estimatedTokens: 0,
      formattedTokens: "0",
      phase: "update",
    },
    now: Date.now(),
  });
  assert.equal(text, "Thinking...");
});

const previewProgress = {
  requestId: "preview",
  startedAt: "2026-04-28T00:00:00.000Z",
  estimatedTokens: 1501,
  formattedTokens: "1.5k",
  phase: "update" as const,
  previewText: "latest text",
};
const previewNow = Date.parse(previewProgress.startedAt) + 5000;
const previewStatus = "Thinking... (5s) · ↓ 1.5k tokens";

test("loading preview requires more than 1500 tokens and preserves status priority", () => {
  const input = { progress: previewProgress, now: previewNow, screenWidth: 100 };
  assert.equal(buildLoadingText(input), `${previewStatus} [latest text]`);
  assert.equal(buildLoadingText({ ...input, progress: { ...previewProgress, estimatedTokens: 1500 } }), previewStatus);
  assert.equal(buildLoadingText({ ...input, progress: { ...previewProgress, previewText: "" } }), previewStatus);
  assert.equal(buildLoadingText({ ...input, now: previewNow - 4000 }), "Thinking...");
  assert.equal(
    buildLoadingText({
      ...input,
      processes: new Map([["p", { startTime: previewProgress.startedAt, command: "cmd" }]]),
    }),
    "(5s) cmd"
  );
  assert.equal(
    buildLoadingText({ ...input, retry: { requestId: "r", error: "err", attempt: 1, maxRetries: 5, delayMs: 800 } }),
    "Reconnecting... 1/5 (esc to interrupt)"
  );
});

test("loading preview keeps the newest complete graphemes within the reserved boundary", () => {
  const previewText = "old ".repeat(100) + "中文👨‍👩‍👧‍👦é";
  for (const screenWidth of [35, 60, 70, 80, 100, 200]) {
    const text = buildLoadingText({ progress: { ...previewProgress, previewText }, now: previewNow, screenWidth });
    if (text !== previewStatus) {
      assert.ok(stringWidth(text) <= screenWidth - 28);
      assert.ok(text.startsWith(`${previewStatus} [...`));
      assert.ok(text.endsWith("é]"));
      const tail = text.slice(previewStatus.length + 5, -1);
      assert.ok(previewText.endsWith(tail));
      assert.ok(!tail.startsWith("\u200d"));
    }
  }
  assert.equal(buildLoadingText({ progress: previewProgress, now: previewNow, screenWidth: 40 }), previewStatus);
});

test("loading preview hides below 80 columns and returns when the terminal grows", () => {
  const input = { progress: previewProgress, now: previewNow };
  for (const screenWidth of [40, 60, 70, 79, 0]) {
    assert.equal(buildLoadingText({ ...input, screenWidth }), previewStatus);
  }
  assert.equal(buildLoadingText(input), previewStatus);
  for (const screenWidth of [80, 100, 160]) {
    assert.equal(buildLoadingText({ ...input, screenWidth }), `${previewStatus} [latest text]`);
  }
});
