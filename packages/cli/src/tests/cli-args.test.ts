import { test } from "node:test";
import assert from "node:assert/strict";
import { extractInitialPrompt, extractResumeSessionId } from "../cli-args";

// ── extractInitialPrompt ─────────────────────────────────────────────────────

test("extractInitialPrompt returns prompt after -p", () => {
  assert.equal(extractInitialPrompt(["-p", "hello world"]), "hello world");
});

test("extractInitialPrompt returns prompt after --prompt", () => {
  assert.equal(extractInitialPrompt(["--prompt", "hello world"]), "hello world");
});

test("extractInitialPrompt returns undefined when -p is not present", () => {
  assert.equal(extractInitialPrompt(["--version"]), undefined);
});

test("extractInitialPrompt returns undefined when -p has no value", () => {
  assert.equal(extractInitialPrompt(["-p"]), undefined);
});

test("extractInitialPrompt returns undefined for empty args", () => {
  assert.equal(extractInitialPrompt([]), undefined);
});

test("extractInitialPrompt ignores -p in non-flag position", () => {
  assert.equal(extractInitialPrompt(["--resume", "-p", "hello"]), "hello");
});

// ── extractResumeSessionId ───────────────────────────────────────────────────

test("extractResumeSessionId returns session ID after --resume", () => {
  assert.equal(
    extractResumeSessionId(["--resume", "0a5cb7a5-c39d-4c39-a11b-05f8b22b8df6"]),
    "0a5cb7a5-c39d-4c39-a11b-05f8b22b8df6"
  );
});

test("extractResumeSessionId returns true when --resume has no value (show picker)", () => {
  assert.equal(extractResumeSessionId(["--resume"]), true);
});

test("extractResumeSessionId returns true when --resume is followed by another flag", () => {
  assert.equal(extractResumeSessionId(["--resume", "--force"]), true);
});

test("extractResumeSessionId returns undefined when --resume is not present", () => {
  assert.equal(extractResumeSessionId(["--version"]), undefined);
});

test("extractResumeSessionId returns undefined for empty args", () => {
  assert.equal(extractResumeSessionId([]), undefined);
});

test("extractResumeSessionId works with other flags after sessionId", () => {
  assert.equal(extractResumeSessionId(["--resume", "abc-123", "--force"]), "abc-123");
});

test("extractResumeSessionId does not confuse --resume with other args", () => {
  assert.equal(extractResumeSessionId(["-p", "test"]), undefined);
});

// ── combined usage ───────────────────────────────────────────────────────────

test("extractInitialPrompt and extractResumeSessionId work independently", () => {
  const args = ["--resume", "session-123", "-p", "hello"];
  assert.equal(extractResumeSessionId(args), "session-123");
  assert.equal(extractInitialPrompt(args), "hello");
});

test("extractResumeSessionId with --resume and -p but no sessionId", () => {
  const args = ["--resume", "-p", "hello"];
  assert.equal(extractResumeSessionId(args), true);
  assert.equal(extractInitialPrompt(args), "hello");
});
