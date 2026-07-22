/**
 * Unit tests for chatService
 *
 * Tests cover:
 * - Service methods with mocked wrpc
 * - Return types
 * - Error handling
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { chatService } from "./chatService";
import { wrpc } from "@/webview/wrpc";

// Mock wrpc
vi.mock("@/webview/wrpc", () => ({
  wrpc: {
    getInitialData: {
      query: vi.fn(),
    },
    getSkills: {
      query: vi.fn(),
    },
    getSessions: {
      query: vi.fn(),
    },
    sendPrompt: {
      mutate: vi.fn(),
    },
    createNewSession: {
      mutate: vi.fn(),
    },
    selectSession: {
      query: vi.fn(),
    },
    interrupt: {
      mutate: vi.fn(),
    },
    denyPermission: {
      mutate: vi.fn(),
    },
    copyText: {
      mutate: vi.fn(),
    },
    openFile: {
      mutate: vi.fn(),
    },
    openSettings: {
      mutate: vi.fn(),
    },
    showAlert: {
      mutate: vi.fn(),
    },
  },
}));

describe("chatService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getInitialData", () => {
    it("returns initial data when available", async () => {
      const mockData = {
        sessions: [{ id: "s1", summary: "Test" }],
        activeSession: { id: "s1", summary: "Test", status: "idle", messages: [], askPermissions: [], processes: null },
        activeEditor: { fileName: "test.ts", languageId: "typescript", lineCount: 10 },
      };

      vi.mocked(wrpc.getInitialData.query).mockResolvedValue(mockData as any);

      const result = await chatService.getInitialData();

      expect(result).toEqual(mockData);
      expect(wrpc.getInitialData.query).toHaveBeenCalledTimes(1);
    });

    it("returns null when no data", async () => {
      vi.mocked(wrpc.getInitialData.query).mockResolvedValue(null as any);

      const result = await chatService.getInitialData();

      expect(result).toBeNull();
    });
  });

  describe("getSkills", () => {
    it("returns skills array when available", async () => {
      const mockSkills = [{ name: "skill1" }, { name: "skill2" }];
      vi.mocked(wrpc.getSkills.query).mockResolvedValue({ skills: mockSkills } as any);

      const result = await chatService.getSkills();

      expect(result).toEqual(mockSkills);
    });

    it("returns skills for specific session", async () => {
      const mockSkills = [{ name: "session-skill" }];
      vi.mocked(wrpc.getSkills.query).mockResolvedValue({ skills: mockSkills } as any);

      const result = await chatService.getSkills("session-123");

      expect(wrpc.getSkills.query).toHaveBeenCalledWith("session-123");
      expect(result).toEqual(mockSkills);
    });

    it("returns empty array when no skills", async () => {
      vi.mocked(wrpc.getSkills.query).mockResolvedValue(null as any);

      const result = await chatService.getSkills();

      expect(result).toEqual([]);
    });
  });

  describe("sendPrompt", () => {
    it("sends prompt with all options", async () => {
      vi.mocked(wrpc.sendPrompt.mutate).mockResolvedValue({ ok: true, sessionId: "new-session-1" } as any);

      const result = await chatService.sendPrompt({
        prompt: "Hello",
        skills: [{ name: "skill1" }],
        images: ["image1.png", ""], // should filter empty
        permissions: [{ toolCallId: "t1", permission: "allow" }],
        alwaysAllows: ["read-in-cwd"],
      });

      expect(result).toEqual({ ok: true, sessionId: "new-session-1" });
      expect(wrpc.sendPrompt.mutate).toHaveBeenCalledWith({
        prompt: "Hello",
        skills: [{ name: "skill1" }],
        images: ["image1.png"],
        permissions: [{ toolCallId: "t1", permission: "allow" }],
        alwaysAllows: ["read-in-cwd"],
      });
    });

    it("sends minimal prompt", async () => {
      vi.mocked(wrpc.sendPrompt.mutate).mockResolvedValue({ ok: true } as any);

      await chatService.sendPrompt({ prompt: "Hello" });

      expect(wrpc.sendPrompt.mutate).toHaveBeenCalledWith({
        prompt: "Hello",
        skills: [],
        images: [],
        permissions: undefined,
        alwaysAllows: undefined,
      });
    });

    it("filters empty images", async () => {
      vi.mocked(wrpc.sendPrompt.mutate).mockResolvedValue({ ok: true } as any);

      await chatService.sendPrompt({
        prompt: "Hello",
        images: ["", "valid.png", ""],
      });

      expect(wrpc.sendPrompt.mutate).toHaveBeenCalledWith({
        prompt: "Hello",
        skills: [],
        images: ["valid.png"],
        permissions: undefined,
        alwaysAllows: undefined,
      });
    });

    it("returns error when sendPrompt fails", async () => {
      vi.mocked(wrpc.sendPrompt.mutate).mockResolvedValue({ ok: false, error: "Network error" } as any);

      const result = await chatService.sendPrompt({ prompt: "Hello" });

      expect(result).toEqual({ ok: false, error: "Network error" });
    });

    it("returns sessionId from the server response", async () => {
      vi.mocked(wrpc.sendPrompt.mutate).mockResolvedValue({ ok: true, sessionId: "session-abc" } as any);

      const result = await chatService.sendPrompt({ prompt: "Create a session" });

      expect(result.sessionId).toBe("session-abc");
    });
  });

  describe("createNewSession", () => {
    it("creates new session and returns sessions", async () => {
      const mockResult = {
        sessions: [{ id: "s1" }, { id: "s2" }],
        skills: [{ name: "skill1" }],
      };
      vi.mocked(wrpc.createNewSession.mutate).mockResolvedValue(mockResult as any);

      const result = await chatService.createNewSession();

      expect(result).toEqual(mockResult);
    });

    it("returns sessions even when no skills", async () => {
      const mockResult = { sessions: [{ id: "s1" }] };
      vi.mocked(wrpc.createNewSession.mutate).mockResolvedValue(mockResult as any);

      const result = await chatService.createNewSession();

      expect(result).toEqual(mockResult);
    });
  });

  describe("selectSession", () => {
    it("returns session data when found", async () => {
      const mockResult = {
        ok: true,
        session: { id: "s1", summary: "Test", status: "idle", askPermissions: [], processes: null },
        sessions: [{ id: "s1" }],
        messages: [{ role: "user", content: "Hello" }],
      };
      vi.mocked(wrpc.selectSession.query).mockResolvedValue(mockResult as any);

      const result = await chatService.selectSession("s1");

      expect(result).toEqual(mockResult);
      expect(wrpc.selectSession.query).toHaveBeenCalledWith("s1");
    });

    it("returns ok false when session not found", async () => {
      vi.mocked(wrpc.selectSession.query).mockResolvedValue({ ok: false, error: "Not found" } as any);

      const result = await chatService.selectSession("nonexistent");

      expect(result.ok).toBe(false);
    });
  });

  describe("interrupt", () => {
    it("returns ok on success", async () => {
      vi.mocked(wrpc.interrupt.mutate).mockResolvedValue({ ok: true } as any);

      const result = await chatService.interrupt();

      expect(result).toEqual({ ok: true });
    });
  });

  describe("denyPermission", () => {
    it("returns ok on success", async () => {
      vi.mocked(wrpc.denyPermission.mutate).mockResolvedValue({ ok: true } as any);

      const result = await chatService.denyPermission("session-123");

      expect(result).toEqual({ ok: true });
      expect(wrpc.denyPermission.mutate).toHaveBeenCalledWith("session-123");
    });
  });

  describe("copyText", () => {
    it("copies text to clipboard", async () => {
      vi.mocked(wrpc.copyText.mutate).mockResolvedValue({ ok: true } as any);

      const result = await chatService.copyText("Hello World");

      expect(result).toEqual({ ok: true });
      expect(wrpc.copyText.mutate).toHaveBeenCalledWith("Hello World");
    });
  });

  describe("openFile", () => {
    it("opens file with default line 1", async () => {
      vi.mocked(wrpc.openFile.mutate).mockResolvedValue({ ok: true } as any);

      const result = await chatService.openFile("test.ts");

      expect(result).toEqual({ ok: true });
      expect(wrpc.openFile.mutate).toHaveBeenCalledWith({ filePath: "test.ts", line: 1 });
    });

    it("opens file at specific line", async () => {
      vi.mocked(wrpc.openFile.mutate).mockResolvedValue({ ok: true } as any);

      await chatService.openFile("test.ts", 42);

      expect(wrpc.openFile.mutate).toHaveBeenCalledWith({ filePath: "test.ts", line: 42 });
    });
  });

  describe("openSettings", () => {
    it("opens settings", async () => {
      vi.mocked(wrpc.openSettings.mutate).mockResolvedValue({ ok: true } as any);

      const result = await chatService.openSettings();

      expect(result).toEqual({ ok: true });
    });
  });

  describe("getSessions", () => {
    it("returns sessions array when available", async () => {
      const mockSessions = [
        { id: "s1", summary: "Session 1", createTime: "2024-01-01", updateTime: "2024-01-01", status: "idle" },
        { id: "s2", summary: "Session 2", createTime: "2024-01-02", updateTime: "2024-01-02", status: "processing" },
      ];
      vi.mocked(wrpc.getSessions.query).mockResolvedValue({ sessions: mockSessions } as any);

      const result = await chatService.getSessions();

      expect(result).toEqual(mockSessions);
      expect(wrpc.getSessions.query).toHaveBeenCalledTimes(1);
    });

    it("returns empty array when no sessions", async () => {
      vi.mocked(wrpc.getSessions.query).mockResolvedValue(null as any);

      const result = await chatService.getSessions();

      expect(result).toEqual([]);
    });

    it("returns empty array when result has no sessions field", async () => {
      vi.mocked(wrpc.getSessions.query).mockResolvedValue({} as any);

      const result = await chatService.getSessions();

      expect(result).toEqual([]);
    });
  });

  describe("showAlert", () => {
    it("shows alert message and returns ok", async () => {
      vi.mocked(wrpc.showAlert.mutate).mockResolvedValue({ ok: true } as any);

      const result = await chatService.showAlert("Test message");

      expect(result).toEqual({ ok: true });
      expect(wrpc.showAlert.mutate).toHaveBeenCalledWith("Test message");
    });

    it("passes any message string to wrpc", async () => {
      vi.mocked(wrpc.showAlert.mutate).mockResolvedValue({ ok: true } as any);

      await chatService.showAlert("New chat button clicked");

      expect(wrpc.showAlert.mutate).toHaveBeenCalledWith("New chat button clicked");
    });
  });
});
