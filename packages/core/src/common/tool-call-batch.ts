import { randomBytes } from "node:crypto";
import type { SessionMessage } from "../session";

export function generateToolCallId(): string {
  return randomBytes(16).toString("hex");
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** The latest assistant batch, until a real user reply or newer assistant supersedes it. */
export function getCurrentToolCallBatch(messages: SessionMessage[]): {
  message: SessionMessage | null;
  pending: unknown[];
  questions: unknown[];
} {
  const active = messages.filter((message) => !message.compacted);
  const assistant = [...active].reverse().find((message) => message.role === "assistant");
  if (!assistant) return { message: null, pending: [], questions: [] };
  const following = active.slice(active.indexOf(assistant) + 1);
  if (
    following.some((message) => {
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
    })
  )
    return { message: null, pending: [], questions: [] };
  const rawCalls = object(assistant.messageParams).tool_calls;
  const calls = Array.isArray(rawCalls) ? rawCalls : [];
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
      // Plain-text results complete the call without asking a question.
    }
  }
  return { message: assistant, pending, questions };
}
