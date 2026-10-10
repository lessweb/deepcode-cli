/**
 * Runtime contract for HTTP services.
 *
 * Summary:
 * Defines the runtime surface consumed by route and SSE services. The concrete
 * runtime implementation lives in runtime.ts and the HTTP wiring consumes this
 * contract through the split service modules.
 *
 * Exports:
 * - type ServerRuntime
 */
import type { HeadlessEvent } from "./events";
import type { RequestBody } from "./request-body";
import type { JsonValue } from "./types";

export type ServerRuntime = {
  subscribe(listener: (event: HeadlessEvent) => void): () => void;
  ready(): Promise<JsonValue>;
  getModelConfig(): JsonValue;
  updateModelConfig(body: RequestBody): JsonValue;
  listProcesses(): JsonValue;
  adjustProcessTimeout(body: RequestBody): JsonValue;
  listSessions(): JsonValue;
  renameSession(body: RequestBody): JsonValue;
  deleteSession(body: RequestBody): JsonValue;
  sendSkillsList(): Promise<JsonValue>;
  showSessionsList(): JsonValue;
  openFile(body: RequestBody): JsonValue;
  pendingPermissions(): JsonValue;
  replyPermissions(body: RequestBody): JsonValue;
  selectSession(sessionId: string): Promise<JsonValue>;
  startPrompt(prompt: unknown): JsonValue;
  interrupt(): JsonValue;
  restoreUndo(body: RequestBody, defaults?: { restoreCode?: boolean; restoreConversation?: boolean }): JsonValue;
  newSession(): Promise<JsonValue>;
  undoTargets(): JsonValue;
  getMcpStatus(): unknown[];
};
