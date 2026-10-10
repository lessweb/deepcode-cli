/**
 * Session serialization helpers.
 *
 * Summary:
 * Converts core SessionMessage and process maps into JSON-compatible payloads for
 * SSE events and HTTP route responses.
 *
 * Exports:
 * - serializeMessage(message: SessionMessage): JsonValue
 * - serializeProcesses(processes: SessionEntry["processes"]): JsonValue
 */
import type { SessionEntry, SessionMessage } from "@vegamo/deepcode-core";
import type { JsonValue } from "./types";

export function serializeMessage(message: SessionMessage): JsonValue {
  return {
    id: message.id,
    sessionId: message.sessionId,
    role: message.role,
    content: message.content,
    contentParams: message.contentParams,
    messageParams: message.messageParams,
    compacted: message.compacted,
    visible: message.visible,
    createTime: message.createTime,
    updateTime: message.updateTime,
    meta: message.meta,
    checkpointHash: message.checkpointHash,
  };
}

export function serializeProcesses(processes: SessionEntry["processes"]): JsonValue {
  if (!processes || processes.size === 0) {
    return null;
  }
  const result: Record<string, unknown> = {};
  for (const [pid, entry] of processes.entries()) {
    result[pid] = entry;
  }
  return result;
}
