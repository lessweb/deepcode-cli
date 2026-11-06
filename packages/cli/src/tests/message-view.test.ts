import { execFileSync } from "node:child_process";
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import React from "react";
import { renderToString } from "ink";
import { parseDiffPreview } from "../ui";
import { MessageView, getPromptEchoContentWidth } from "../ui/components/MessageView";
import {
  buildThinkingSummary,
  formatBashStatusParams,
  formatToolStatusParams,
  renderMessageToStdout,
  getUpdatePlanPreviewLines,
  parseToolPayload,
} from "../ui/components/MessageView/utils";
import { RawMode } from "../ui/contexts";
import { renderRawModeMessages } from "../ui/utils";
import type { SessionMessage } from "@vegamo/deepcode-core";
import type { ToolSummary } from "../ui/components/MessageView/types";

test("parseDiffPreview removes headers and classifies lines", () => {
  const lines = parseDiffPreview(
    ["--- a/file.txt", "+++ b/file.txt", "@@ -1,1 +1,1 @@", " context", "-old", "+new"].join("\n")
  );

  assert.deepEqual(lines, [
    { marker: " ", content: "context", kind: "context", lineNumber: 1 },
    { marker: "-", content: "old", kind: "removed", lineNumber: 1 },
    { marker: "+", content: "new", kind: "added", lineNumber: 1 },
  ]);
});

test("parseDiffPreview keeps nonstandard context lines", () => {
  const lines = parseDiffPreview("...\n+added");
  assert.deepEqual(lines, [
    { marker: " ", content: "...", kind: "context", lineNumber: null },
    { marker: "+", content: "added", kind: "added", lineNumber: null },
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

test("thinking views prefer metadata summaries over raw reasoning only when the original content is empty", () => {
  for (const content of [null, "", " \n", "Original assistant text"]) {
    const message = makeSessionMessage({
      role: "assistant",
      content,
      messageParams: { reasoning_content: "Full original reasoning" },
      meta: { asThinking: true, reasoningSummary: "Display summary" },
    });
    const expected = content?.trim() || "Display summary";
    for (const collapsed of [true, false]) {
      const rendered = renderToString(React.createElement(MessageView, { message, collapsed, width: 100 }));
      assert.ok(rendered.includes(expected));
      assert.ok(!rendered.includes("Full original reasoning"));
      if (content?.trim()) assert.ok(!rendered.includes("Display summary"));
    }
    for (const mode of [RawMode.Lite, RawMode.None]) {
      const rendered = renderMessageToStdout(message, mode);
      assert.ok(rendered.includes(expected));
      assert.ok(!rendered.includes("Full original reasoning"));
      if (content?.trim()) assert.ok(!rendered.includes("Display summary"));
    }
    assert.equal(renderMessageToStdout(message, RawMode.Raw), "");
    assert.equal(message.content, content);
  }
});

test("thinking views keep existing reasoning fallback when no metadata summary is available", () => {
  for (const reasoningSummary of [undefined, "", " \n"]) {
    const message = makeSessionMessage({
      role: "assistant",
      content: "",
      messageParams: { reasoning_content: "Full original reasoning" },
      meta: { asThinking: true, reasoningSummary },
    });
    for (const collapsed of [true, false]) {
      assert.match(renderToString(React.createElement(MessageView, { message, collapsed })), /\(reasoning\.\.\.\)/);
    }
    assert.match(renderMessageToStdout(message, RawMode.Lite), /\(reasoning\.\.\.\)/);
    assert.match(renderMessageToStdout(message, RawMode.None), /Full original reasoning/);
  }
});

test("ordinary assistant replies do not use reasoning summaries as their body", () => {
  const message = makeSessionMessage({
    role: "assistant",
    content: "",
    meta: { reasoningSummary: "Display summary" },
  });
  assert.doesNotMatch(renderToString(React.createElement(MessageView, { message })), /Display summary/);
  assert.doesNotMatch(renderMessageToStdout(message, RawMode.Lite), /Display summary/);
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

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, "");
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

test("MessageView renders only answer user messages as Markdown", () => {
  const regular = makeSessionMessage({ role: "user", content: "**Questions answered**" });
  const answers = makeSessionMessage({
    role: "user",
    content: "**Questions answered**",
    meta: { isAnswers: true },
  });

  const regularOutput = stripAnsi(
    renderToString(React.createElement(MessageView, { message: regular, width: 80 }), { columns: 80 })
  );
  const answersOutput = stripAnsi(
    renderToString(React.createElement(MessageView, { message: answers, width: 80 }), { columns: 80 })
  );

  assert.match(regularOutput, /\*\*Questions answered\*\*/);
  assert.doesNotMatch(answersOutput, /\*\*/);
  assert.match(answersOutput, /Questions answered/);
});

test("renderMessageToStdout renders answer user messages as Markdown", () => {
  const msg = makeSessionMessage({
    role: "user",
    content: "**Questions answered**",
    meta: { isAnswers: true },
  });
  const output = stripAnsi(renderMessageToStdout(msg, RawMode.Raw));

  assert.equal(output, "> Questions answered");
});

test("renderMessageToStdout shows (no content) for empty user messages", () => {
  const msg = makeSessionMessage({ role: "user", content: "" });
  const output = renderMessageToStdout(msg, RawMode.Raw);
  assert.ok(output.includes("(no content)"));
});

test("MessageView echoes submitted user prompts with live prompt wrapping width", () => {
  assert.equal(getPromptEchoContentWidth(8), 5);

  const msg = makeSessionMessage({ role: "user", content: "abcdefg" });
  const output = renderToString(React.createElement(MessageView, { message: msg, width: 8 }), { columns: 8 });

  const text = stripAnsi(output);
  assert.equal(text, " > abcde\n   fg\n");
  assert.ok(
    text
      .trimEnd()
      .split("\n")
      .every((line) => line.length <= 8)
  );
});

test("MessageView keeps prompt words together in user and model-change echoes", () => {
  for (const role of ["user", "system"] as const) {
    const message = makeSessionMessage({ role, content: "hello world", meta: { isModelChange: true } });
    const output = renderToString(React.createElement(MessageView, { message, width: 13 }), { columns: 13 });
    assert.equal(stripAnsi(output), " > hello\n   world\n");
  }
});

test("MessageView echoes model changes with submitted prompt wrapping", () => {
  const msg = makeSessionMessage({
    role: "system",
    content: "abcdefgh",
    meta: { isModelChange: true },
  });
  const output = renderToString(React.createElement(MessageView, { message: msg, width: 8 }), { columns: 8 });

  const text = stripAnsi(output);
  assert.equal(text, " > abcde\n   fgh\n");
  assert.ok(
    text
      .trimEnd()
      .split("\n")
      .every((line) => line.length <= 8)
  );
});

test("renderMessageToStdout renders assistant non-thinking messages with ✦", () => {
  const msg = makeSessionMessage({ role: "assistant", content: "Here is the fix" });
  const output = renderMessageToStdout(msg, RawMode.Raw);
  assert.ok(output.includes("✦"));
  assert.ok(output.includes("Here is the fix"));
});

test("raw scrollback renders only assistant body even when reasoning and tool calls are present", () => {
  const msg = makeSessionMessage({
    role: "assistant",
    content: "**Here is the fix**\n\n```sh\necho hello\n```",
    messageParams: {
      reasoning_content: "Hidden reasoning",
      tool_calls: [{ id: "call-1", type: "function", function: { name: "bash", arguments: "{}" } }],
    },
  });
  assert.equal(stripAnsi(renderMessageToStdout(msg, RawMode.Raw)), `✦ ${msg.content}`);
});

test("raw scrollback excludes empty assistant bodies and reasoning-only messages", () => {
  for (const content of [null, "", " \n\t"]) {
    const msg = makeSessionMessage({
      role: "assistant",
      content,
      messageParams: { reasoning_content: "Hidden reasoning" },
    });
    assert.equal(renderMessageToStdout(msg, RawMode.Raw), "");
  }
});

test("raw scrollback history skips filtered messages without extra spacing", (t) => {
  let output = "";
  t.mock.method(process.stdout, "write", (chunk: string) => {
    output += chunk;
    return true;
  });
  renderRawModeMessages(
    [
      makeSessionMessage({ role: "user", content: "Question" }),
      makeSessionMessage({ role: "assistant", content: "Thinking", meta: { asThinking: true } }),
      makeSessionMessage({ role: "tool", content: "Tool output" }),
      makeSessionMessage({ role: "system", content: "Model changed", meta: { isModelChange: true } }),
      makeSessionMessage({ role: "assistant", content: "Hidden", visible: false }),
      makeSessionMessage({ role: "assistant", content: "  " }),
      makeSessionMessage({ role: "assistant", content: "Answer" }),
    ],
    RawMode.Raw
  );
  assert.equal(stripAnsi(output), "\n> Question\n\n\n✦ Answer\n\n\n\nPress ESC to exit raw mode");
});

test("raw scrollback shows empty state when every message is filtered", (t) => {
  let output = "";
  t.mock.method(process.stdout, "write", (chunk: string) => {
    output += chunk;
    return true;
  });
  renderRawModeMessages(
    [makeSessionMessage({ role: "assistant", content: "Thinking", meta: { asThinking: true } })],
    RawMode.Raw
  );
  assert.equal(
    stripAnsi(output),
    "\n(No messages in this session yet. Start chatting to see them here.)\n\nPress ESC to exit raw mode"
  );
});

test("renderMessageToStdout renders assistant thinking messages with ✧ Thinking", () => {
  const msg = makeSessionMessage({
    role: "assistant",
    content: "Plan:\nAnalyze the code",
    meta: { asThinking: true },
  });
  assert.equal(renderMessageToStdout(msg, RawMode.Raw), "");
  const output = renderMessageToStdout(msg, RawMode.Lite);
  assert.ok(output.includes("✧"));
  assert.ok(output.includes("Thinking"));
  assert.ok(output.includes("Plan: Analyze the code"));
});

test("renderMessageToStdout renders tool messages with ✧ and tool name", () => {
  const payload = JSON.stringify({ name: "read", ok: true });
  const msg = makeSessionMessage({ role: "tool", content: payload });
  assert.equal(renderMessageToStdout(msg, RawMode.Raw), "");
  const output = renderMessageToStdout(msg, RawMode.None);
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
  assert.equal(renderMessageToStdout(msg, RawMode.Raw), "");
  const output = renderMessageToStdout(msg, RawMode.None);
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
  assert.equal(renderMessageToStdout(msg, RawMode.Raw), "");
  const output = renderMessageToStdout(msg, RawMode.None);
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
  assert.equal(renderMessageToStdout(msg, RawMode.Raw), "");
  const output = renderMessageToStdout(msg, RawMode.None);
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
  assert.equal(renderMessageToStdout(msg, RawMode.Raw), "");
  const output = renderMessageToStdout(msg, RawMode.None);
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
    meta: { isModelChange: true },
  });
  assert.equal(renderMessageToStdout(msg, RawMode.Raw), "");
  const output = renderMessageToStdout(msg, RawMode.None);
  assert.ok(output.includes("> Switched to deepseek-v4-pro"));
});

test("renderMessageToStdout renders system skill load messages", () => {
  const msg = makeSessionMessage({
    role: "system",
    content: "",
    meta: { skill: { name: "code-review", path: "", description: "" } },
  });
  assert.equal(renderMessageToStdout(msg, RawMode.Raw), "");
  const output = renderMessageToStdout(msg, RawMode.None);
  assert.ok(output.includes("⚡ Loaded skill: code-review"));
});

test("MessageView renders tool skill load messages with the existing skill status", () => {
  const msg = makeSessionMessage({
    role: "tool",
    content: JSON.stringify({ ok: true, name: "skill", output: "full skill document" }),
    meta: { skill: { name: "code-review", path: "", description: "" } },
  });
  const output = renderToString(React.createElement(MessageView, { message: msg }), { columns: 80 });

  assert.ok(output.includes("⚡ Loaded skill: code-review"));
  assert.equal(renderMessageToStdout(msg, RawMode.Raw), "");
  assert.equal(renderMessageToStdout(msg, RawMode.None).includes("⚡ Loaded skill: code-review"), true);
  assert.equal(output.includes("full skill document"), false);
});

test("renderMessageToStdout renders system summary messages", () => {
  const msg = makeSessionMessage({
    role: "system",
    content: "",
    meta: { isSummary: true },
  });
  assert.equal(renderMessageToStdout(msg, RawMode.Raw), "");
  const output = renderMessageToStdout(msg, RawMode.None);
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

// Both freshly generated metadata and legacy sessions share the same presentation.
for (const name of ["edit", "write"]) {
  test(`MessageView renders ${name} diff paths, totals and aligned line numbers`, () => {
    const projectRoot = path.resolve("/project");
    const relativePath = path.join("src", "example.ts");
    const message = makeSessionMessage({
      role: "tool",
      content: JSON.stringify({
        name,
        ok: true,
        metadata: {
          file_path: path.join(projectRoot, relativePath),
          diff_preview: "--- a/file\n+++ b/file\n@@ -99,1 +99,2 @@\n before\n-old\n+new\n+extra\n after",
        },
      }),
    });
    const output = renderToString(React.createElement(MessageView, { message, projectRoot, width: 80 }), {
      columns: 80,
    });
    assert.ok(output.includes(`└ ${relativePath} · +2 -1`), output);
    assert.ok(output.includes(" 98   before"), output);
    assert.ok(output.includes(" 99 - old"), output);
    assert.ok(output.includes(" 99 + new"), output);
    assert.ok(output.includes("100 + extra"), output);
    assert.ok(output.includes("101   after"), output);
    assert.ok(!output.includes("Changes"));
    assert.ok(!output.includes(projectRoot));
  });
}

test("MessageView keeps line numbers gray independently of added and removed code", () => {
  const message = makeSessionMessage({
    role: "tool",
    content: JSON.stringify({
      name: "edit",
      ok: true,
      metadata: {
        file_path: "/project/file.ts",
        diff_details: {
          added: 1,
          removed: 1,
          lines: [
            { kind: "removed", content: "old", lineNumber: 12 },
            { kind: "added", content: "new", lineNumber: 12 },
          ],
        },
      },
    }),
  });
  const moduleUrl = new URL("../ui/components/MessageView/index.tsx", import.meta.url).href;
  const script = `
    import React from "react";
    import { renderToString } from "ink";
    import { MessageView } from ${JSON.stringify(moduleUrl)};
    console.log(JSON.stringify(renderToString(React.createElement(MessageView, {
      message: ${JSON.stringify(message)}, projectRoot: "/project"
    }))));
  `;
  const output = JSON.parse(
    execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
      env: { ...process.env, FORCE_COLOR: "1" },
      encoding: "utf8",
    })
  );
  assert.ok(output.includes("\x1b[90m12 "), JSON.stringify(output));
  assert.ok(output.includes("\x1b[31m- old"), JSON.stringify(output));
  assert.ok(output.includes("\x1b[32m+ new"), JSON.stringify(output));
});

test("MessageView retains totals and row numbers when long paths and code are truncated", () => {
  const message = makeSessionMessage({
    role: "tool",
    content: JSON.stringify({
      name: "write",
      ok: true,
      metadata: {
        file_path: "/project/very-long-directory-name/another-directory/example.ts",
        diff_details: {
          added: 123,
          removed: 0,
          lines: [
            { kind: "added", content: "x".repeat(100), lineNumber: 1 },
            { kind: "context", content: "...", lineNumber: null },
          ],
        },
      },
    }),
  });
  const output = renderToString(React.createElement(MessageView, { message, projectRoot: "/project", width: 40 }), {
    columns: 40,
  });
  assert.ok(output.includes("+123 -0"), output);
  assert.ok(output.includes("1 + "), output);
  assert.ok(
    output.split("\n").every((line) => line.length <= 40),
    output
  );
});
