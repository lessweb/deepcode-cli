import assert from "node:assert/strict";
import { test } from "node:test";
import type { SkillInfo } from "@vegamo/deepcode-core";
import {
  ComposerState,
  buildComposerCommands,
  filterSlashCommands,
  getSlashToken,
  resolveSlashSubmission,
} from "../composer.js";

test("composer exposes only supported commands and shares CLI matching and parsing", () => {
  const skills = [
    { name: "plan", description: "A skill" },
    { name: "explain", description: "Explain" },
  ] as SkillInfo[];
  const items = buildComposerCommands(skills);
  assert.deepEqual(
    items.filter((item) => item.kind !== "skill").map((item) => item.name),
    ["skills", "plan", "new", "init", "resume", "fork", "continue", "compact", "undo"]
  );
  assert.equal(getSlashToken("/"), "/");
  assert.equal(getSlashToken(" /plan"), null);
  assert.equal(getSlashToken("hello\n/plan"), null);
  assert.deepEqual(
    filterSlashCommands(items, "/PL").map((item) => item.name),
    ["plan", "plan", "explain"]
  );
  assert.deepEqual(filterSlashCommands(items, "/plan "), []);
  assert.equal(resolveSlashSubmission(items, "/plan")?.item.kind, "plan");
  const submission = resolveSlashSubmission(items, "/plan\nReview this\n  carefully");
  assert.equal(submission?.kind, "plan");
  assert.equal(submission?.kind === "plan" && submission.text, "Review this\n  carefully");
  assert.equal(resolveSlashSubmission(items, "/unknown"), null);
});

test("manual cancellation survives session events, but continuation preserves the running mode", () => {
  const state = new ComposerState();
  state.load("a", true, "");
  assert.equal(state.planMode, true);
  state.planMode = false;
  state.updateSession("a", true);
  assert.equal(state.requestMode(), false);
  assert.equal(state.requestMode({ isAnswers: true }), true);
  assert.equal(state.requestMode({ continuation: true }), true);
  state.updateSession("other-session", false);
  assert.equal(state.sessionId, "a");
  assert.equal(state.sessionPlanMode, true);
});

test("one-shot plan submission does not change the next input mode", () => {
  const state = new ComposerState();
  assert.equal(state.requestMode({ planMode: true }), true);
  state.save("");
  state.updateSession("created", true);
  assert.equal(state.planMode, false);
  assert.equal(state.requestMode(), false);
  assert.equal(state.requestMode({ isAnswers: true }), true);
  state.planMode = true;
  assert.equal(state.requestMode(), true);
});

test("draft text and manual mode choice survive session switches and reconstruction", () => {
  const state = new ComposerState();
  state.load("a", true, "");
  state.planMode = false;
  assert.equal(state.load("b", true, "Draft A"), "");
  assert.equal(state.planMode, true);
  assert.equal(state.load("a", true, "Draft B"), "Draft A");
  assert.equal(state.planMode, false);
  const restored = new ComposerState(state.save("Draft A"));
  assert.equal(restored.load("a", true, ""), "Draft A");
  assert.equal(restored.planMode, false);
  assert.equal(restored.load(null, false, "Draft A", true), "");
  assert.equal(restored.planMode, false);
});

test("a newly created session inherits the input draft without leaving a stale new-chat draft", () => {
  const state = new ComposerState();
  state.planMode = true;
  state.save("Next question");
  state.updateSession("a", true);
  const drafts = state.save("Next question");
  assert.equal(drafts.new, undefined);
  assert.deepEqual(drafts.a, { text: "Next question", planMode: true });
  assert.equal(state.load(null, false, "Next question", true), "");
  assert.equal(state.planMode, false);
});

test("replying to a pending plan stays in Plan mode, including after a one-shot request", () => {
  const state = new ComposerState();
  state.updateSession("a", true);
  assert.equal(state.planMode, false);
  assert.equal(state.offerPlanImplementation({ id: "plan-1", sessionId: "a" }), true);
  state.resolvePlanImplementation("stay");
  assert.equal(state.pendingPlanImplementation, null);
  assert.equal(state.requestMode(), true);
  state.updateSession("a", true);
  assert.equal(state.planMode, true);
});

test("implementation choices switch input to Default mode and only resolve once", () => {
  for (const choice of ["implement", "clear-context", "default"] as const) {
    const state = new ComposerState();
    state.load("a", true, "");
    state.offerPlanImplementation({ id: "plan-1", sessionId: "a" });
    assert.deepEqual(state.resolvePlanImplementation(choice), { id: "plan-1", sessionId: "a" });
    assert.equal(state.planMode, false);
    assert.equal(state.resolvePlanImplementation("stay"), null);
    assert.equal(state.planMode, false);
    state.updateSession("a", true);
    assert.equal(state.planMode, false);
  }
});

test("session changes dismiss the plan menu and ignore plans from other sessions", () => {
  const state = new ComposerState();
  state.load("a", true, "");
  state.offerPlanImplementation({ id: "plan-1", sessionId: "a" });
  state.load("b", false, "draft");
  assert.equal(state.pendingPlanImplementation, null);
  assert.equal(state.offerPlanImplementation({ id: "plan-1", sessionId: "a" }), false);
  assert.equal(state.planMode, false);
});
