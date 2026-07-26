import { test } from "node:test";
import assert from "node:assert/strict";
import { TaskPlanManager } from "../common/task-plan-manager";
import { createTaskPlan, formatPlanMarkdown } from "../common/task-plan";
import type { TaskStepInput } from "../common/task-plan";

const sessionId = "test-session-1";

const sampleSteps: TaskStepInput[] = [
  {
    description: "Add validation to UserService",
    verification: { type: "command", command: "npm test -- UserService" },
    fallback: { type: "rollback_and_retry", alternativeApproach: "Use zod schema instead" },
    maxRetries: 2,
  },
  {
    description: "Add unit tests",
    verification: { type: "command", command: "npm test" },
    fallback: { type: "ask_user" },
  },
  {
    description: "Update documentation",
    fallback: { type: "rollback_and_skip" },
  },
];

test("createPlan initializes all steps as pending", () => {
  const plan = createTaskPlan(sessionId, sampleSteps);
  assert.equal(plan.steps.length, 3);
  assert.equal(plan.state, "planning");
  assert.equal(plan.currentStepIndex, 0);
  for (const step of plan.steps) {
    assert.equal(step.status, "pending");
  }
});

test("TaskPlanManager lifecycle: start → verify → complete → next", () => {
  const manager = new TaskPlanManager();
  manager.createPlan(sessionId, sampleSteps);

  // Start step 0
  manager.startStep(sessionId, 0, "abc123");
  const step0 = manager.getCurrentStep(sessionId)!;
  assert.equal(step0.status, "in_progress");
  assert.equal(step0.checkpointHash, "abc123");

  // Needs verification
  assert.equal(manager.needsVerification(sessionId), true);
  assert.equal(manager.getVerification(sessionId)?.command, "npm test -- UserService");

  // Mark verifying
  manager.markVerifying(sessionId);
  assert.equal(manager.getCurrentStep(sessionId)!.status, "verifying");

  // Complete step 0
  manager.completeStep(sessionId, 0);

  // Step 0 should be completed, and currentStepIndex advanced
  const plan = manager.getPlan(sessionId)!;
  assert.equal(plan.steps[0].status, "completed");
  assert.equal(plan.currentStepIndex, 1);
  assert.equal(manager.getCurrentStep(sessionId)!.description, "Add unit tests");
});

test("TaskPlanManager: fail → retry → fail → fallback", () => {
  const manager = new TaskPlanManager();
  manager.createPlan(sessionId, sampleSteps);
  manager.startStep(sessionId, 0, "def456");

  // Fail step 0
  manager.failStep(sessionId, 0);
  assert.equal(manager.getPlan(sessionId)!.state, "failed");

  // Should retry (retryCount=0 < maxRetries=2)
  assert.equal(manager.shouldRetry(sessionId), true);

  // Retry - increment and reset to pending
  manager.incrementRetry(sessionId);
  const step = manager.getCurrentStep(sessionId)!;
  assert.equal(step.retryCount, 1);
  assert.equal(step.status, "pending");
  assert.equal(manager.getPlan(sessionId)!.state, "executing");

  // Start again, fail again
  manager.startStep(sessionId, 0, "ghi789");
  manager.failStep(sessionId, 0);

  // Retry again (last attempt)
  assert.equal(manager.shouldRetry(sessionId), true);
  manager.incrementRetry(sessionId);
  assert.equal(manager.getCurrentStep(sessionId)!.retryCount, 2);

  manager.startStep(sessionId, 0, "jkl012");
  manager.failStep(sessionId, 0);

  // No more retries
  assert.equal(manager.shouldRetry(sessionId), false);

  // Fallback should be rollback_and_retry
  const fallback = manager.getFallback(sessionId)!;
  assert.equal(fallback.type, "rollback_and_retry");
  assert.equal(fallback.alternativeApproach, "Use zod schema instead");
});

test("TaskPlanManager: skip failed step", () => {
  const manager = new TaskPlanManager();
  manager.createPlan(sessionId, sampleSteps);
  manager.startStep(sessionId, 0, "skip-hash");
  manager.failStep(sessionId, 0);

  // Skip to next step
  manager.skipFailedStep(sessionId);
  const plan = manager.getPlan(sessionId)!;
  assert.equal(plan.currentStepIndex, 1);
  assert.equal(plan.steps[0].status, "completed");
  assert.equal(plan.state, "executing");
});

test("TaskPlanManager: plan completes when all steps done", () => {
  const manager = new TaskPlanManager();
  manager.createPlan(sessionId, sampleSteps);

  manager.startStep(sessionId, 0, "c1");
  manager.completeStep(sessionId, 0);
  manager.startStep(sessionId, 1, "c2");
  manager.completeStep(sessionId, 1);
  manager.startStep(sessionId, 2, "c3");
  manager.completeStep(sessionId, 2);

  assert.equal(manager.getPlan(sessionId)!.state, "completed");
});

test("TaskPlanManager: no verification for steps without verification config", () => {
  const manager = new TaskPlanManager();
  manager.createPlan(sessionId, sampleSteps);

  // Steps 0-1 have verification, skip to step 2 (no verification)
  manager.startStep(sessionId, 0, "c1");
  manager.completeStep(sessionId, 0);
  manager.startStep(sessionId, 1, "c2");
  manager.completeStep(sessionId, 1);

  // Step 2 has no verification
  assert.equal(manager.needsVerification(sessionId), false);
  assert.equal(manager.getVerification(sessionId), null);
});

test("formatPlanMarkdown produces correct markdown", () => {
  const plan = createTaskPlan(sessionId, sampleSteps);
  plan.steps[0].status = "completed";
  plan.steps[1].status = "in_progress";
  plan.steps[1].retryCount = 1;

  const markdown = formatPlanMarkdown(plan);
  const lines = markdown.split("\n");

  assert.match(lines[0] ?? "", /^\[x\] Add validation/);
  assert.match(lines[1] ?? "", /^\[>\] Add unit tests \(retry 1\/2\) → verify: `npm test`/);
  assert.match(lines[2] ?? "", /^\[ \] Update documentation/);
});

test("hasActivePlan returns correct state", () => {
  const manager = new TaskPlanManager();
  const id = "has-active-plan-test";
  assert.equal(manager.hasActivePlan(id), false);

  manager.createPlan(id, sampleSteps);
  assert.equal(manager.hasActivePlan(id), true);

  manager.clearPlan(id);
  assert.equal(manager.hasActivePlan(id), false);
});

test("getPlanMarkdown returns empty for non-existent plan", () => {
  const manager = new TaskPlanManager();
  assert.equal(manager.getPlanMarkdown("no-such-session"), "");
});

test("non-existent session returns null for all queries", () => {
  const manager = new TaskPlanManager();
  assert.equal(manager.getPlan("nonexistent"), null);
  assert.equal(manager.getCurrentStep("nonexistent"), null);
  assert.equal(manager.needsVerification("nonexistent"), false);
  assert.equal(manager.shouldRetry("nonexistent"), false);
  assert.equal(manager.getFallback("nonexistent"), null);
});
