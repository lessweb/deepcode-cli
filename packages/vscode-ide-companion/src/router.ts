import * as fs from "node:fs";
import { initWRPC } from "@webview-rpc/host";
import * as os from "node:os";
import * as path from "node:path";
import * as vscodeApi from "vscode";
import z from "zod";
import { getProjectCode, writeModelConfigSelection } from "@vegamo/deepcode-core";
import type {
  SessionManager,
  SkillInfo,
  UserToolPermission,
  PermissionScope,
  SessionEntry,
} from "@vegamo/deepcode-core";
import type { TokenTelemetry } from "@/webview/types";
import { ATTACHMENT_LABEL } from "@/webview/constants";

export interface RouterContext {
  sessionManager: SessionManager;
  postMessage: (message: unknown) => void;
  copyToClipboard: (text: string) => void;
  openFileInEditor: (filePath: string, line: number) => Promise<void>;
  getWorkspaceRoot: () => string;
  openSettings: () => Promise<void>;
  getActiveEditor: () => { fileName: string; languageId: string; lineCount: number } | null;
  openChatPanel: (sessionId: string, viewColumn: number) => void;
  showDiffEditor: (filePath: string, diffPreview: string) => Promise<void>;
  getFileContent: (filePath: string) => string;
  buildTokenTelemetry: (session: SessionEntry | null) => TokenTelemetry;
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
      tokenTelemetry: ctx.buildTokenTelemetry(activeSession),
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

    const displayPrompt = prompt || (normalizedImages.length > 0 ? ATTACHMENT_LABEL : "");
    const promptTrimmed = prompt.trim();
    const isPermissionContinue =
      promptTrimmed === "/continue" &&
      normalizedImages.length === 0 &&
      ((permissions?.length ?? 0) > 0 || (alwaysAllows?.length ?? 0) > 0);
    const isPlainContinue = promptTrimmed === "/continue" && normalizedImages.length === 0;

    // Show user message in webview (skip for /continue commands)
    if (displayPrompt && !isPermissionContinue && !isPlainContinue) {
      ctx.postMessage({
        type: "userMessage",
        content: displayPrompt,
        meta: {
          userPrompt: {
            text: prompt,
            skills: skills.length > 0 ? (skills as SkillInfo[]) : undefined,
            imageUrls: normalizedImages.length > 0 ? normalizedImages : undefined,
            permissions: permissions && permissions.length > 0 ? (permissions as UserToolPermission[]) : undefined,
            alwaysAllows: alwaysAllows && alwaysAllows.length > 0 ? (alwaysAllows as PermissionScope[]) : undefined,
            planMode,
            askUserQuestionSummary,
          },
        },
      });
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

      const sessionId = ctx.sessionManager.getActiveSessionId();
      return { ok: true, sessionId };
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
    return { sessions: toSessionList(sessions), skills, tokenTelemetry: ctx.buildTokenTelemetry(null) };
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
      tokenTelemetry: ctx.buildTokenTelemetry(session),
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
  showAlert: procedure
    .input(
      z.object({
        message: z.string(),
        type: z.enum(["info", "warning", "error"]).optional(),
      })
    )
    .resolve(({ input }) => {
      console.log("[Extension] Received message:", input);
      switch (input.type) {
        case "info":
          vscodeApi.window.showInformationMessage(input.message);
          break;
        case "warning":
          vscodeApi.window.showWarningMessage(input.message);
          break;
        case "error":
          vscodeApi.window.showErrorMessage(input.message);
          break;
        default:
          vscodeApi.window.showInformationMessage(input.message);
      }
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

  showDiffEditor: procedure
    .input(
      z.object({
        filePath: z.string(),
        diffPreview: z.string(),
      })
    )
    .resolve(async ({ ctx, input }) => {
      await ctx.showDiffEditor(input.filePath, input.diffPreview);
      return { ok: true };
    }),

  getFileContent: procedure.input(z.object({ filePath: z.string() })).resolve(({ ctx, input }) => {
    const content = ctx.getFileContent(input.filePath);
    return { content };
  }),

  updateModelConfig: procedure
    .input(
      z.object({
        model: z.string(),
        thinkingEnabled: z.boolean(),
        reasoningEffort: z.enum(["high", "max"]),
      })
    )
    .resolve(({ ctx, input }) => {
      const result = writeModelConfigSelection(
        { model: input.model, thinkingEnabled: input.thinkingEnabled, reasoningEffort: input.reasoningEffort },
        undefined,
        ctx.getWorkspaceRoot()
      );
      // Build fresh token telemetry so the webview can update its display
      const activeSessionId = ctx.sessionManager.getActiveSessionId();
      const activeSession = activeSessionId ? ctx.sessionManager.getSession(activeSessionId) : null;
      const tokenTelemetry = ctx.buildTokenTelemetry(activeSession);
      return { ok: true, changed: result.changed, tokenTelemetry };
    }),

  pickImageFiles: procedure.resolve(async () => {
    const IMAGE_FILTERS: Record<string, string[]> = {
      Images: ["png", "jpg", "jpeg", "gif", "bmp", "webp", "svg", "ico"],
    };

    const uris = await vscodeApi.window.showOpenDialog({
      canSelectMany: true,
      filters: IMAGE_FILTERS,
      openLabel: "Attach Images",
      title: "Select images to attach",
    });

    if (!uris || uris.length === 0) {
      return { files: [] };
    }

    const files: Array<{ name: string; mimeType: string; dataUrl: string }> = [];

    for (const uri of uris) {
      try {
        const filePath = uri.fsPath;
        const buffer = fs.readFileSync(filePath);
        const ext = path.extname(filePath).toLowerCase();
        const mimeMap: Record<string, string> = {
          ".png": "image/png",
          ".jpg": "image/jpeg",
          ".jpeg": "image/jpeg",
          ".gif": "image/gif",
          ".bmp": "image/bmp",
          ".webp": "image/webp",
          ".svg": "image/svg+xml",
          ".ico": "image/x-icon",
        };
        const mimeType = mimeMap[ext] || "image/png";
        const base64 = buffer.toString("base64");
        const dataUrl = `data:${mimeType};base64,${base64}`;
        files.push({
          name: path.basename(filePath),
          mimeType,
          dataUrl,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        void vscodeApi.window.showErrorMessage(`Failed to read image: ${message}`);
      }
    }

    return { files };
  }),
});

export type AppRouter = typeof appRouter;
