import type { SessionEntry, SessionMessage, SessionStatus } from "./session";

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
  messages: SessionMessage[]
): Pick<SessionEntry, "status" | "failReason" | "askPermissions" | "toolCalls"> {
  const active = messages.filter((message) => !message.compacted);
  const assistant = [...active].reverse().find((message) => message.role === "assistant");
  const assistantIndex = assistant ? active.indexOf(assistant) : -1;
  const following = active.slice(assistantIndex + 1);
  const answered = following.some((message) => {
    const meta = message.meta;
    return (
      message.role === "user" &&
      (meta?.isAnswers ||
        (message.visible !== false &&
          !meta?.isToolFollowUp &&
          !meta?.isSummary &&
          !meta?.skill &&
          !meta?.skillCatalog &&
          !meta?.isModelChange))
    );
  });
  const rawCalls = object(assistant?.messageParams).tool_calls;
  const calls = !answered && Array.isArray(rawCalls) ? rawCalls : [];
  const pending: unknown[] = [];
  const questions: unknown[] = [];
  for (const call of calls) {
    const id = object(call).id;
    if (typeof id !== "string" || !id) continue;
    const result = following.find(
      (message) => message.role === "tool" && object(message.messageParams).tool_call_id === id
    );
    if (!result) {
      pending.push(call);
      continue;
    }
    try {
      if (object(JSON.parse(result.content ?? "null")).awaitUserResponse === true) questions.push(call);
    } catch {
      // Plain-text results do not request an answer.
    }
  }
  const pendingIds = new Set(pending.map((call) => object(call).id));
  const askPermissions = entry.askPermissions?.filter((request) => pendingIds.has(request.toolCallId));
  let status = entry.status;
  let failReason = entry.failReason;
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
