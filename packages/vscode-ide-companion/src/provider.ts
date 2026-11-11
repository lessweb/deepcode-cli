/**
 * Message handling logic for the Deepcoding webview provider.
 * Extracted from extension.ts for testability — no direct vscode dependency.
 */
import { randomUUID } from "node:crypto";
import {
  getCompletedProposedPlan,
  getImplementationPrompt,
  getClearContextImplementationPrompt,
  PLAN_IMPLEMENTATION_CHOICES,
} from "@vegamo/deepcode-core/common/plan-implementation";
import type { SessionManager } from "@vegamo/deepcode-core";
import type { PermissionScope, SessionMessage, SkillInfo, UserToolPermission } from "@vegamo/deepcode-core";
import { prepareToolDiffContent } from "./tool-diff.js";
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
    | "forkSession"
    | "compactSession"
    | "listUndoTargets"
    | "restoreSessionCode"
    | "restoreSessionConversation"
    | "listQueuedMessages"
    | "getQueuePausedReason"
    | "getPreparingPromptId"
    | "enqueuePrompt"
    | "beginQueuedMessageEdit"
    | "finishQueuedMessageEdit"
    | "removeQueuedMessage"
    | "isSessionRunning"
  >;
  postMessage: PostMessageFn;
  renderMarkdown: (text: string) => string;
  copyToClipboard: (text: string) => void;
}

const compactions = new WeakMap<ProviderDeps["sessionManager"], AbortController>();
type PendingPlan = { id: string; sessionId: string; plan: string };
const pendingPlans = new WeakMap<ProviderDeps["sessionManager"], PendingPlan>();

function sendPendingPlan(manager: ProviderDeps["sessionManager"], postMessage: PostMessageFn): void {
  const pending = pendingPlans.get(manager);
  if (pending && pending.sessionId === manager.getActiveSessionId()) {
    postMessage({ type: "planImplementation", id: pending.id, sessionId: pending.sessionId });
  }
}

const activeRequests = new WeakSet<ProviderDeps["sessionManager"]>();
// The first idle submission is already being sent, even while core initializes
// the session before assigning its preparing prompt ID.
const directSubmissions = new WeakMap<ProviderDeps["sessionManager"], { sessionId: string | null; id?: string }>();

function isBusy(manager: ProviderDeps["sessionManager"]): boolean {
  const session = manager.getSession(manager.getActiveSessionId() ?? "");
  return (
    activeRequests.has(manager) ||
    compactions.has(manager) ||
    manager.isSessionRunning(manager.getActiveSessionId() ?? "") ||
    session?.status === "processing" ||
    session?.status === "pending"
  );
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
    releaseQueueEdit(sessionManager);
    const activeSessionId = sessionManager.getActiveSessionId();
    if (isBusy(sessionManager) && activeSessionId && sessionManager.getSession(activeSessionId)) {
      loadSession(activeSessionId, sessionManager, postMessage, renderMarkdown);
    } else if (typeof msg.sessionId === "string" && sessionManager.getSession(msg.sessionId)) {
      loadSession(msg.sessionId, sessionManager, postMessage, renderMarkdown);
    } else if (msg.sessionId === null) {
      await createNewSession(sessionManager, postMessage, false);
    } else {
      loadInitialSession(sessionManager, postMessage, renderMarkdown);
    }
    sendPendingPlan(sessionManager, postMessage);
    if (compactions.has(sessionManager)) postMessage({ type: "commandBusy", value: true });
    await sendSkillsList(sessionManager, postMessage);
    postUndoState(sessionManager, postMessage);
    return true;
  }

  if (msg.type === "requestSkills") {
    await sendSkillsList(sessionManager, postMessage);
    return true;
  }

  if (msg.type === "planImplementationChoice") {
    if (!isBusy(sessionManager)) await handlePlanImplementationChoice(msg, deps);
    return true;
  }

  if (msg.type === "undoAction" || msg.type === "enqueuePrompt") {
    await handleUndoAction(msg, deps);
    return true;
  }

  if (msg.type === "slashCommand" && msg.command === "undo") {
    postUndoState(sessionManager, postMessage);
    postMessage({ type: "openUndo", sessionId: sessionManager.getActiveSessionId() });
    return true;
  }

  if (msg.type === "slashCommand") {
    if (!isBusy(sessionManager)) await handleSlashCommand(msg, deps);
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
    if (isBusy(sessionManager)) {
      const sessionId = sessionManager.getActiveSessionId();
      if (
        sessionId &&
        !compactions.has(sessionManager) &&
        !msg.isAnswers &&
        !permissions.length &&
        !alwaysAllows.length
      ) {
        sessionManager.enqueuePrompt(sessionId, {
          text: prompt,
          imageUrls: images,
          skills,
          planMode: msg.planMode === true,
        });
        postUndoState(sessionManager, postMessage);
      }
      return true;
    }
    const pending = pendingPlans.get(sessionManager);
    const continuesPlan = pending?.sessionId === sessionManager.getActiveSessionId();
    pendingPlans.delete(sessionManager);
    activeRequests.add(sessionManager);
    try {
      await handlePrompt(prompt, skills, images, sessionManager, postMessage, renderMarkdown, {
        permissions: permissions.length > 0 ? permissions : undefined,
        alwaysAllows: alwaysAllows.length > 0 ? alwaysAllows : undefined,
        isAnswers: msg.isAnswers === true ? true : undefined,
        planMode: continuesPlan || msg.planMode === true,
      });
    } finally {
      activeRequests.delete(sessionManager);
      postUndoState(sessionManager, postMessage);
    }
    sendPendingPlan(sessionManager, postMessage);
    return true;
  }

  if (msg.type === "interrupt") {
    pendingPlans.delete(sessionManager);
    compactions.get(sessionManager)?.abort();
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
    if (isBusy(sessionManager)) return true;
    await createNewSession(sessionManager, postMessage);
    return true;
  }

  if (msg.type === "selectSession") {
    if (isBusy(sessionManager)) return true;
    const sessionId = String(msg.sessionId || "").trim();
    if (sessionId) {
      pendingPlans.delete(sessionManager);
      if (sessionId === sessionManager.getActiveSessionId()) releaseQueueEdit(sessionManager);
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

function loadInitialSession(
  sessionManager: ProviderDeps["sessionManager"],
  postMessage: PostMessageFn,
  renderMarkdown: (text: string) => string
): void {
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
  loadSession(latestSession.id, sessionManager, postMessage, renderMarkdown);
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

  if (pendingPlans.get(sessionManager)?.sessionId !== sessionId) pendingPlans.delete(sessionManager);
  const changedSession = sessionManager.getActiveSessionId() !== sessionId;
  sessionManager.setActiveSessionId(sessionId);
  if (changedSession) releaseQueueEdit(sessionManager);
  const messages = sessionManager.listSessionMessages(sessionId);
  const sessions = sessionManager.listSessions();

  postMessage({
    type: "loadSession",
    sessionId,
    summary: session.summary || "Untitled",
    status: session.status,
    planMode: session.planMode === true,
    pluginRateLimitedTool: session.pluginRateLimitedTool ?? null,
    askPermissions: session.askPermissions,
    processes: serializeProcesses(session.processes),
    sessions: toSessionList(sessions),
    messages: messages
      .filter((m) => m.visible)
      .map((m) => ({
        id: m.id,
        createTime: m.createTime,
        contentParams: m.contentParams,
        role: m.role,
        content: prepareToolDiffContent(m.role, m.content),
        html:
          m.role !== "tool" && (m.role !== "user" || m.meta?.isAnswers)
            ? renderMarkdown(
                m.content || (m.messageParams as { reasoning_content?: string } | null)?.reasoning_content || ""
              )
            : undefined,
        meta: m.meta,
      })),
  });
  postUndoState(sessionManager, postMessage);
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
  postMessage: PostMessageFn,
  fresh = true
): Promise<void> {
  pendingPlans.delete(sessionManager);
  sessionManager.setActiveSessionId(null);
  releaseQueueEdit(sessionManager);
  const sessions = sessionManager.listSessions();

  postMessage({
    type: "initializeEmpty",
    fresh,
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
  options: {
    permissions?: UserToolPermission[];
    alwaysAllows?: PermissionScope[];
    isAnswers?: boolean;
    planMode?: boolean;
  } = {}
): Promise<void> {
  const normalizedImages = imageUrls.filter(Boolean);
  const displayPrompt = prompt || (normalizedImages.length > 0 ? "粘贴的图像" : "");
  const isPermissionContinue =
    prompt === "/continue" &&
    normalizedImages.length === 0 &&
    ((options.permissions?.length ?? 0) > 0 || (options.alwaysAllows?.length ?? 0) > 0);

  const optimisticId = randomUUID();
  const optimistic = Boolean(
    displayPrompt &&
    !isPermissionContinue &&
    (options.isAnswers || (options.permissions?.length ?? 0) > 0 || (options.alwaysAllows?.length ?? 0) > 0)
  );
  const beforeIds = new Set(
    optimistic
      ? sessionManager.listSessionMessages(sessionManager.getActiveSessionId() ?? "").map((message) => message.id)
      : []
  );
  if (optimistic) {
    postMessage({
      type: "userMessage",
      id: optimisticId,
      content: displayPrompt,
      html: options.isAnswers ? renderMarkdown(displayPrompt) : undefined,
      meta: options.isAnswers ? { isAnswers: true } : undefined,
    });
  }

  const submissionSessionId = sessionManager.getActiveSessionId();
  const direct =
    !optimistic &&
    !isPermissionContinue &&
    prompt !== "/continue" &&
    (!submissionSessionId || sessionManager.listQueuedMessages(submissionSessionId).length === 0);
  if (direct) directSubmissions.set(sessionManager, { sessionId: submissionSessionId });
  postMessage({ type: "loading", value: true });

  try {
    await sessionManager.handleUserPrompt({
      text: prompt,
      skills,
      imageUrls: normalizedImages,
      permissions: options.permissions,
      alwaysAllows: options.alwaysAllows,
      isAnswers: options.isAnswers,
      planMode: options.planMode === true,
    });
    if (optimistic) {
      const committed = sessionManager
        .listSessionMessages(sessionManager.getActiveSessionId() ?? "")
        .find(
          (message) =>
            message.role === "user" && message.visible && !beforeIds.has(message.id) && message.content === prompt
        );
      if (committed) postMessage({ type: "userMessageCommitted", optimisticId, message: committed });
    }
    await sendSkillsList(sessionManager, postMessage);

    const activeSessionId = sessionManager.getActiveSessionId();
    const activeSession = activeSessionId ? sessionManager.getSession(activeSessionId) : null;
    const plan = getCompletedProposedPlan(
      options.planMode === true,
      activeSession?.status,
      activeSession?.assistantReply ?? null
    );
    if (plan && activeSessionId)
      pendingPlans.set(sessionManager, { id: randomUUID(), sessionId: activeSessionId, plan });
    if (activeSessionId && activeSession) {
      postMessage({
        type: "sessionStatus",
        sessionId: activeSessionId,
        status: activeSession.status,
        planMode: activeSession.planMode === true,
        pluginRateLimitedTool: activeSession.pluginRateLimitedTool ?? null,
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
    if (direct) directSubmissions.delete(sessionManager);
    const sessionId = sessionManager.getActiveSessionId();
    postMessage({
      type: "loading",
      value: false,
      status: sessionId ? (sessionManager.getSession(sessionId)?.status ?? null) : null,
    });
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
      planMode: session.planMode === true,
      pluginRateLimitedTool: session.pluginRateLimitedTool ?? null,
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

async function handleSlashCommand(msg: Record<string, unknown>, deps: ProviderDeps): Promise<void> {
  const { sessionManager: manager, postMessage, renderMarkdown } = deps;
  const command = msg.command;
  pendingPlans.delete(manager);
  const sessionId = manager.getActiveSessionId();
  const notice = (text: string) => postMessage({ type: "commandNotice", text });
  try {
    if (command === "new") {
      await createNewSession(manager, postMessage);
    } else if (command === "resume" || (command === "continue" && (!sessionId || !manager.getSession(sessionId)))) {
      showSessionsList(manager, postMessage);
      postMessage({ type: "openSessionPicker" });
    } else if (command === "fork") {
      if (!sessionId) {
        notice("No active conversation to fork.");
        return;
      }
      const forkId = manager.forkSession(sessionId);
      loadSession(forkId, manager, postMessage, renderMarkdown);
      await sendSkillsList(manager, postMessage, forkId);
    } else if (command === "compact") {
      if (!sessionId) {
        notice("No active conversation to compact.");
        return;
      }
      const controller = new AbortController();
      compactions.set(manager, controller);
      postMessage({ type: "commandBusy", value: true });
      try {
        const changed = await manager.compactSession(sessionId, controller.signal);
        if (!changed) notice("Conversation was not compacted.");
      } catch (error) {
        notice(
          controller.signal.aborted
            ? "Compaction cancelled."
            : `Compaction failed: ${error instanceof Error ? error.message : String(error)}`
        );
      } finally {
        compactions.delete(manager);
        postUndoState(manager, postMessage);
        postMessage({ type: "commandBusy", value: false });
        const session = manager.getSession(sessionId);
        if (session)
          postMessage({
            type: "sessionStatus",
            sessionId,
            status: session.status,
            planMode: session.planMode === true,
          });
        showSessionsList(manager, postMessage);
      }
    } else if (command === "init" || command === "continue") {
      await handleWebviewMessage(
        {
          ...msg,
          type: "userPrompt",
          prompt: `/${command}`,
          images: [],
        },
        deps
      );
    }
  } catch (error) {
    notice(`Command failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function handlePlanImplementationChoice(msg: Record<string, unknown>, deps: ProviderDeps): Promise<void> {
  const { sessionManager: manager, postMessage, renderMarkdown } = deps;
  const pending = pendingPlans.get(manager);
  const choice = msg.choice;
  if (
    !pending ||
    pending.id !== msg.id ||
    pending.sessionId !== msg.sessionId ||
    pending.sessionId !== manager.getActiveSessionId() ||
    !PLAN_IMPLEMENTATION_CHOICES.some((item) => item.value === choice)
  )
    return;

  pendingPlans.delete(manager);
  if (choice === "stay" || choice === "default") return;

  activeRequests.add(manager);
  try {
    if (choice === "clear-context") await createNewSession(manager, postMessage);
    const prompt =
      choice === "clear-context"
        ? getClearContextImplementationPrompt(pending.plan)
        : getImplementationPrompt(pending.plan);
    await handlePrompt(prompt, [], [], manager, postMessage, renderMarkdown, { planMode: false });
  } catch (error) {
    postMessage({
      type: "commandNotice",
      text: `Request failed: ${error instanceof Error ? error.message : String(error)}`,
    });
    postMessage({
      type: "loading",
      value: false,
      status: manager.getSession(manager.getActiveSessionId() ?? "")?.status ?? null,
    });
  } finally {
    activeRequests.delete(manager);
    postUndoState(manager, postMessage);
  }
}

type QueueEdit = { sessionId: string; id: string };
const queueEdits = new WeakMap<ProviderDeps["sessionManager"], QueueEdit>();

export function releaseQueueEdit(manager: ProviderDeps["sessionManager"]): void {
  const edit = queueEdits.get(manager);
  queueEdits.delete(manager);
  if (edit) manager.finishQueuedMessageEdit(edit.sessionId, edit.id);
}

export function postUndoState(manager: ProviderDeps["sessionManager"], postMessage: PostMessageFn): void {
  const sessionId = manager.getActiveSessionId();
  const queued = sessionId ? manager.listQueuedMessages(sessionId) : [];
  const pausedReason = sessionId ? manager.getQueuePausedReason(sessionId) : undefined;
  const direct = directSubmissions.get(manager);
  if (sessionId && direct && !direct.id && (!direct.sessionId || direct.sessionId === sessionId) && queued[0]) {
    direct.sessionId = sessionId;
    direct.id = queued[0].id;
  }
  const preparingId = sessionId ? manager.getPreparingPromptId(sessionId) : undefined;
  const directId = direct?.sessionId === sessionId ? direct?.id : undefined;
  const preparing = !pausedReason
    ? queued.find((message) => message.id === (preparingId ?? directId) && message.id !== queueEdits.get(manager)?.id)
    : undefined;
  postMessage({
    type: "undoState",
    sessionId,
    busy: isBusy(manager) || Boolean(sessionId && manager.isSessionRunning(sessionId)),
    targets: sessionId
      ? manager.listUndoTargets(sessionId).map(({ message, canRestoreCode }) => ({
          id: message.id,
          text: message.content,
          createTime: message.createTime,
          imageUrls: promptImages(message),
          canRestoreCode,
        }))
      : [],
    queued,
    preparing,
    pausedReason,
  });
}

function promptImages(message: SessionMessage): string[] {
  if (message.meta?.userPrompt?.imageUrls) return message.meta.userPrompt.imageUrls;
  const params = Array.isArray(message.contentParams) ? message.contentParams : [message.contentParams];
  return params.flatMap((param) => {
    const part = param as { type?: string; image_url?: { url?: string } } | null;
    return part?.type === "image_url" && typeof part.image_url?.url === "string" ? [part.image_url.url] : [];
  });
}

async function handleUndoAction(msg: Record<string, unknown>, deps: ProviderDeps): Promise<void> {
  const { sessionManager: manager, postMessage } = deps;
  const sessionId = manager.getActiveSessionId();
  const reply = (extra: Record<string, unknown>) =>
    postMessage({
      type: "undoResult",
      requestId: msg.requestId,
      sessionId: msg.sessionId,
      action: msg.action,
      ...extra,
    });
  try {
    if (!sessionId || sessionId !== msg.sessionId) throw new Error("This conversation is no longer active.");
    const id = typeof msg.id === "string" ? msg.id : "";
    const content = {
      text: typeof msg.text === "string" ? msg.text.trim() : "",
      imageUrls: Array.isArray(msg.imageUrls)
        ? msg.imageUrls.filter((url): url is string => typeof url === "string")
        : [],
      skills: Array.isArray(msg.skills) ? (msg.skills as SkillInfo[]) : [],
      planMode: msg.planMode === true,
    };
    if (msg.type === "enqueuePrompt") {
      if (!content.text && !content.imageUrls.length) throw new Error("Enter a message first.");
      if (compactions.has(manager)) throw new Error("Wait for compaction to finish.");
      manager.enqueuePrompt(sessionId, content);
      pendingPlans.delete(manager);
      reply({ ok: true });
    } else if (msg.action === "edit") {
      if (queueEdits.has(manager)) throw new Error("Finish editing the current message first.");
      const queued = manager.beginQueuedMessageEdit(sessionId, id);
      if (!queued) throw new Error("This message is no longer pending.");
      queueEdits.set(manager, { sessionId, id });
      reply({ ok: true, id, draft: queued.content });
    } else if (msg.action === "save" || msg.action === "cancel") {
      const edit = queueEdits.get(manager);
      if (edit?.sessionId !== sessionId || edit.id !== id) throw new Error("This edit is no longer available.");
      if (msg.action === "save" && !content.text && !content.imageUrls.length)
        throw new Error("Enter a message first.");
      queueEdits.delete(manager);
      if (!manager.finishQueuedMessageEdit(sessionId, id, msg.action === "save" ? content : undefined))
        throw new Error("This message is no longer pending.");
      reply({ ok: true });
    } else if (msg.action === "remove") {
      if (!manager.removeQueuedMessage(sessionId, id)) throw new Error("This message is no longer pending.");
      if (queueEdits.get(manager)?.id === id) queueEdits.delete(manager);
      reply({ ok: true, id });
    } else if (msg.action === "conversation" || msg.action === "code-and-conversation") {
      if (isBusy(manager) || manager.isSessionRunning(sessionId))
        throw new Error("Wait for the current request to finish.");
      if (queueEdits.has(manager)) throw new Error("Finish editing the current message first.");
      const target = manager.listUndoTargets(sessionId).find((target) => target.message.id === id);
      if (!target) throw new Error("This message is no longer available.");
      const errors: string[] = [];
      if (msg.action === "code-and-conversation") {
        try {
          manager.restoreSessionCode(sessionId, id);
        } catch (error) {
          errors.push(`File restore failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      let restored = false;
      try {
        manager.restoreSessionConversation(sessionId, id);
        restored = true;
      } catch (error) {
        errors.push(`Conversation restore failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      pendingPlans.delete(manager);
      if (restored) {
        loadSession(sessionId, manager, postMessage, deps.renderMarkdown);
        await sendSkillsList(manager, postMessage, sessionId);
      }
      reply({
        ok: restored,
        error: errors.join(" ") || undefined,
        draft: restored ? { text: target.message.content ?? "", imageUrls: promptImages(target.message) } : undefined,
      });
    } else throw new Error("Unknown message action.");
  } catch (error) {
    reply({ ok: false, error: error instanceof Error ? error.message : String(error) });
  } finally {
    postUndoState(manager, postMessage);
  }
}
