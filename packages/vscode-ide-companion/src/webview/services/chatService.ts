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
   * Send a prompt to the chat
   */
  async sendPrompt(options: SendPromptOptions): Promise<{ ok: boolean; error?: string }> {
    const normalizedImages = (options.images ?? []).filter(Boolean);

    const result = await wrpc.sendPrompt.mutate({
      prompt: options.prompt,
      skills: options.skills ?? [],
      images: normalizedImages,
      permissions: options.permissions,
      alwaysAllows: options.alwaysAllows,
    });

    return result as { ok: boolean; error?: string };
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
};

// Types are exported at the top of the file
