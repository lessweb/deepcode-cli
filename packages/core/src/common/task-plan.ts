export type TaskStepStatus = "pending" | "in_progress" | "verifying" | "completed" | "failed";

export type VerificationType = "command" | "file_exists" | "test_pass" | "manual";

export type FallbackType = "rollback_and_retry" | "rollback_and_skip" | "ask_user";

export type TaskStepVerification = {
  type: VerificationType;
  command?: string;
  expected?: string;
};

export type TaskStepFallback = {
  type: FallbackType;
  alternativeApproach?: string;
};

export type TaskStep = {
  index: number;
  description: string;
  status: TaskStepStatus;
  verification: TaskStepVerification | null;
  fallback: TaskStepFallback;
  checkpointHash?: string;
  retryCount: number;
  maxRetries: number;
};

export type TaskPlanState = "planning" | "executing" | "completed" | "failed";

export type TaskPlan = {
  sessionId: string;
  steps: TaskStep[];
  currentStepIndex: number;
  state: TaskPlanState;
  createdAt: string;
};

export type TaskStepInput = {
  description: string;
  verification?: TaskStepVerification;
  fallback?: TaskStepFallback;
  maxRetries?: number;
};

export function createTaskStep(index: number, input: TaskStepInput): TaskStep {
  return {
    index,
    description: input.description,
    status: "pending",
    verification: input.verification ?? null,
    fallback: input.fallback ?? { type: "ask_user" },
    retryCount: 0,
    maxRetries: input.maxRetries ?? 2,
  };
}

export function createTaskPlan(sessionId: string, stepInputs: TaskStepInput[]): TaskPlan {
  return {
    sessionId,
    steps: stepInputs.map((input, i) => createTaskStep(i, input)),
    currentStepIndex: 0,
    state: "planning",
    createdAt: new Date().toISOString(),
  };
}

export function formatPlanMarkdown(plan: TaskPlan): string {
  const lines: string[] = [];

  for (const step of plan.steps) {
    const marker = statusMarker(step.status);
    const retry = step.retryCount > 0 ? ` (retry ${step.retryCount}/${step.maxRetries})` : "";
    const verify = step.verification ? ` → verify: \`${step.verification.command ?? step.verification.type}\`` : "";
    lines.push(`${marker} ${step.description}${retry}${verify}`);
  }

  if (plan.state === "failed") {
    lines.push("");
    lines.push(`Plan failed at step ${plan.currentStepIndex + 1}.`);
  }

  return lines.join("\n");
}

function statusMarker(status: TaskStepStatus): string {
  switch (status) {
    case "completed":
      return "[x]";
    case "in_progress":
      return "[>]";
    case "verifying":
      return "[~]";
    case "failed":
      return "[!]";
    default:
      return "[ ]";
  }
}
