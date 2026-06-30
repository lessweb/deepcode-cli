/**
 * DeepCode server runtime service.
 *
 * Summary:
 * Owns the SessionManager-backed runtime surface used by HTTP routes and SSE.
 * This module moves the concrete runtime class out of the legacy HTTP server
 * shell and implements the shared ServerRuntime contract.
 *
 * Exports:
 * - ServerRuntimeService(projectRoot: string)
 */
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import {
  createOpenAIClient,
  getCompactPromptTokenThreshold,
  resolveCurrentSettings,
  SessionManager,
  writeModelConfigSelection,
  type ResolvedDeepcodingSettings,
  type SessionEntry,
  type UserPromptContent,
} from "@vegamo/deepcode-core";
import type { HeadlessEvent } from "./events";
import {
  buildAvailableModelOptions,
  buildReasoningEffortOptions,
  buildThinkingOptions,
  normalizeModelSelection,
} from "./model-config";
import { getOpenFileCommands, normalizeProjectFilePath, type OpenFileCommand, type OpenFileRequest } from "./open-file";
import { normalizePermissionScopes, normalizeUserPermissions } from "./permissions";
import type { RequestBody } from "./request-body";
import type { ServerRuntime } from "./runtime-contract";
import { serializeMessage, serializeProcesses } from "./session-serialization";
import type { JsonValue } from "./types";

export class ServerRuntimeService implements ServerRuntime {
  private readonly listeners = new Set<(event: HeadlessEvent) => void>();
  private readonly sessionManager: SessionManager;
  private activeRequestId: string | null = null;
  private sequence = 0;

  constructor(private readonly projectRoot: string) {
    this.sessionManager = new SessionManager({
      projectRoot,
      createOpenAIClient: () => createOpenAIClient(projectRoot),
      getResolvedSettings: () => resolveCurrentSettings(projectRoot),
      renderMarkdown: (text) => text,
      onAssistantMessage: (message, shouldConnect) => {
        if (message.visible === false) {
          return;
        }
        this.pushEvent({ type: "appendMessage", message: serializeMessage(message), shouldConnect });
      },
      onSessionEntryUpdated: (entry) => {
        this.pushEvent({
          type: "sessionStatus",
          sessionId: entry.id,
          status: entry.status,
          processes: serializeProcesses(entry.processes),
          askPermissions: entry.askPermissions,
          tokenTelemetry: this.buildTokenTelemetry(entry),
        });
        if (entry.status === "ask_permission") {
          this.pushEvent({
            type: "permissionRequest",
            sessionId: entry.id,
            askPermissions: entry.askPermissions ?? [],
          });
        }
      },
      onLlmStreamProgress: (progress) => this.pushEvent({ type: "llmStreamProgress", progress }),
      onMcpStatusChanged: () => this.pushEvent({ type: "mcpStatus", statuses: this.getMcpStatus() }),
      onProcessStdout: (pid, chunk) => this.pushEvent({ type: "processStdout", pid, chunk }),
    });
  }

  async init(): Promise<void> {
    await this.sessionManager.initMcpServers(resolveCurrentSettings(this.projectRoot).mcpServers);
  }

  dispose(): void {
    this.sessionManager.dispose();
    this.listeners.clear();
  }

  notifyShutdown(): void {
    this.pushEvent({ type: "shutdown" });
  }

  subscribe(listener: (event: HeadlessEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async ready(): Promise<JsonValue> {
    const events: HeadlessEvent[] = [];
    events.push(this.pushEvent(this.buildInitialSessionEvent()));
    events.push(this.pushEvent(await this.buildSkillsListEvent()));
    events.push(
      this.pushEvent({ type: "modelConfig", config: this.buildModelConfig(resolveCurrentSettings(this.projectRoot)) })
    );
    return { ok: true, data: { events } };
  }

  listSessions(): JsonValue {
    return this.sessionManager.listSessions() as unknown as JsonValue;
  }

  async sendSkillsList(sessionId?: string): Promise<JsonValue> {
    const event = await this.buildSkillsListEvent(sessionId);
    this.pushEvent(event);
    return { ok: true, data: event };
  }

  getMcpStatus(): unknown[] {
    return this.sessionManager.getMcpStatus();
  }

  getModelConfig(): JsonValue {
    return { ok: true, data: this.buildModelConfig(resolveCurrentSettings(this.projectRoot)) };
  }

  updateModelConfig(body: RequestBody): JsonValue {
    const current = resolveCurrentSettings(this.projectRoot);
    const selected = normalizeModelSelection(body, current);
    if (!selected.ok) {
      return { ok: false, error: selected.error };
    }
    const result = writeModelConfigSelection(selected.data, current, this.projectRoot);
    const next = resolveCurrentSettings(this.projectRoot);
    const event = this.pushEvent({ type: "modelConfig", config: this.buildModelConfig(next), changed: result.changed });
    return { ok: true, data: event };
  }

  listProcesses(): JsonValue {
    const sessionId = this.sessionManager.getActiveSessionId();
    if (!sessionId) {
      return { ok: false, error: "No active session" };
    }
    const session = this.sessionManager.getSession(sessionId);
    if (!session) {
      return { ok: false, error: "Session not found" };
    }
    return { ok: true, data: { sessionId, processes: serializeProcesses(session.processes) } };
  }

  adjustProcessTimeout(body: RequestBody): JsonValue {
    const delta = normalizeDeltaMs(body.deltaMs);
    if (!delta.ok) {
      return { ok: false, error: delta.error };
    }
    const result = this.sessionManager.adjustActiveBashTimeout(delta.data);
    if (!result) {
      return { ok: false, error: "No adjustable active bash timeout" };
    }
    this.pushActiveSessionStatus();
    return { ok: true, data: result as JsonValue };
  }

  showSessionsList(): JsonValue {
    const event = { type: "showSessionsList", sessions: this.buildSessionsList() };
    this.pushEvent(event);
    return { ok: true, data: event };
  }

  async selectSession(sessionId: string): Promise<JsonValue> {
    const session = this.sessionManager.getSession(sessionId);
    if (!session) {
      return { ok: false, error: "Session not found" };
    }
    this.sessionManager.setActiveSessionId(sessionId);
    const loadEvent = this.buildLoadSessionEvent(session);
    const skillsEvent = await this.buildSkillsListEvent(sessionId);
    this.pushEvent(loadEvent);
    this.pushEvent(skillsEvent);
    return { ok: true, data: { events: [loadEvent, skillsEvent] } };
  }

  async newSession(): Promise<JsonValue> {
    if (this.activeRequestId) {
      return { ok: false, error: "DeepCode is busy" };
    }
    this.sessionManager.setActiveSessionId(null);
    const initEvent = this.buildInitializeEmptyEvent();
    const skillsEvent = await this.buildSkillsListEvent();
    this.pushEvent(initEvent);
    this.pushEvent(skillsEvent);
    return { ok: true, data: { events: [initEvent, skillsEvent] } };
  }

  interrupt(): JsonValue {
    const sessionId = this.sessionManager.getActiveSessionId();
    this.sessionManager.interruptActiveSession();
    this.pushActiveSessionStatus();
    const session = sessionId ? this.sessionManager.getSession(sessionId) : null;
    return { ok: true, data: { sessionId, status: session?.status ?? null } };
  }

  openFile(body: RequestBody): JsonValue {
    const request = normalizeOpenFileRequest(this.projectRoot, body);
    if (!request.ok) {
      return { ok: false, error: request.error };
    }
    const opened = launchOpenFile(request.data, (error) => {
      this.pushEvent({
        type: "openFileFailed",
        filePath: request.data.relativePath,
        absolutePath: request.data.absolutePath,
        line: request.data.line,
        error: error instanceof Error ? error.message : String(error),
      });
    });
    const event = this.pushEvent({
      type: "openFile",
      filePath: request.data.relativePath,
      absolutePath: request.data.absolutePath,
      line: request.data.line,
      opener: opened,
    });
    return { ok: true, data: event };
  }

  undoTargets(): JsonValue {
    const sessionId = this.sessionManager.getActiveSessionId();
    if (!sessionId) {
      return { ok: false, error: "No active session" };
    }
    return { ok: true, data: this.sessionManager.listUndoTargets(sessionId) as unknown as JsonValue };
  }

  restoreUndo(body: RequestBody, defaults: { restoreCode?: boolean; restoreConversation?: boolean } = {}): JsonValue {
    const sessionId = normalizeSessionId(body.sessionId, this.sessionManager.getActiveSessionId());
    if (!sessionId) {
      return { ok: false, error: "No active session" };
    }
    const messageId = typeof body.messageId === "string" ? body.messageId.trim() : "";
    if (!messageId) {
      return { ok: false, error: "messageId is required" };
    }
    const restoreCode = defaults.restoreCode ?? body.restoreCode === true;
    const restoreConversation = defaults.restoreConversation ?? body.restoreConversation !== false;
    if (!restoreCode && !restoreConversation) {
      return { ok: false, error: "restoreCode or restoreConversation must be true" };
    }
    try {
      if (restoreCode) {
        this.sessionManager.restoreSessionCode(sessionId, messageId);
      }
      if (restoreConversation) {
        this.sessionManager.restoreSessionConversation(sessionId, messageId);
      }
      const events: HeadlessEvent[] = [];
      const session = this.sessionManager.getSession(sessionId);
      if (session) {
        const loadEvent = this.buildLoadSessionEvent(session);
        this.pushEvent(loadEvent);
        events.push(loadEvent);
      }
      const listEvent = { type: "showSessionsList", sessions: this.buildSessionsList() };
      this.pushEvent(listEvent);
      events.push(listEvent);
      return {
        ok: true,
        data: { sessionId, messageId, restoredCode: restoreCode, restoredConversation: restoreConversation, events },
      };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  renameSession(body: RequestBody): JsonValue {
    const sessionId = normalizeSessionId(body.sessionId, this.sessionManager.getActiveSessionId());
    const summary = typeof body.summary === "string" ? body.summary : typeof body.name === "string" ? body.name : "";
    if (!sessionId) {
      return { ok: false, error: "sessionId is required" };
    }
    if (!summary.trim()) {
      return { ok: false, error: "summary is required" };
    }
    const renamed = this.sessionManager.renameSession(sessionId, summary);
    if (!renamed) {
      return { ok: false, error: "Session not found or summary is empty" };
    }
    const event = { type: "showSessionsList", sessions: this.buildSessionsList() };
    this.pushEvent(event);
    this.pushActiveSessionStatus();
    return { ok: true, data: event };
  }

  deleteSession(body: RequestBody): JsonValue {
    const sessionId = normalizeSessionId(body.sessionId, this.sessionManager.getActiveSessionId());
    if (!sessionId) {
      return { ok: false, error: "sessionId is required" };
    }
    const wasActive = this.sessionManager.getActiveSessionId() === sessionId;
    const deleted = this.sessionManager.deleteSession(sessionId);
    if (!deleted) {
      return { ok: false, error: "Session not found" };
    }
    const events: HeadlessEvent[] = [];
    if (wasActive) {
      this.sessionManager.setActiveSessionId(null);
      const initEvent = this.buildInitializeEmptyEvent();
      this.pushEvent(initEvent);
      events.push(initEvent);
    }
    const listEvent = { type: "showSessionsList", sessions: this.buildSessionsList() };
    this.pushEvent(listEvent);
    events.push(listEvent);
    return { ok: true, data: { sessionId, events } };
  }

  pendingPermissions(): JsonValue {
    const sessionId = this.sessionManager.getActiveSessionId();
    if (!sessionId) {
      return { ok: false, error: "No active session" };
    }
    const session = this.sessionManager.getSession(sessionId);
    if (!session) {
      return { ok: false, error: "Session not found" };
    }
    return { ok: true, data: { sessionId, status: session.status, askPermissions: session.askPermissions ?? [] } };
  }

  replyPermissions(body: RequestBody): JsonValue {
    const sessionId = this.sessionManager.getActiveSessionId();
    if (!sessionId) {
      return { ok: false, error: "No active session" };
    }
    const session = this.sessionManager.getSession(sessionId);
    if (!session) {
      return { ok: false, error: "Session not found" };
    }
    if (!session.askPermissions || session.askPermissions.length === 0) {
      return { ok: false, error: "No pending permission request" };
    }
    const permissions = normalizeUserPermissions(body.permissions ?? body.decisions);
    if (permissions.length === 0) {
      return { ok: false, error: "No permission replies provided" };
    }
    const alwaysAllows = normalizePermissionScopes(body.alwaysAllows);
    const hasDeny = permissions.some((permission) => permission.permission === "deny");
    const mode = typeof body.mode === "string" ? body.mode : undefined;
    const text =
      typeof body.text === "string" ? body.text : typeof body.prompt === "string" ? body.prompt : "/continue";
    if (hasDeny && mode === "deny-and-stop") {
      this.sessionManager.denySessionPermission(sessionId);
      this.pushActiveSessionStatus();
      return { ok: true, data: { sessionId, denied: true } };
    }
    return this.startPrompt({ text: text.trim() || "/continue", permissions, alwaysAllows });
  }

  startPrompt(userPrompt: unknown): JsonValue {
    if (this.activeRequestId) {
      return { ok: false, error: "DeepCode is busy", requestId: this.activeRequestId };
    }
    const requestId = crypto.randomUUID();
    this.activeRequestId = requestId;
    void this.runPromptTurn(requestId, userPrompt as UserPromptContent);
    return { ok: true, data: { accepted: true, requestId } };
  }

  private async runPromptTurn(requestId: string, userPrompt: UserPromptContent): Promise<void> {
    const previousRequestId = this.activeRequestId;
    this.activeRequestId = requestId;
    const displayPrompt =
      userPrompt.text || (userPrompt.imageUrls && userPrompt.imageUrls.length > 0 ? "粘贴的图像" : "");
    this.pushEvent({ type: "userMessage", content: displayPrompt });
    this.pushEvent({ type: "loading", value: true });
    try {
      await this.sessionManager.handleUserPrompt(userPrompt);
      this.pushEvent(await this.buildSkillsListEvent());
      this.pushActiveSessionStatus();
      this.pushEvent({ type: "showSessionsList", sessions: this.buildSessionsList() });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.pushEvent({ type: "assistant", content: `Request failed: ${message}` });
      this.pushEvent({ type: "error", message });
    } finally {
      this.pushEvent({ type: "loading", value: false });
      this.activeRequestId = previousRequestId === requestId ? null : previousRequestId;
    }
  }

  private pushActiveSessionStatus(): void {
    const sessionId = this.sessionManager.getActiveSessionId();
    const session = sessionId ? this.sessionManager.getSession(sessionId) : null;
    if (!sessionId || !session) {
      return;
    }
    this.pushEvent({
      type: "sessionStatus",
      sessionId,
      status: session.status,
      processes: serializeProcesses(session.processes),
      askPermissions: session.askPermissions,
      tokenTelemetry: this.buildTokenTelemetry(session),
    });
  }

  private pushEvent(event: HeadlessEvent): HeadlessEvent {
    const enriched: HeadlessEvent = {
      ...event,
      requestId: event.requestId ?? this.activeRequestId ?? undefined,
      sequence: ++this.sequence,
      timestamp: new Date().toISOString(),
    };
    for (const listener of this.listeners) {
      listener(enriched);
    }
    return enriched;
  }

  private buildInitialSessionEvent(): HeadlessEvent {
    const sessions = this.sessionManager.listSessions();
    if (sessions.length === 0) {
      return this.buildInitializeEmptyEvent();
    }
    const latestSession = sessions[0];
    this.sessionManager.setActiveSessionId(latestSession.id);
    return this.buildLoadSessionEvent(latestSession);
  }

  private buildInitializeEmptyEvent(): HeadlessEvent {
    return {
      type: "initializeEmpty",
      sessions: this.buildSessionsList(),
      status: null,
      tokenTelemetry: this.buildTokenTelemetry(null),
    };
  }

  private buildLoadSessionEvent(session: SessionEntry): HeadlessEvent {
    const messages = this.sessionManager.listSessionMessages(session.id).filter((message) => message.visible);
    return {
      type: "loadSession",
      sessionId: session.id,
      summary: session.summary || "Untitled",
      status: session.status,
      processes: serializeProcesses(session.processes),
      tokenTelemetry: this.buildTokenTelemetry(session),
      sessions: this.buildSessionsList(),
      messages: messages.map((message) => serializeMessage(message)),
    };
  }

  private async buildSkillsListEvent(sessionId?: string): Promise<HeadlessEvent> {
    const skills = await this.sessionManager.listSkills(
      sessionId ?? this.sessionManager.getActiveSessionId() ?? undefined
    );
    return { type: "skillsList", skills };
  }

  private buildSessionsList(): Array<
    Pick<SessionEntry, "id" | "createTime" | "updateTime" | "status"> & { summary: string }
  > {
    return this.sessionManager.listSessions().map((session) => ({
      id: session.id,
      summary: session.summary || "Untitled",
      createTime: session.createTime,
      updateTime: session.updateTime,
      status: session.status,
    }));
  }

  private buildTokenTelemetry(session: SessionEntry | null): JsonValue {
    const settings = resolveCurrentSettings(this.projectRoot);
    return {
      model: settings.model,
      thinkingEnabled: settings.thinkingEnabled,
      reasoningEffort: settings.reasoningEffort,
      activeTokens: session?.activeTokens ?? 0,
      compactPromptTokenThreshold: getCompactPromptTokenThreshold(settings.model),
      usage: session?.usage ?? null,
    };
  }

  private buildModelConfig(settings: ResolvedDeepcodingSettings): JsonValue {
    return {
      model: settings.model,
      baseURL: settings.baseURL,
      provider: { baseURL: settings.baseURL, apiKeyConfigured: Boolean(settings.apiKey) },
      availableModels: buildAvailableModelOptions(),
      reasoningEfforts: buildReasoningEffortOptions(),
      thinkingOptions: buildThinkingOptions(),
      temperature: settings.temperature,
      thinkingEnabled: settings.thinkingEnabled,
      reasoningEffort: settings.reasoningEffort,
      debugLogEnabled: settings.debugLogEnabled,
      telemetryEnabled: settings.telemetryEnabled,
      webSearchTool: settings.webSearchTool,
    };
  }
}

function normalizeOpenFileRequest(
  projectRoot: string,
  body: RequestBody
): { ok: true; data: OpenFileRequest } | { ok: false; error: string } {
  const rawPath = typeof body.filePath === "string" ? body.filePath : typeof body.path === "string" ? body.path : "";
  const request = normalizeProjectFilePath(projectRoot, rawPath);
  if (!request.ok) {
    return request;
  }
  const lineNumber = Number(body.line ?? 1);
  const line = Number.isInteger(lineNumber) && lineNumber > 0 ? lineNumber : 1;
  return { ok: true, data: { ...request.data, line } };
}

function launchOpenFile(request: OpenFileRequest, onFinalError: (error: unknown) => void): OpenFileCommand | null {
  const commands = getOpenFileCommands(request.absolutePath, request.line);
  let index = 0;
  const tryNext = (): void => {
    const candidate = commands[index];
    if (!candidate) {
      onFinalError(new Error("No available opener command"));
      return;
    }
    index += 1;
    try {
      const child = spawn(candidate.command, candidate.args, { detached: true, stdio: "ignore" });
      child.once("error", () => tryNext());
      child.unref();
    } catch (error) {
      if (index >= commands.length) {
        onFinalError(error);
      } else {
        tryNext();
      }
    }
  };
  tryNext();
  return commands[0] ?? null;
}

function normalizeDeltaMs(value: unknown): { ok: true; data: number } | { ok: false; error: string } {
  const deltaMs = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(deltaMs) && deltaMs !== 0
    ? { ok: true, data: deltaMs }
    : { ok: false, error: "deltaMs must be a non-zero finite number" };
}

function normalizeSessionId(value: unknown, fallback: string | null): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}
