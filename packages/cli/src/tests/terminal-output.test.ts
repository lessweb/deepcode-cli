import assert from "node:assert/strict";
import { test } from "node:test";
import { stripTerminalControls } from "./terminal-output";

test("keyboard mode changes do not become visible terminal frames", () => {
  for (const control of ["\u001b[>4;1m", "\u001b[>4;0m", "\u001b[?1004h", "\u001b[?2004l"]) {
    assert.equal(stripTerminalControls(control), "");
  }
});

test("terminal output retains prompt text while removing styling and mode changes", () => {
  const output = "\u001b[>4;1m\u001b[90m> Type your message...\u001b[0m\n4;1m\u001b[>4;0m";
  assert.equal(stripTerminalControls(output), "> Type your message...\n4;1m");
});
