import { initWRPC } from "@webview-rpc/host";
import * as os from "node:os";
import * as path from "node:path";
import * as vscodeApi from "vscode";
import z from "zod";
import { getProjectCode } from "@vegamo/deepcode-core";
import type { SessionManager, SkillInfo, UserToolPermission, PermissionScope } from "@vegamo/deepcode-core";

export interface RouterContext {
  sessionManager: SessionManager;
  postMessage: (message: unknown) => void;
  copyToClipboard: (text: string) => void;
  openFileInEditor: (filePath: string, line: number) => Promise<void>;
  getWorkspaceRoot: () => string;
  openSettings: () => Promise<void>;
  getActiveEditor: () => { fileName: string; languageId: string; lineCount: number } | null;
  openChatPanel: (sessionId: string, viewColumn: number) => void;
}

export const { router, procedure } = initWRPC.context<RouterContext>().create();

function toSessionList(
  sessions: Array<{ id: string; summary?: string | null; createTime: string; updateTime: string; status: string }>
) {
  return sessions.map((s) => ({
    id: s.id,
    summary: s.summary || "Untitled",
    createTime: s.createTime,
    updateTime: s.updateTime,
    status: s.status,
  }));
}

function serializeProcesses(
  processes: Map<string, { startTime: string; command: string }> | null
): Record<string, { startTime: string; command: string }> | null {
  if (!processes || processes.size === 0) return null;
  const serialized: Record<string, { startTime: string; command: string }> = {};
  for (const [pid, entry] of processes.entries()) {
    serialized[pid] = entry;
  }
  return serialized;
}

function getSessionJsonlPath(workspaceRoot: string, sessionId: string): string {
  const projectCode = getProjectCode(workspaceRoot);
  return path.join(os.homedir(), ".deepcode", "projects", projectCode, `${sessionId}.jsonl`);
}

const sendPromptInput = z.object({
  prompt: z.string().default(""),
  skills: z
    .array(
      z.object({
        name: z.string(),
        description: z.string().optional(),
        path: z.string().optional(),
        isLoaded: z.boolean().optional(),
      })
    )
    .default([]),
  images: z.array(z.string()).default([]),
  permissions: z
    .array(
      z.object({
        toolCallId: z.string(),
        permission: z.enum(["allow", "deny"]),
      })
    )
    .optional(),
  alwaysAllows: z.array(z.string()).optional(),
  planMode: z.boolean().optional(),
  askUserQuestionSummary: z.boolean().optional(),
});

export const appRouter = router({
  // --- Queries ---

  getInitialData: procedure.resolve(({ ctx }) => {
    const sessions = ctx.sessionManager.listSessions();
    const sessionsList = toSessionList(sessions);
    const activeSessionId = ctx.sessionManager.getActiveSessionId();
    const activeSession = activeSessionId ? ctx.sessionManager.getSession(activeSessionId) : null;

    let messages: Array<unknown> = [];
    if (activeSessionId && activeSession) {
      messages = ctx.sessionManager
        .listSessionMessages(activeSessionId)
        .filter((m) => m.visible)
        .map((m) => ({
          ...m,
          id: m.id,
          sessionId: m.sessionId,
          role: m.role,
          content: m.content,
          html:
            m.role !== "tool"
              ? m.content || (m.messageParams as { reasoning_content?: string } | null)?.reasoning_content || ""
              : undefined,
          meta: m.meta,
        }));
    }

    // Get active editor info
    const activeEditor = ctx.getActiveEditor();

    return {
      sessions: sessionsList,
      activeSession: activeSession
        ? {
            id: activeSession.id,
            summary: activeSession.summary || "Untitled",
            status: activeSession.status,
            askPermissions: activeSession.askPermissions,
            processes: serializeProcesses(activeSession.processes),
            messages,
          }
        : null,
      activeEditor,
    };
  }),

  getSkills: procedure.input(z.string().optional()).resolve(async ({ ctx, input }) => {
    const skills = await ctx.sessionManager.listSkills(input ?? ctx.sessionManager.getActiveSessionId() ?? undefined);
    return { skills };
  }),

  getSessions: procedure.resolve(({ ctx }) => {
    const sessions = ctx.sessionManager.listSessions();
    return { sessions: toSessionList(sessions) };
  }),

  // --- Mutations ---

  sendPrompt: procedure.input(sendPromptInput).resolve(async ({ ctx, input }) => {
    const { prompt, skills, images, permissions, alwaysAllows, planMode, askUserQuestionSummary } = input;
    const normalizedImages = images.filter(Boolean);

    const hasPayload =
      prompt || normalizedImages.length > 0 || (permissions?.length ?? 0) > 0 || (alwaysAllows?.length ?? 0) > 0;
    if (!hasPayload) {
      return { ok: false, error: "Empty prompt" };
    }

    const displayPrompt = prompt || (normalizedImages.length > 0 ? "粘贴的图像" : "");
    const isPermissionContinue =
      prompt === "/continue" &&
      normalizedImages.length === 0 &&
      ((permissions?.length ?? 0) > 0 || (alwaysAllows?.length ?? 0) > 0);

    // Show user message in webview
    if (displayPrompt && !isPermissionContinue) {
      ctx.postMessage({ type: "userMessage", content: displayPrompt });
    }

    ctx.postMessage({ type: "loading", value: true });

    try {
      const userPrompt = {
        type: "userPrompt",
        text: prompt,
        skills: skills.length > 0 ? (skills as SkillInfo[]) : undefined,
        imageUrls: normalizedImages.length > 0 ? normalizedImages : undefined,
        permissions: permissions && permissions.length > 0 ? (permissions as UserToolPermission[]) : undefined,
        alwaysAllows: alwaysAllows && alwaysAllows.length > 0 ? (alwaysAllows as PermissionScope[]) : undefined,
        planMode,
        askUserQuestionSummary,
      };
      await ctx.sessionManager.handleUserPrompt(userPrompt);

      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.postMessage({
        type: "assistant",
        content: `Request failed: ${message}`,
      });
      return { ok: false, error: message };
    } finally {
      ctx.postMessage({ type: "loading", value: false });
    }
  }),

  createNewSession: procedure.resolve(async ({ ctx }) => {
    ctx.sessionManager.setActiveSessionId(null);
    const sessions = ctx.sessionManager.listSessions();
    const skills = await ctx.sessionManager.listSkills();
    return { sessions: toSessionList(sessions), skills };
  }),

  selectSession: procedure.input(z.string()).resolve(({ ctx, input: sessionId }) => {
    const session = ctx.sessionManager.getSession(sessionId);
    if (!session) {
      return { ok: false, error: "Session not found" };
    }

    ctx.sessionManager.setActiveSessionId(sessionId);
    const messages = ctx.sessionManager.listSessionMessages(sessionId);
    const sessions = ctx.sessionManager.listSessions();

    return {
      ok: true,
      session: {
        id: session.id,
        summary: session.summary || "Untitled",
        status: session.status,
        askPermissions: session.askPermissions,
        processes: serializeProcesses(session.processes),
      },
      sessions: toSessionList(sessions),
      messages: messages
        .filter((m) => m.visible)
        .map((m) => ({
          ...m,
          role: m.role,
          content: m.content || (m.messageParams as { reasoning_content?: string } | null)?.reasoning_content || "",
          meta: m.meta,
        })),
    };
  }),

  interrupt: procedure.resolve(({ ctx }) => {
    ctx.sessionManager.interruptActiveSession();
    return { ok: true };
  }),

  denyPermission: procedure.input(z.string()).resolve(({ ctx, input: sessionId }) => {
    ctx.sessionManager.denySessionPermission(sessionId);
    const session = ctx.sessionManager.getSession(sessionId);
    if (session) {
      ctx.postMessage({
        type: "sessionStatus",
        sessionId,
        status: session.status,
        askPermissions: session.askPermissions,
        processes: serializeProcesses(session.processes),
      });
    }
    return { ok: true };
  }),

  copyText: procedure.input(z.string()).resolve(({ ctx, input }) => {
    ctx.copyToClipboard(input);
    return { ok: true };
  }),

  openFile: procedure
    .input(
      z.object({
        filePath: z.string(),
        line: z.number().default(1),
      })
    )
    .resolve(async ({ ctx, input }) => {
      await ctx.openFileInEditor(input.filePath, input.line);
      return { ok: true };
    }),

  openSettings: procedure.resolve(async ({ ctx }) => {
    await ctx.openSettings();
    return { ok: true };
  }),
  showAlert: procedure.input(z.string()).resolve(({ input }) => {
    console.log("[Extension] Received message:", input);
    vscodeApi.window.showInformationMessage(input);
    return { ok: true };
  }),

  addSystemMessage: procedure
    .input(
      z.object({
        content: z.string(),
        meta: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .resolve(({ ctx, input }) => {
      const activeSessionId = ctx.sessionManager.getActiveSessionId();
      if (!activeSessionId) {
        return { ok: false, error: "No active session" };
      }
      ctx.sessionManager.addSessionSystemMessage(activeSessionId, input.content, true, input.meta);
      return { ok: true };
    }),

  renameSession: procedure
    .input(
      z.object({
        sessionId: z.string(),
        summary: z.string().min(1, "Summary cannot be empty"),
      })
    )
    .resolve(({ ctx, input }) => {
      const ok = ctx.sessionManager.renameSession(input.sessionId, input.summary);
      if (!ok) {
        return { ok: false, error: "Session not found or empty summary" };
      }
      return { ok: true };
    }),

  deleteSession: procedure.input(z.object({ sessionId: z.string() })).resolve(async ({ ctx, input }) => {
    const activeSessionId = ctx.sessionManager.getActiveSessionId();
    const ok = ctx.sessionManager.deleteSession(input.sessionId);
    if (!ok) {
      return { ok: false, error: "Session not found" };
    }
    // If the deleted session was the active one, clear the active session
    if (activeSessionId === input.sessionId) {
      ctx.sessionManager.setActiveSessionId(null);
    }
    return { ok: true, wasActiveSession: activeSessionId === input.sessionId };
  }),

  getSessionFilePath: procedure.input(z.object({ sessionId: z.string() })).resolve(({ ctx, input }) => {
    const filePath = getSessionJsonlPath(ctx.getWorkspaceRoot(), input.sessionId);
    return { filePath };
  }),

  openChatPanel: procedure
    .input(
      z.object({
        sessionId: z.string(),
        viewColumn: z.number().describe("ViewColumn: 1=Active, 2=Beside"),
      })
    )
    .resolve(({ ctx, input }) => {
      ctx.openChatPanel(input.sessionId, input.viewColumn);
      return { ok: true };
    }),

  openChatInNewWindow: procedure.input(z.object({ sessionId: z.string() })).resolve(async ({ ctx, input }) => {
    // Open in current window's editor area (fills it like a dedicated window)
    ctx.openChatPanel(input.sessionId, vscodeApi.ViewColumn.Active);
    return { ok: true };
  }),

  openExternal: procedure.input(z.object({ url: z.string() })).resolve(async ({ input }) => {
    await vscodeApi.env.openExternal(vscodeApi.Uri.parse(input.url));
    return { ok: true };
  }),
});

export type AppRouter = typeof appRouter;
