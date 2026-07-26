import type { TaskPlan, TaskStep, TaskStepInput, TaskStepFallback, TaskStepVerification } from "./task-plan";
import { createTaskPlan, formatPlanMarkdown } from "./task-plan";

const plansBySession = new Map<string, TaskPlan>();

export class TaskPlanManager {
  hasActivePlan(sessionId: string): boolean {
    return plansBySession.has(sessionId);
  }

  createPlan(sessionId: string, stepInputs: TaskStepInput[]): TaskPlan {
    const plan = createTaskPlan(sessionId, stepInputs);
    plan.state = "executing";
    plansBySession.set(sessionId, plan);
    return plan;
  }

  startStep(sessionId: string, stepIndex: number, checkpointHash: string): void {
    const plan = plansBySession.get(sessionId);
    if (!plan || plan.steps[stepIndex] === undefined) {
      return;
    }
    plan.steps[stepIndex].status = "in_progress";
    plan.steps[stepIndex].checkpointHash = checkpointHash;
    plan.currentStepIndex = stepIndex;
  }

  completeStep(sessionId: string, stepIndex: number): void {
    const plan = plansBySession.get(sessionId);
    if (!plan || plan.steps[stepIndex] === undefined) {
      return;
    }
    plan.steps[stepIndex].status = "completed";

    // Advance to next pending step
    const nextIndex = plan.steps.findIndex((step, i) => i > stepIndex && step.status === "pending");
    if (nextIndex !== -1) {
      plan.currentStepIndex = nextIndex;
    } else {
      plan.state = "completed";
    }
  }

  failStep(sessionId: string, stepIndex: number): void {
    const plan = plansBySession.get(sessionId);
    if (!plan || plan.steps[stepIndex] === undefined) {
      return;
    }
    plan.steps[stepIndex].status = "failed";
    plan.state = "failed";
  }

  // ---- Verification ----

  needsVerification(sessionId: string): boolean {
    const step = this.getCurrentStep(sessionId);
    if (!step) {
      return false;
    }
    if (step.status === "completed") {
      return false;
    }
    return step.verification !== null;
  }

  getVerification(sessionId: string): TaskStepVerification | null {
    const step = this.getCurrentStep(sessionId);
    return step?.verification ?? null;
  }

  markVerifying(sessionId: string): void {
    const step = this.getCurrentStep(sessionId);
    if (step && step.status === "in_progress") {
      step.status = "verifying";
    }
  }

  // ---- Fallback & retry ----

  getFallback(sessionId: string): TaskStepFallback | null {
    const step = this.getCurrentStep(sessionId);
    if (!step || step.status !== "failed") {
      return null;
    }
    return step.fallback;
  }

  shouldRetry(sessionId: string): boolean {
    const step = this.getCurrentStep(sessionId);
    if (!step) {
      return false;
    }
    return step.retryCount < step.maxRetries;
  }

  incrementRetry(sessionId: string): void {
    const step = this.getCurrentStep(sessionId);
    if (step) {
      step.retryCount += 1;
      step.status = "pending";
    }
    const plan = plansBySession.get(sessionId);
    if (plan) {
      plan.state = "executing";
    }
  }

  skipFailedStep(sessionId: string): void {
    const plan = plansBySession.get(sessionId);
    if (!plan) {
      return;
    }
    const step = this.getCurrentStep(sessionId);
    if (step) {
      step.status = "completed";
    }
    const nextIndex = plan.steps.findIndex((s, i) => i > plan.currentStepIndex && s.status === "pending");
    if (nextIndex !== -1) {
      plan.currentStepIndex = nextIndex;
      plan.state = "executing";
    } else {
      plan.state = "completed";
    }
  }

  // ---- Query ----

  getPlan(sessionId: string): TaskPlan | null {
    return plansBySession.get(sessionId) ?? null;
  }

  getCurrentStep(sessionId: string): TaskStep | null {
    const plan = plansBySession.get(sessionId);
    if (!plan) {
      return null;
    }
    return plan.steps[plan.currentStepIndex] ?? null;
  }

  getPlanMarkdown(sessionId: string): string {
    const plan = plansBySession.get(sessionId);
    if (!plan) {
      return "";
    }
    return formatPlanMarkdown(plan);
  }

  clearPlan(sessionId: string): void {
    plansBySession.delete(sessionId);
  }
}
