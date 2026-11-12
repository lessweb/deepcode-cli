import assert from "node:assert/strict";
import { test } from "node:test";
import type { SessionEntry, SessionMessage } from "@vegamo/deepcode-core";
import { buildTrajectory, TrajectoryController, type TrajectoryPanel, type TrajectorySnapshot } from "../trajectory.js";

const session = { id: "s1", summary: "Fix parser", status: "completed", usage: { total_tokens: 42 } } as SessionEntry;
function message(id: string, role: SessionMessage["role"], extra: Partial<SessionMessage> = {}): SessionMessage {
  return {
    id,
    role,
    sessionId: "s1",
    content: id,
    contentParams: null,
    messageParams: null,
    visible: true,
    compacted: false,
    createTime: "2026-11-11T01:00:00Z",
    updateTime: "2026-11-11T01:00:00Z",
    ...extra,
  };
}

test("trajectory retains hidden and compacted context without creating spurious turns", () => {
  const snapshot = buildTrajectory(session, [
    message("system", "system", { visible: false }),
    message("u1", "user", { compacted: true }),
    message("followup", "user", { meta: { isToolFollowUp: true } }),
    message("answer", "user", { meta: { isAnswers: true } }),
    message("summary", "user", { meta: { isSummary: true }, visible: false }),
    message("skill", "user", { meta: { skill: { name: "skill", path: "/skill", description: "test" } } }),
    message("u2", "user"),
    message("a2", "assistant", { messageParams: { reasoning_content: "Check the boundary" } }),
  ]);
  assert.deepEqual(
    snapshot.records.map((r) => r.turnId),
    ["context", "u1", "u1", "u1", "u1", "u1", "u2", "u2"]
  );
  assert.equal(snapshot.records[0].kind, "system");
  assert.equal(snapshot.records[1].compacted, true);
  assert.equal(snapshot.records[4].kind, "compacted");
  assert.equal(snapshot.records[7].thinking, "Check the boundary");
  assert.equal(snapshot.usage?.total_tokens, 42);
});

test("tool results pair by call ID even when results arrive out of order", () => {
  const snapshot = buildTrajectory(session, [
    message("u", "user"),
    message("a", "assistant", {
      content: null,
      visible: false,
      messageParams: {
        tool_calls: [
          { id: "c1", function: { name: "Read", arguments: '{"path":"a.ts"}' } },
          { id: "c2", function: { name: "Bash", arguments: '{"command":"pwd"}' } },
          { id: "c3", function: { name: "Ask", arguments: "partial{" } },
        ],
      },
    }),
    message("r2", "tool", { content: "/workspace", messageParams: { tool_call_id: "c2" } }),
    message("r1", "tool", { content: "contents", compacted: true, messageParams: { tool_call_id: "c1" } }),
  ]);
  const tools = snapshot.records.filter((r) => r.kind === "tool");
  assert.equal(tools.length, 3);
  assert.equal(tools[0].result, "contents");
  assert.equal(tools[0].compacted, true);
  assert.equal(tools[1].result, "/workspace");
  assert.equal(tools[2].result, undefined);
  assert.equal(tools[2].parameters, "partial{");
  assert.equal(tools[2].status, "No result");
  assert.equal(JSON.parse(tools[0].raw).result.id, "r1");
});

test("legacy results, image-only prompts and empty sessions remain inspectable", () => {
  const snapshot = buildTrajectory(session, [
    message("u", "user", { content: null, meta: { userPrompt: { imageUrls: ["file:///tmp/image.png"] } } }),
    message("r", "tool", { messageParams: { tool_call_id: "missing" }, meta: { function: { name: "Read" } } }),
    message("legacy", "assistant", { messageParams: null, createTime: "", content: null }),
  ]);
  assert.deepEqual(snapshot.records[0].images, ["file:///tmp/image.png"]);
  assert.equal(snapshot.records[1].label, "Read");
  assert.equal(snapshot.records[1].result, "r");
  assert.equal(snapshot.records[2].time, "");
  assert.deepEqual(buildTrajectory(null, []), {
    sessionId: null,
    title: "Trajectory",
    status: null,
    usage: null,
    records: [],
  });
});

test("tool failures and pending user responses retain their recorded status", () => {
  const snapshot = buildTrajectory(session, [
    message("failed", "tool", { content: '{"ok":false,"error":"Permission denied"}' }),
    message("question", "tool", { content: '{"ok":true,"awaitUserResponse":true}' }),
  ]);
  assert.deepEqual(
    snapshot.records.map((record) => record.status),
    ["Failed", "Waiting for response"]
  );
});

class FakePanel implements TrajectoryPanel {
  visible = true;
  reveals = 0;
  disposed = false;
  disposeListeners: Array<() => void> = [];
  viewListeners: Array<() => void> = [];
  receive: (message: unknown) => void = () => {};
  webview = {
    onDidReceiveMessage: (listener: (message: unknown) => void) => {
      this.receive = listener;
    },
  };
  onDidDispose(listener: () => void) {
    this.disposeListeners.push(listener);
  }
  onDidChangeViewState(listener: () => void) {
    this.viewListeners.push(listener);
  }
  reveal() {
    this.reveals++;
    this.visible = true;
    this.viewListeners.forEach((listener) => listener());
  }
  dispose() {
    this.disposed = true;
    this.disposeListeners.forEach((listener) => listener());
  }
}

function setup() {
  const panels: FakePanel[] = [];
  const sent: Array<{ snapshot: TrajectorySnapshot; progress: unknown }> = [];
  let current: SessionEntry | null = session;
  let reads = 0;
  const controller = new TrajectoryController({
    createPanel: () => {
      const panel = new FakePanel();
      panels.push(panel);
      return panel;
    },
    activeSessionId: () => current?.id ?? null,
    readSnapshot: () => {
      reads++;
      return buildTrajectory(current, []);
    },
    send: (_, snapshot, progress) => sent.push({ snapshot, progress }),
  });
  return {
    controller,
    panels,
    sent,
    reads: () => reads,
    select: (value: SessionEntry | null) => {
      current = value;
      controller.invalidate();
    },
  };
}

test("panel is a singleton; ready, reveal, close and disposal have bounded lifetimes", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { controller, panels, sent } = setup();
  controller.open();
  controller.open();
  controller.open();
  assert.equal(panels.length, 1);
  assert.equal(panels[0].reveals, 2);
  t.mock.timers.tick(100);
  assert.equal(sent.length, 0);
  panels[0].receive({ type: "trajectoryReady" });
  t.mock.timers.tick(100);
  assert.equal(sent.length, 1);
  controller.invalidate();
  panels[0].dispose();
  t.mock.timers.tick(100);
  assert.equal(sent.length, 1);
  controller.open();
  assert.equal(panels.length, 2);
  panels[0].receive({ type: "trajectoryReady" });
  t.mock.timers.tick(100);
  assert.equal(sent.length, 1);
  panels[1].receive({ type: "trajectoryReady" });
  controller.dispose();
  t.mock.timers.tick(100);
  assert.equal(panels[1].disposed, true);
  assert.equal(sent.length, 1);
});

test("updates follow the active session and stream updates reuse the history snapshot", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { controller, panels, sent, select, reads } = setup();
  controller.open();
  panels[0].receive({ type: "trajectoryReady" });
  t.mock.timers.tick(100);
  const progress = {
    sessionId: "s1",
    requestId: "r1",
    startedAt: "now",
    estimatedTokens: 1,
    formattedTokens: "1",
    phase: "update" as const,
  };
  for (let i = 0; i < 10; i++) controller.stream(progress);
  t.mock.timers.tick(100);
  assert.equal(reads(), 1);
  assert.equal(sent.length, 2);
  assert.deepEqual(sent.at(-1)?.progress, progress);
  select({ ...session, id: "s2" });
  t.mock.timers.tick(100);
  assert.equal(sent.at(-1)?.snapshot.sessionId, "s2");
  assert.equal(sent.at(-1)?.progress, null);
  select(null);
  t.mock.timers.tick(100);
  assert.equal(sent.at(-1)?.snapshot.sessionId, null);
  assert.deepEqual(sent.at(-1)?.snapshot.records, []);
  panels[0].visible = false;
  select(session);
  t.mock.timers.tick(100);
  assert.equal(sent.at(-1)?.snapshot.sessionId, null);
  controller.stream({ ...progress, phase: "end" });
  panels[0].reveal();
  t.mock.timers.tick(100);
  assert.equal(sent.at(-1)?.snapshot.sessionId, "s1");
  assert.equal(sent.at(-1)?.progress, null);
  controller.dispose();
});

test("trajectory exposes source identities and uses original roles for edit permissions", () => {
  const snapshot = buildTrajectory(session, [
    message("u", "user"),
    message("context", "user", { visible: false }),
    message("summary", "user", { meta: { isSummary: true } }),
    message("a", "assistant", {
      messageParams: { tool_calls: [{ id: "c", function: { name: "bash", arguments: "{}" } }] },
    }),
    message("r", "tool", { messageParams: { tool_call_id: "c" } }),
    message("system", "system"),
  ]);
  assert.deepEqual(
    snapshot.records.map((record) => record.editable),
    [false, false, false, true, true, true]
  );
  assert.deepEqual(snapshot.records[3].source, { messageId: "a" });
  assert.deepEqual(snapshot.records[4].source, { messageId: "a", toolCallIndex: 0 });
  assert.deepEqual(snapshot.records[5].source, { messageId: "system" });
});
