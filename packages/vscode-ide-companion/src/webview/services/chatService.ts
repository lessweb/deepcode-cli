/**
 * Chat Service Layer
 *
 * Abstracts all wRPC calls into a typed service interface.
 * This provides:
 * - Better testability (can mock without actual RPC)
 * - Clear API boundary between UI and data layer
 * - Centralized error handling
 */

import { wrpc } from "@/webview/wrpc";
import type { SkillInfo, SessionSummary, SessionMessage, AskPermissionRequest } from "@/webview/types";

// ============================================================================
// Types
// ============================================================================

export interface SendPromptOptions {
  prompt: string;
  skills?: SkillInfo[];
  images?: string[];
  permissions?: Array<{ toolCallId: string; permission: "allow" | "deny" }>;
  alwaysAllows?: string[];
  planMode?: boolean;
  askUserQuestionSummary?: boolean;
}

export interface InitialData {
  sessions: SessionSummary[];
  activeSession: {
    id: string;
    summary: string;
    status: string;
    askPermissions: AskPermissionRequest[] | undefined;
    processes: Record<string, { startTime: string; command: string }> | null;
    messages: SessionMessage[];
  } | null;
  activeEditor: { fileName: string; languageId: string; lineCount: number } | null;
}

export interface SelectSessionResult {
  ok: boolean;
  session?: {
    id: string;
    summary: string;
    status: string;
    askPermissions: AskPermissionRequest[] | undefined;
    processes: Record<string, { startTime: string; command: string }> | null;
  };
  sessions?: SessionSummary[];
  messages?: SessionMessage[];
}

export interface CreateSessionResult {
  sessions: SessionSummary[];
  skills?: SkillInfo[];
}

// ============================================================================
// Service
// ============================================================================

export const chatService = {
  /**
   * Get initial data including sessions, active session, and active editor
   */
  async getInitialData(): Promise<InitialData | null> {
    const data = await wrpc.getInitialData.query();
    return data as InitialData;
  },

  /**
   * Get list of available skills
   */
  async getSkills(sessionId?: string): Promise<SkillInfo[]> {
    const result = await wrpc.getSkills.query(sessionId);
    return (result?.skills as SkillInfo[]) ?? [];
  },

  /**
   * Get list of all sessions
   */
  async getSessions(): Promise<SessionSummary[]> {
    const result = await wrpc.getSessions.query();
    return (result?.sessions as SessionSummary[]) ?? [];
  },

  /**
   * Send a prompt to the chat
   */
  async sendPrompt(options: SendPromptOptions): Promise<{ ok: boolean; error?: string; sessionId?: string }> {
    const normalizedImages = (options.images ?? []).filter(Boolean);
    console.log("options:", options);
    const result = await wrpc.sendPrompt.mutate({
      prompt: options.prompt,
      skills: options.skills ?? [],
      images: normalizedImages,
      permissions: options.permissions,
      alwaysAllows: options.alwaysAllows,
      planMode: options.planMode,
      askUserQuestionSummary: options.askUserQuestionSummary,
    });

    return result as { ok: boolean; error?: string; sessionId?: string };
  },

  /**
   * Create a new chat session
   */
  async createNewSession(): Promise<CreateSessionResult> {
    const result = await wrpc.createNewSession.mutate();
    return result as CreateSessionResult;
  },

  /**
   * Select an existing session
   */
  async selectSession(sessionId: string): Promise<SelectSessionResult> {
    const result = await wrpc.selectSession.query(sessionId);
    return result as SelectSessionResult;
  },

  /**
   * Interrupt the current operation
   */
  async interrupt(): Promise<{ ok: boolean }> {
    const result = await wrpc.interrupt.mutate();
    return result as { ok: boolean };
  },

  /**
   * Deny a permission request
   */
  async denyPermission(sessionId: string): Promise<{ ok: boolean }> {
    const result = await wrpc.denyPermission.mutate(sessionId);
    return result as { ok: boolean };
  },

  /**
   * Copy text to clipboard
   */
  async copyText(text: string): Promise<{ ok: boolean }> {
    const result = await wrpc.copyText.mutate(text);
    return result as { ok: boolean };
  },

  /**
   * Open a file in the editor
   */
  async openFile(filePath: string, line: number = 1): Promise<{ ok: boolean }> {
    const result = await wrpc.openFile.mutate({ filePath, line });
    return result as { ok: boolean };
  },

  /**
   * Open settings
   */
  async openSettings(): Promise<{ ok: boolean }> {
    const result = await wrpc.openSettings.mutate();
    return result as { ok: boolean };
  },

  async showAlert(message: string): Promise<{ ok: boolean }> {
    const result = await wrpc.showAlert.mutate(message);
    return result as { ok: boolean };
  },

  /**
   * Add a system message to the current session
   */
  async addSystemMessage(content: string, meta?: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
    const result = await wrpc.addSystemMessage.mutate({ content, meta });
    return result as { ok: boolean; error?: string; sessionId?: string };
  },

  /**
   * Rename a session
   */
  async renameSession(sessionId: string, summary: string): Promise<{ ok: boolean; error?: string }> {
    const result = await wrpc.renameSession.mutate({ sessionId, summary });
    return result as { ok: boolean; error?: string; sessionId?: string };
  },

  /**
   * Delete a session
   */
  async deleteSession(sessionId: string): Promise<{ ok: boolean; error?: string; wasActiveSession?: boolean }> {
    const result = await wrpc.deleteSession.mutate({ sessionId });
    return result as { ok: boolean; error?: string; wasActiveSession?: boolean };
  },

  /**
   * Get the JSONL file path for a session (for Inspect JSONL)
   */
  async getSessionFilePath(sessionId: string): Promise<{ filePath: string }> {
    const result = await wrpc.getSessionFilePath.query({ sessionId });
    return result as { filePath: string };
  },

  /**
   * Open a chat panel for a session in a specific view column
   * viewColumn: 1 = Active (Open as Editor), 2 = Beside (Open to the Side)
   */
  async openChatPanel(sessionId: string, viewColumn: number): Promise<{ ok: boolean }> {
    const result = await wrpc.openChatPanel.mutate({ sessionId, viewColumn });
    return result as { ok: boolean };
  },

  /**
   * Open the chat in a new VSCode window
   */
  async openChatInNewWindow(sessionId: string): Promise<{ ok: boolean }> {
    const result = await wrpc.openChatInNewWindow.mutate({ sessionId });
    return result as { ok: boolean };
  },

  /**
   * Open a URL in the default browser
   */
  async openExternal(url: string): Promise<{ ok: boolean }> {
    const result = await wrpc.openExternal.mutate({ url });
    return result as { ok: boolean };
  },
};
