import { test } from "node:test";
import assert from "node:assert/strict";
import type { SessionStatus } from "@vegamo/deepcode-core";
import { createTerminalTitle, terminalTitleState } from "../utils/terminal-title";

test("terminal titles follow changes, deduplicate writes and clear on exit", () => {
  const writes: string[] = [];
  const title = createTerminalTitle({ isTTY: true, write: (text) => writes.push(text) });
  title.set("Deep Code");
  title.set("修复登录");
  title.set("修复登录");
  title.set("Another session");
  title.clear();
  title.clear();
  assert.deepEqual(writes, [
    "\u001b]0;Deep Code\u0007",
    "\u001b]0;修复登录\u0007",
    "\u001b]0;Another session\u0007",
    "\u001b]0;\u0007",
  ]);
});

test("terminal titles strip escape sequences and control characters", () => {
  const writes: string[] = [];
  const title = createTerminalTitle({ isTTY: true, write: (text) => writes.push(text) });
  title.set("Fix\u001b[31m login\u001b[0m\u0007\n\r\u009c\u2028");
  assert.deepEqual(writes, ["\u001b]0;Fix login\u0007"]);
});

test("non-TTY output never receives title control sequences or starts timers", (t) => {
  const interval = t.mock.method(globalThis, "setInterval");
  const writes: string[] = [];
  const title = createTerminalTitle({ write: (text) => writes.push(text) });
  title.set("Fix login");
  title.set("Fix login", "busy");
  title.set("Fix login", "attention");
  title.clear();
  assert.deepEqual(writes, []);
  assert.equal(interval.mock.callCount(), 0);
});

test("session statuses map to the appropriate title indicator", () => {
  const expected = {
    pending: "busy",
    processing: "busy",
    waiting_for_user: "attention",
    ask_permission: "attention",
    completed: "idle",
    failed: "idle",
    interrupted: "idle",
    permission_denied: "idle",
  } as const satisfies Record<SessionStatus, string>;
  for (const status of Object.keys(expected) as SessionStatus[]) {
    assert.equal(terminalTitleState(status), expected[status]);
  }
  assert.equal(terminalTitleState(null), "idle");
  assert.equal(terminalTitleState(undefined), "idle");
});

test("busy titles advance every 100 ms and wrap through all ten frames", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const writes: string[] = [];
  const title = createTerminalTitle({ isTTY: true, write: (text) => writes.push(text) });
  t.after(() => title.clear());
  title.set("修复登录", "busy");
  assert.deepEqual(writes, ["\u001b]0;⠋ 修复登录\u0007"]);
  for (const frame of ["⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏", "⠋"]) {
    const count = writes.length;
    t.mock.timers.tick(99);
    assert.equal(writes.length, count);
    t.mock.timers.tick(1);
    assert.equal(writes.length, count + 1);
    assert.equal(writes.at(-1), `\u001b]0;${frame} 修复登录\u0007`);
  }
});

test("attention titles alternate every second", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const writes: string[] = [];
  const title = createTerminalTitle({ isTTY: true, write: (text) => writes.push(text) });
  t.after(() => title.clear());
  title.set("Approval", "attention");
  assert.deepEqual(writes, ["\u001b]0;[ ! ] Approval\u0007"]);
  t.mock.timers.tick(999);
  assert.equal(writes.length, 1);
  t.mock.timers.tick(1);
  assert.equal(writes.at(-1), "\u001b]0;[ . ] Approval\u0007");
  t.mock.timers.tick(1000);
  assert.equal(writes.at(-1), "\u001b]0;[ ! ] Approval\u0007");
  assert.equal(writes.length, 3);
});

test("state transitions immediately replace indicators and stop previous timers", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const writes: string[] = [];
  const title = createTerminalTitle({ isTTY: true, write: (text) => writes.push(text) });
  t.after(() => title.clear());
  title.set("Task", "busy");
  t.mock.timers.tick(100);
  title.set("Task", "attention");
  t.mock.timers.tick(999);
  assert.equal(writes.length, 3);
  t.mock.timers.tick(1);
  title.set("Task", "busy");
  t.mock.timers.tick(100);
  title.set("Task");
  t.mock.timers.tick(5000);
  assert.deepEqual(writes, [
    "\u001b]0;⠋ Task\u0007",
    "\u001b]0;⠙ Task\u0007",
    "\u001b]0;[ ! ] Task\u0007",
    "\u001b]0;[ . ] Task\u0007",
    "\u001b]0;⠋ Task\u0007",
    "\u001b]0;⠙ Task\u0007",
    "\u001b]0;Task\u0007",
  ]);
});

test("title changes and repeated updates preserve animation timing and sanitize the title", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const writes: string[] = [];
  const title = createTerminalTitle({ isTTY: true, write: (text) => writes.push(text) });
  t.after(() => title.clear());
  title.set("Task", "busy");
  t.mock.timers.tick(150);
  title.set("Task", "busy");
  assert.equal(writes.length, 2);
  title.set("New\u001b[31m title\u0007\n", "busy");
  assert.equal(writes.at(-1), "\u001b]0;⠙ New title\u0007");
  t.mock.timers.tick(50);
  assert.equal(writes.at(-1), "\u001b]0;⠹ New title\u0007");
  assert.equal(writes.length, 4);
});

for (const state of ["busy", "attention"] as const) {
  test(`clearing a ${state} title stops output and allows a fresh animation`, (t) => {
    t.mock.timers.enable({ apis: ["setInterval"] });
    const writes: string[] = [];
    const title = createTerminalTitle({ isTTY: true, write: (text) => writes.push(text) });
    t.after(() => title.clear());
    title.set("Task", state);
    title.clear();
    title.clear();
    t.mock.timers.tick(5000);
    assert.equal(writes.length, 2);
    assert.equal(writes.at(-1), "\u001b]0;\u0007");
    title.set("Task", state);
    assert.equal(writes.at(-1), writes[0]);
    t.mock.timers.tick(state === "busy" ? 100 : 1000);
    assert.equal(writes.length, 4);
    assert.notEqual(writes.at(-1), writes[0]);
  });
}
