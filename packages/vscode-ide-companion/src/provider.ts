/**
 * Message handling logic for the Deepcoding webview provider.
 * Extracted from extension.ts for testability — no direct vscode dependency.
 */
import type { SessionManager } from "@vegamo/deepcode-core";
import type { PermissionScope, SkillInfo, UserToolPermission } from "@vegamo/deepcode-core";
import { parseUserToolPermissions, parsePermissionScopes } from "./utils.js";

export interface PostMessageFn {
  (message: unknown): void;
}

export interface ProviderDeps {
  sessionManager: Pick<
    SessionManager,
    | "listSessions"
    | "getSession"
    | "getActiveSessionId"
    | "setActiveSessionId"
    | "listSessionMessages"
    | "handleUserPrompt"
    | "interruptActiveSession"
    | "denySessionPermission"
    | "listSkills"
  >;
  postMessage: PostMessageFn;
  renderMarkdown: (text: string) => string;
  copyToClipboard: (text: string) => void;
}

export interface SessionSummary {
  id: string;
  summary: string;
  createTime: string;
  updateTime: string;
  status: string;
}

function toSessionList(
  sessions: Array<{ id: string; summary?: string | null; createTime: string; updateTime: string; status: string }>
): SessionSummary[] {
  return sessions.map((s) => ({
    id: s.id,
    summary: s.summary || "Untitled",
    createTime: s.createTime,
    updateTime: s.updateTime,
    status: s.status,
  }));
}

/**
 * Routes incoming webview messages to the appropriate handler.
 * Returns true if the message was handled.
 */
export async function handleWebviewMessage(message: unknown, deps: ProviderDeps): Promise<boolean> {
  const { sessionManager, postMessage, renderMarkdown, copyToClipboard } = deps;

  if (!message || typeof message !== "object") {
    return false;
  }

  const msg = message as Record<string, unknown>;

  if (msg.type === "ready") {
    loadInitialSession(sessionManager, postMessage);
    await sendSkillsList(sessionManager, postMessage);
    return true;
  }

  if (msg.type === "requestSkills") {
    await sendSkillsList(sessionManager, postMessage);
    return true;
  }

  if (msg.type === "userPrompt") {
    const prompt = String(msg.prompt || "").trim();
    const images = Array.isArray(msg.images)
      ? (msg.images as unknown[]).filter((image): image is string => typeof image === "string" && image.length > 0)
      : [];
    const permissions = parseUserToolPermissions(msg.permissions);
    const alwaysAllows = parsePermissionScopes(msg.alwaysAllows);
    if (!prompt && images.length === 0 && permissions.length === 0 && alwaysAllows.length === 0) {
      return true;
    }
    const skills = (msg.skills as SkillInfo[]) || [];
    await handlePrompt(prompt, skills, images, sessionManager, postMessage, renderMarkdown, {
      permissions: permissions.length > 0 ? permissions : undefined,
      alwaysAllows: alwaysAllows.length > 0 ? alwaysAllows : undefined,
    });
    return true;
  }

  if (msg.type === "interrupt") {
    sessionManager.interruptActiveSession();
    return true;
  }

  if (msg.type === "denyPermission") {
    const sessionId = String(msg.sessionId || sessionManager.getActiveSessionId() || "").trim();
    if (sessionId) {
      handlePermissionDenied(sessionId, sessionManager, postMessage);
    }
    return true;
  }

  if (msg.type === "createNewSession") {
    await createNewSession(sessionManager, postMessage);
    return true;
  }

  if (msg.type === "selectSession") {
    const sessionId = String(msg.sessionId || "").trim();
    if (sessionId) {
      loadSession(sessionId, sessionManager, postMessage, renderMarkdown);
      await sendSkillsList(sessionManager, postMessage, sessionId);
    }
    return true;
  }

  if (msg.type === "backToList") {
    showSessionsList(sessionManager, postMessage);
    return true;
  }

  if (msg.type === "openFile") {
    // openFile requires vscode API — handled by the caller
    return false;
  }

  if (msg.type === "copyText") {
    const text = String(msg.text || "");
    if (text) {
      copyToClipboard(text);
    }
    return true;
  }

  return false;
}

function loadInitialSession(sessionManager: ProviderDeps["sessionManager"], postMessage: PostMessageFn): void {
  const sessions = sessionManager.listSessions();
  const sessionsList = toSessionList(sessions);

  if (sessions.length === 0) {
    postMessage({
      type: "initializeEmpty",
      sessions: sessionsList,
      status: null,
    });
    return;
  }

  const latestSession = sessions[0];
  loadSession(latestSession.id, sessionManager, postMessage, (t) => t);
}

export function loadSession(
  sessionId: string,
  sessionManager: ProviderDeps["sessionManager"],
  postMessage: PostMessageFn,
  renderMarkdown: (text: string) => string
): void {
  const session = sessionManager.getSession(sessionId);
  if (!session) {
    return;
  }

  sessionManager.setActiveSessionId(sessionId);
  const messages = sessionManager.listSessionMessages(sessionId);
  const sessions = sessionManager.listSessions();

  postMessage({
    type: "loadSession",
    sessionId,
    summary: session.summary || "Untitled",
    status: session.status,
    askPermissions: session.askPermissions,
    processes: serializeProcesses(session.processes),
    sessions: toSessionList(sessions),
    messages: messages
      .filter((m) => m.visible)
      .map((m) => ({
        role: m.role,
        content: m.content,
        html:
          m.role !== "tool"
            ? renderMarkdown(
                m.content || (m.messageParams as { reasoning_content?: string } | null)?.reasoning_content || ""
              )
            : undefined,
        meta: m.meta,
      })),
  });
}

function showSessionsList(sessionManager: ProviderDeps["sessionManager"], postMessage: PostMessageFn): void {
  const sessions = sessionManager.listSessions();
  postMessage({
    type: "showSessionsList",
    sessions: toSessionList(sessions),
  });
}

async function createNewSession(
  sessionManager: ProviderDeps["sessionManager"],
  postMessage: PostMessageFn
): Promise<void> {
  sessionManager.setActiveSessionId(null);
  const sessions = sessionManager.listSessions();

  postMessage({
    type: "initializeEmpty",
    sessions: toSessionList(sessions),
    status: null,
  });
  await sendSkillsList(sessionManager, postMessage);
}

async function sendSkillsList(
  sessionManager: ProviderDeps["sessionManager"],
  postMessage: PostMessageFn,
  sessionId?: string
): Promise<void> {
  const skills = await sessionManager.listSkills(sessionId ?? sessionManager.getActiveSessionId() ?? undefined);
  postMessage({ type: "skillsList", skills });
}

async function handlePrompt(
  prompt: string,
  skills: SkillInfo[],
  imageUrls: string[],
  sessionManager: ProviderDeps["sessionManager"],
  postMessage: PostMessageFn,
  renderMarkdown: (text: string) => string,
  options: { permissions?: UserToolPermission[]; alwaysAllows?: PermissionScope[] } = {}
): Promise<void> {
  const normalizedImages = imageUrls.filter(Boolean);
  const displayPrompt = prompt || (normalizedImages.length > 0 ? "粘贴的图像" : "");
  const isPermissionContinue =
    prompt === "/continue" &&
    normalizedImages.length === 0 &&
    ((options.permissions?.length ?? 0) > 0 || (options.alwaysAllows?.length ?? 0) > 0);

  if (displayPrompt && !isPermissionContinue) {
    postMessage({ type: "userMessage", content: displayPrompt });
  }

  postMessage({ type: "loading", value: true });

  try {
    await sessionManager.handleUserPrompt({
      text: prompt,
      skills,
      imageUrls: normalizedImages,
      permissions: options.permissions,
      alwaysAllows: options.alwaysAllows,
    });
    await sendSkillsList(sessionManager, postMessage);

    const activeSessionId = sessionManager.getActiveSessionId();
    const activeSession = activeSessionId ? sessionManager.getSession(activeSessionId) : null;
    if (activeSessionId && activeSession) {
      postMessage({
        type: "sessionStatus",
        sessionId: activeSessionId,
        status: activeSession.status,
        askPermissions: activeSession.askPermissions,
        processes: serializeProcesses(activeSession.processes),
      });
    }

    const sessions = sessionManager.listSessions();
    postMessage({
      type: "showSessionsList",
      sessions: toSessionList(sessions),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    postMessage({
      type: "assistant",
      html: renderMarkdown(`Request failed: ${message}`),
    });
  } finally {
    postMessage({ type: "loading", value: false });
  }
}

function handlePermissionDenied(
  sessionId: string,
  sessionManager: ProviderDeps["sessionManager"],
  postMessage: PostMessageFn
): void {
  sessionManager.denySessionPermission(sessionId);
  const session = sessionManager.getSession(sessionId);
  if (session) {
    postMessage({
      type: "sessionStatus",
      sessionId,
      status: session.status,
      askPermissions: session.askPermissions,
      processes: serializeProcesses(session.processes),
    });
  }
  showSessionsList(sessionManager, postMessage);
}

function serializeProcesses(
  processes: Map<string, { startTime: string; command: string }> | null
): Record<string, { startTime: string; command: string }> | null {
  if (!processes || processes.size === 0) {
    return null;
  }
  const serialized: Record<string, { startTime: string; command: string }> = {};
  for (const [pid, entry] of processes.entries()) {
    serialized[pid] = entry;
  }
  return serialized;
}
