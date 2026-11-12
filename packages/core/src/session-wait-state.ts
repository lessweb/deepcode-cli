import { getCurrentToolCallBatch } from "./common/tool-call-batch";
import { parseToolCallForPermissions, type PermissionPlan, type UserToolPermission } from "./common/permissions";
import type { SessionEntry, SessionMessage, SessionStatus } from "./session";

export type SessionWaitState = Pick<SessionEntry, "status" | "failReason" | "askPermissions" | "toolCalls">;

export function assertCurrentPermissionReplies(messages: SessionMessage[], replies: UserToolPermission[]): void {
  const pendingIds = new Set(
    getCurrentToolCallBatch(messages).pending.map((call) => parseToolCallForPermissions(call)?.id)
  );
  if (replies.some((reply) => !pendingIds.has(reply.toolCallId)))
    throw new Error("The tool request has changed. Review the current permission request before continuing.");
}

export function getSessionWaitReason(status: SessionStatus | undefined): string {
  switch (status) {
    case "permission_denied":
      return "Permission was denied. Review the permission request before continuing.";
    case "ask_permission":
      return "Respond to the permission request before continuing.";
    default:
      return "Answer the pending question or send a reply before continuing.";
  }
}

type RecordValue = Record<string, unknown>;
function object(value: unknown): RecordValue {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as RecordValue) : {};
}

/** Reconcile persisted waits with the current, unanswered assistant/tool batch. */
export function reconcileSessionWaitState(
  entry: SessionEntry,
  messages: SessionMessage[],
  permissionPlan?: PermissionPlan
): SessionWaitState {
  const { pending, questions } = getCurrentToolCallBatch(messages);
  const pendingIds = new Set(pending.map((call) => object(call).id));
  const askPermissions = (permissionPlan?.askPermissions ?? entry.askPermissions)?.filter((request) =>
    pendingIds.has(request.toolCallId)
  );
  const needsApproval = Boolean(permissionPlan?.askPermissions.length);
  let status: SessionStatus = needsApproval ? "ask_permission" : entry.status;
  let failReason = needsApproval ? null : entry.failReason;
  if (status === "ask_permission" || status === "permission_denied" || status === "waiting_for_user") {
    if (askPermissions?.length) {
      status = status === "permission_denied" ? "permission_denied" : "ask_permission";
    } else if (questions.length) {
      status = "waiting_for_user";
      failReason = null;
    } else {
      status = "completed";
      failReason = null;
    }
  }
  return {
    status,
    failReason,
    askPermissions: askPermissions?.length ? askPermissions : undefined,
    toolCalls: pending.length || questions.length ? [...pending, ...questions] : null,
  };
}
