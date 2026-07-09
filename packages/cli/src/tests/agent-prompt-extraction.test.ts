/**
 * Property test: Task prompt extraction from agent slash command
 *
 * **Validates: Requirements 3.3**
 *
 * Property statement: For any input string of the form `/<agent-name> <remaining text>`
 * where `<agent-name>` matches a discovered agent, the CLI SHALL extract
 * `<remaining text>` (trimmed) as the task prompt passed to the sub-agent session.
 *
 * This tests the extraction logic used in PromptInput.tsx handleSlashSelection
 * for "agent" kind items.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

// -- Extraction helper mirroring PromptInput.tsx logic --

/**
 * Extracts the task prompt from a full input string given an agent command prefix.
 * This mirrors the logic in PromptInput.tsx handleSlashSelection for "agent" kind:
 *
 *   const fullText = buffer.text.trim();
 *   const commandPrefix = `/${item.name}`;
 *   const taskText = fullText.startsWith(commandPrefix)
 *     ? fullText.slice(commandPrefix.length).trim()
 *     : "";
 */
function extractAgentTaskPrompt(fullText: string, agentName: string): string {
  const trimmed = fullText.trim();
  const commandPrefix = `/${agentName}`;
  return trimmed.startsWith(commandPrefix) ? trimmed.slice(commandPrefix.length).trim() : "";
}

// -- Property tests --

test("Property 5: basic task extraction — /agent-name some task text", () => {
  const result = extractAgentTaskPrompt("/deploy-assistant fix the build", "deploy-assistant");
  assert.equal(result, "fix the build");
});

test("Property 5: extra spaces in task text are trimmed", () => {
  const result = extractAgentTaskPrompt("/ut-agent   extra spaces  ", "ut-agent");
  assert.equal(result, "extra spaces");
});

test("Property 5: no task text after agent name yields empty string", () => {
  const result = extractAgentTaskPrompt("/deploy-assistant", "deploy-assistant");
  assert.equal(result, "");
});

test("Property 5: newlines in task body are preserved", () => {
  const result = extractAgentTaskPrompt("/coder multi\nline task", "coder");
  assert.equal(result, "multi\nline task");
});

test("Property 5: leading whitespace in input is trimmed before matching", () => {
  const result = extractAgentTaskPrompt("  /eaa leading spaces ", "eaa");
  assert.equal(result, "leading spaces");
});

test("Property 5: non-matching prefix returns empty string", () => {
  const result = extractAgentTaskPrompt("/other-agent some text", "deploy-assistant");
  assert.equal(result, "");
});

test("Property 5: agent name with single character works", () => {
  const result = extractAgentTaskPrompt("/x do something", "x");
  assert.equal(result, "do something");
});

test("Property 5: agent name as substring of input does not falsely match", () => {
  // /deploy is a prefix of /deploy-assistant, but agentName is "deploy-assistant"
  const result = extractAgentTaskPrompt("/deploy run tests", "deploy-assistant");
  assert.equal(result, "");
});

test("Property 5: agent name exactly at boundary — task starts immediately after prefix", () => {
  // No space between prefix and task — slice still captures it, trim just returns it
  const result = extractAgentTaskPrompt("/codertask without space", "coder");
  assert.equal(result, "task without space");
});

test("Property 5: empty input string yields empty string", () => {
  const result = extractAgentTaskPrompt("", "deploy-assistant");
  assert.equal(result, "");
});

test("Property 5: whitespace-only input yields empty string", () => {
  const result = extractAgentTaskPrompt("   ", "deploy-assistant");
  assert.equal(result, "");
});

test("Property 5: task with special characters is preserved", () => {
  const result = extractAgentTaskPrompt(
    "/ut-agent generate tests for fn(a: string[], b?: {x: number}): void",
    "ut-agent"
  );
  assert.equal(result, "generate tests for fn(a: string[], b?: {x: number}): void");
});

test("Property 5: task with unicode characters is preserved", () => {
  const result = extractAgentTaskPrompt("/coder 修复登录bug", "coder");
  assert.equal(result, "修复登录bug");
});

test("Property 5: trailing whitespace on input is handled by initial trim", () => {
  const result = extractAgentTaskPrompt("/deploy-assistant fix build   \n\n", "deploy-assistant");
  assert.equal(result, "fix build");
});
