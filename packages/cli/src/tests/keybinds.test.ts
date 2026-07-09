import { test } from "node:test";
import assert from "node:assert/strict";
import { matchKeybind, buildKeybindMatchers } from "../ui";
import type { InputKey } from "../ui/hooks/useTerminalInput";

function key(overrides: Partial<InputKey> = {}): InputKey {
  return {
    upArrow: false,
    downArrow: false,
    leftArrow: false,
    rightArrow: false,
    home: false,
    end: false,
    pageDown: false,
    pageUp: false,
    return: false,
    escape: false,
    ctrl: false,
    shift: false,
    tab: false,
    backspace: false,
    delete: false,
    meta: false,
    focusIn: false,
    focusOut: false,
    paste: false,
    ...overrides,
  };
}

// --------------- matchKeybind ---------------

test("matchKeybind: ctrl+e matches with ctrl modifier", () => {
  assert.equal(matchKeybind("ctrl+e", "e", key({ ctrl: true })), true);
  assert.equal(matchKeybind("ctrl+e", "E", key({ ctrl: true })), true);
});

test("matchKeybind: ctrl+e does not match with extra shift", () => {
  assert.equal(matchKeybind("ctrl+e", "E", key({ ctrl: true, shift: true })), false);
});

test("matchKeybind: ctrl+e does not match without ctrl", () => {
  assert.equal(matchKeybind("ctrl+e", "e", key()), false);
});

test("matchKeybind: ctrl+e does not match wrong key", () => {
  assert.equal(matchKeybind("ctrl+e", "f", key({ ctrl: true })), false);
});

test("matchKeybind: ctrl+shift+g matches with both modifiers", () => {
  assert.equal(matchKeybind("ctrl+shift+g", "g", key({ ctrl: true, shift: true })), true);
  assert.equal(matchKeybind("ctrl+shift+g", "G", key({ ctrl: true, shift: true })), true);
});

test("matchKeybind: ctrl+shift+g does not match with only ctrl", () => {
  assert.equal(matchKeybind("ctrl+shift+g", "g", key({ ctrl: true })), false);
});

test("matchKeybind: ctrl+shift+g does not match extra meta", () => {
  assert.equal(matchKeybind("ctrl+shift+g", "g", key({ ctrl: true, shift: true, meta: true })), false);
});

test("matchKeybind: meta+b matches with meta modifier", () => {
  assert.equal(matchKeybind("meta+b", "b", key({ meta: true })), true);
  assert.equal(matchKeybind("meta+b", "B", key({ meta: true })), true);
});

test("matchKeybind: meta+b does not match with extra shift", () => {
  assert.equal(matchKeybind("meta+b", "B", key({ meta: true, shift: true })), false);
});

test("matchKeybind: meta+b does not match without meta", () => {
  assert.equal(matchKeybind("meta+b", "b", key()), false);
});

test("matchKeybind: handles non-alpha keys like minus", () => {
  assert.equal(matchKeybind("ctrl+-", "-", key({ ctrl: true })), true);
});

test("matchKeybind: handles digit keys", () => {
  assert.equal(matchKeybind("ctrl+1", "1", key({ ctrl: true })), true);
});

test("matchKeybind: empty shortcut returns false", () => {
  assert.equal(matchKeybind("", "e", key({ ctrl: true })), false);
});

test("matchKeybind: shortcut with only modifier returns false", () => {
  assert.equal(matchKeybind("ctrl", "", key({ ctrl: true })), false);
});

test("matchKeybind: shortcut without modifier returns false", () => {
  assert.equal(matchKeybind("e", "e", key()), false);
});

test("matchKeybind: case-insensitive shortcut definition", () => {
  assert.equal(matchKeybind("Ctrl+E", "e", key({ ctrl: true })), true);
  assert.equal(matchKeybind("CTRL+SHIFT+G", "g", key({ ctrl: true, shift: true })), true);
});

// --------------- buildKeybindMatchers ---------------

test("buildKeybindMatchers: builds matchers from KeybindMap", () => {
  const keybinds = { "ctrl+e": "exit", "ctrl+n": "new" };
  const matchers = buildKeybindMatchers(keybinds);
  assert.equal(matchers.length, 2);
  assert.equal(matchers[0]!.action, "exit");
  assert.equal(matchers[1]!.action, "new");
});

test("buildKeybindMatchers: matchers work correctly", () => {
  const keybinds = { "ctrl+s": "skills" };
  const matchers = buildKeybindMatchers(keybinds);
  assert.equal(matchers[0]!.match("s", key({ ctrl: true })), true);
  assert.equal(matchers[0]!.match("s", key()), false);
});

test("buildKeybindMatchers: empty map returns empty array", () => {
  const matchers = buildKeybindMatchers({});
  assert.equal(matchers.length, 0);
});
