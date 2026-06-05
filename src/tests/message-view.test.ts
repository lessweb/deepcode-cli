import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDiffPreview } from "../ui";
import {
  buildThinkingSummary,
  formatBashStatusParams,
  formatToolStatusParams,
  renderMessageToStdout,
  getUpdatePlanPreviewLines,
  parseToolPayload,
} from "../ui/components/MessageView/utils";
import { RawMode } from "../ui/contexts";
import type { SessionMessage } from "../session";
import type { ToolSummary } from "../ui/components/MessageView/types";

test("parseDiffPreview removes headers and classifies lines", () => {
  const lines = parseDiffPreview(
    ["--- a/file.txt", "+++ b/file.txt", "@@ -1,1 +1,1 @@", " context", "-old", "+new"].join("\n")
  );

  assert.deepEqual(lines, [
    { marker: " ", content: "context", kind: "context" },
    { marker: "-", content: "old", kind: "removed" },
    { marker: "+", content: "new", kind: "added" },
  ]);
});

test("parseDiffPreview keeps nonstandard context lines", () => {
  const lines = parseDiffPreview("...\n+added");
  assert.deepEqual(lines, [
    { marker: " ", content: "...", kind: "context" },
    { marker: "+", content: "added", kind: "added" },
  ]);
});

test("MessageView summarizes thinking content across lines", () => {
  assert.equal(
    buildThinkingSummary("Plan:\n\nInspect the code   and update tests", null, RawMode.Lite),
    "Plan: Inspect the code and update tests"
  );
});

test("MessageView removes a trailing colon from thinking summary", () => {
  assert.equal(buildThinkingSummary("Planning:", null, RawMode.Lite), "Planning");
});

test("MessageView falls back to a reasoning placeholder for hidden reasoning content in Lite mode", () => {
  assert.equal(
    buildThinkingSummary("", { reasoning_content: "hidden chain of thought" }, RawMode.Lite),
    "(reasoning...)"
  );
});

test("MessageView shows full reasoning content in Normal/Raw mode", () => {
  assert.equal(
    buildThinkingSummary("", { reasoning_content: "hidden chain of thought" }, RawMode.None),
    "hidden chain of thought"
  );
  assert.equal(
    buildThinkingSummary("", { reasoning_content: "hidden chain of thought" }, RawMode.Raw),
    "hidden chain of thought"
  );
});

test("formatBashStatusParams compacts multi-line commands and keeps the final description", () => {
  assert.equal(
    formatBashStatusParams('python3 -c "\nprint(1)\nprint(2)\n"  # Run inline script'),
    'python3 -c " ... "  # Run inline script'
  );
});

test("formatToolStatusParams preserves compacted Bash params but truncates other tools", () => {
  assert.equal(
    formatToolStatusParams({
      name: "bash",
      params: "cat <<'EOF'\nhello\nEOF  # Print heredoc",
      ok: true,
      metadata: null,
    }),
    "cat <<'EOF' ... EOF  # Print heredoc"
  );
  assert.equal(formatToolStatusParams({ name: "read", params: "first\nsecond", ok: true, metadata: null }), "first");
});

// --- renderMessageToStdout tests ---

function makeSessionMessage(overrides: Partial<SessionMessage> & Pick<SessionMessage, "role">): SessionMessage {
  const now = new Date().toISOString();
  return {
    id: overrides.id ?? `test-${Math.random().toString(36).slice(2)}`,
    sessionId: overrides.sessionId ?? "test-session",
    role: overrides.role,
    content: overrides.content ?? null,
    visible: overrides.visible ?? true,
    compacted: overrides.compacted ?? false,
    createTime: overrides.createTime ?? now,
    updateTime: overrides.updateTime ?? now,
    contentParams: overrides.contentParams ?? null,
    messageParams: overrides.messageParams ?? null,
    meta: overrides.meta,
    html: overrides.html,
  };
}

test("renderMessageToStdout returns empty for invisible messages", () => {
  const msg = makeSessionMessage({ role: "user", content: "hello", visible: false });
  assert.equal(renderMessageToStdout(msg, RawMode.Raw), "");
});

test("renderMessageToStdout renders user messages with > prefix", () => {
  const msg = makeSessionMessage({ role: "user", content: "fix the bug" });
  const output = renderMessageToStdout(msg, RawMode.Raw);
  assert.ok(output.includes("> fix the bug"));
});

test("renderMessageToStdout shows (no content) for empty user messages", () => {
  const msg = makeSessionMessage({ role: "user", content: "" });
  const output = renderMessageToStdout(msg, RawMode.Raw);
  assert.ok(output.includes("(no content)"));
});

test("renderMessageToStdout renders assistant non-thinking messages with ✦", () => {
  const msg = makeSessionMessage({ role: "assistant", content: "Here is the fix" });
  const output = renderMessageToStdout(msg, RawMode.Raw);
  assert.ok(output.includes("✦"));
  assert.ok(output.includes("Here is the fix"));
});

test("renderMessageToStdout renders assistant thinking messages with ✧ Thinking", () => {
  const msg = makeSessionMessage({
    role: "assistant",
    content: "Plan:\nAnalyze the code",
    meta: { asThinking: true },
  });
  const output = renderMessageToStdout(msg, RawMode.Lite);
  assert.ok(output.includes("✧"));
  assert.ok(output.includes("Thinking"));
  assert.ok(output.includes("Plan: Analyze the code"));
});

test("renderMessageToStdout renders tool messages with ✧ and tool name", () => {
  const payload = JSON.stringify({ name: "read", ok: true });
  const msg = makeSessionMessage({ role: "tool", content: payload });
  const output = renderMessageToStdout(msg, RawMode.Raw);
  assert.ok(output.includes("✧"));
  assert.ok(output.includes("Read"));
});

test("renderMessageToStdout renders tool messages with resultMd output", () => {
  const payload = JSON.stringify({ name: "read", ok: true });
  const msg = makeSessionMessage({
    role: "tool",
    content: payload,
    meta: { resultMd: "File content:\n  line 1\n  line 2" },
  });
  const output = renderMessageToStdout(msg, RawMode.Raw);
  assert.ok(output.includes("✧"));
  assert.ok(output.includes("Read"));
  assert.ok(output.includes("└ Result"));
  assert.ok(output.includes("File content:"));
  assert.ok(output.includes("line 1"));
});

test("renderMessageToStdout compacts multi-line Bash params", () => {
  const payload = JSON.stringify({ name: "bash", ok: true });
  const msg = makeSessionMessage({
    role: "tool",
    content: payload,
    meta: { paramsMd: 'python3 -c "\nprint(1)\nprint(2)\n"  # Run inline script' },
  });
  const output = renderMessageToStdout(msg, RawMode.Raw);
  assert.ok(output.includes('python3 -c " ... "  # Run inline script'));
  assert.ok(!output.includes("print(1)"));
});

test("renderMessageToStdout renders UpdatePlan tool messages with Plan preview and resultMd", () => {
  const payload = JSON.stringify({
    name: "UpdatePlan",
    ok: true,
    metadata: { plan: "Step 1: Analyze\nStep 2: Implement\nStep 3: Test" },
  });
  const msg = makeSessionMessage({
    role: "tool",
    content: payload,
    meta: { resultMd: "Plan updated successfully" },
  });
  const output = renderMessageToStdout(msg, RawMode.Raw);
  assert.ok(output.includes("UpdatePlan"));
  assert.ok(output.includes("└ Plan"));
  assert.ok(output.includes("Step 1: Analyze"));
  assert.ok(output.includes(" Result"));
  assert.ok(output.includes("Plan updated successfully"));
});

test("renderMessageToStdout renders UpdatePlan tool messages with Plan preview", () => {
  const payload = JSON.stringify({
    name: "UpdatePlan",
    ok: true,
    metadata: { plan: "Step 1: Analyze\nStep 2: Implement\nStep 3: Test" },
  });
  const msg = makeSessionMessage({ role: "tool", content: payload });
  const output = renderMessageToStdout(msg, RawMode.Raw);
  assert.ok(output.includes("UpdatePlan"));
  assert.ok(output.includes("└ Plan"));
  assert.ok(output.includes("Step 1: Analyze"));
  assert.ok(output.includes("Step 2: Implement"));
  // Verify resultMd is NOT included when meta.resultMd is absent
  assert.ok(!output.includes("└ Result"));
});

test("renderMessageToStdout renders system model change messages", () => {
  const msg = makeSessionMessage({
    role: "system",
    content: "Switched to deepseek-v4-pro",
    meta: { settingChange: "model" },
  });
  const output = renderMessageToStdout(msg, RawMode.Raw);
  assert.ok(output.includes("> Switched to deepseek-v4-pro"));
});

test("renderMessageToStdout renders system skill load messages", () => {
  const msg = makeSessionMessage({
    role: "system",
    content: "",
    meta: { skill: { name: "code-review", path: "", description: "" } },
  });
  const output = renderMessageToStdout(msg, RawMode.Raw);
  assert.ok(output.includes("⚡ Loaded skill: code-review"));
});

test("renderMessageToStdout renders system summary messages", () => {
  const msg = makeSessionMessage({
    role: "system",
    content: "",
    meta: { isSummary: true },
  });
  const output = renderMessageToStdout(msg, RawMode.Raw);
  assert.ok(output.includes("(conversation summary inserted)"));
});

test("renderMessageToStdout returns empty for unknown system messages", () => {
  const msg = makeSessionMessage({ role: "system", content: "" });
  assert.equal(renderMessageToStdout(msg, RawMode.Raw), "");
});

// --- getUpdatePlanPreviewLines tests ---

test("getUpdatePlanPreviewLines returns empty for failed tool", () => {
  const summary: ToolSummary = { name: "UpdatePlan", params: "", ok: false, metadata: { plan: "Step 1" } };
  assert.deepEqual(getUpdatePlanPreviewLines(summary), []);
});

test("getUpdatePlanPreviewLines returns empty for non-UpdatePlan tool", () => {
  const summary: ToolSummary = { name: "edit", params: "", ok: true, metadata: { plan: "Step 1" } };
  assert.deepEqual(getUpdatePlanPreviewLines(summary), []);
});

test("getUpdatePlanPreviewLines returns empty for missing plan metadata", () => {
  const summary: ToolSummary = { name: "UpdatePlan", params: "", ok: true, metadata: null };
  assert.deepEqual(getUpdatePlanPreviewLines(summary), []);
});

test("getUpdatePlanPreviewLines returns empty for empty plan string", () => {
  const summary: ToolSummary = { name: "UpdatePlan", params: "", ok: true, metadata: { plan: "" } };
  assert.deepEqual(getUpdatePlanPreviewLines(summary), []);
});

test("getUpdatePlanPreviewLines extracts plan lines and filters empty rows", () => {
  const summary: ToolSummary = {
    name: "UpdatePlan",
    params: "",
    ok: true,
    metadata: { plan: "Step 1: Analyze\n\nStep 2: Implement\n  \nStep 3: Test" },
  };
  assert.deepEqual(getUpdatePlanPreviewLines(summary), ["Step 1: Analyze", "Step 2: Implement", "Step 3: Test"]);
});

// --- parseToolPayload tests ---

test("parseToolPayload returns defaults for null content", () => {
  const result = parseToolPayload(null);
  assert.deepEqual(result, { name: null, ok: true, metadata: null });
});

test("parseToolPayload returns defaults for invalid JSON", () => {
  const result = parseToolPayload("not valid json");
  assert.deepEqual(result, { name: null, ok: true, metadata: null });
});

test("parseToolPayload parses valid JSON with name/ok/metadata", () => {
  const result = parseToolPayload(JSON.stringify({ name: "read", ok: true, metadata: { file: "src/index.ts" } }));
  assert.deepEqual(result, { name: "read", ok: true, metadata: { file: "src/index.ts" } });
});

test("parseToolPayload respects ok: false", () => {
  const result = parseToolPayload(JSON.stringify({ name: "bash", ok: false, metadata: null }));
  assert.deepEqual(result, { name: "bash", ok: false, metadata: null });
});

test("parseToolPayload trims whitespace from name", () => {
  const result = parseToolPayload(JSON.stringify({ name: "  read  ", ok: true }));
  assert.equal(result.name, "read");
});
