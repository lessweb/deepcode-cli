/**
 * Unit tests for ChatProvider & useChat
 *
 * Tests cover:
 * - appReducer state transitions
 * - useChat hook behavior
 * - ChatProvider context provision
 */

import React, { act } from "react";
import { render, screen, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ChatProvider, useChat } from "./ChatProvider";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/webview/wrpc", () => ({
  wrpc: {
    useQuery: vi.fn(() => ({ data: null })),
  },
}));

vi.mock("@/webview/services/chatService", () => ({
  chatService: {
    getInitialData: vi.fn().mockResolvedValue(null),
    getSkills: vi.fn().mockResolvedValue([]),
    sendPrompt: vi.fn().mockResolvedValue({ ok: true }),
    interrupt: vi.fn().mockResolvedValue({ ok: true }),
    createNewSession: vi.fn().mockResolvedValue({ sessions: [] }),
    selectSession: vi.fn().mockResolvedValue({ ok: false }),
    denyPermission: vi.fn().mockResolvedValue({ ok: true }),
    copyText: vi.fn().mockResolvedValue({ ok: true }),
    openFile: vi.fn().mockResolvedValue({ ok: true }),
    openSettings: vi.fn().mockResolvedValue({ ok: true }),
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ChatProvider>{children}</ChatProvider>
      </QueryClientProvider>
    );
  };
}

// Mock window message listener
const messageHandlers = new Set<(event: MessageEvent) => void>();
vi.stubGlobal("addEventListener", (event: string, handler: (e: MessageEvent) => void) => {
  if (event === "message") {
    messageHandlers.add(handler);
  }
});

vi.stubGlobal("removeEventListener", (event: string, handler: (e: MessageEvent) => void) => {
  if (event === "message") {
    messageHandlers.delete(handler);
  }
});

function postMessage(message: Record<string, unknown>) {
  const event = { data: message } as MessageEvent;
  messageHandlers.forEach((handler) => handler(event));
}

function clearMessageHandlers() {
  messageHandlers.clear();
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe("useChat", () => {
  beforeEach(() => {
    clearMessageHandlers();
    vi.clearAllMocks();
  });

  it("throws when used outside ChatProvider", () => {
    expect(() => renderHook(() => useChat())).toThrow("useChat must be used within a ChatProvider");
  });

  it("provides context value when used inside ChatProvider", () => {
    const { result } = renderHook(() => useChat(), {
      wrapper: createWrapper(),
    });

    expect(result.current.state).toBeDefined();
    expect(result.current.state.sessions).toEqual([]);
    expect(result.current.state.messages).toEqual([]);
    expect(result.current.state.loading).toBe(false);
    expect(result.current.state.activeSessionId).toBeNull();
    expect(result.current.dispatch).toBeInstanceOf(Function);
    expect(result.current.actions.sendPrompt).toBeInstanceOf(Function);
    expect(result.current.actions.interrupt).toBeInstanceOf(Function);
    expect(result.current.actions.createNewSession).toBeInstanceOf(Function);
    expect(result.current.actions.selectSession).toBeInstanceOf(Function);
    expect(result.current.actions.denyPermission).toBeInstanceOf(Function);
    expect(result.current.actions.setSelectedSkills).toBeInstanceOf(Function);
    expect(result.current.actions.dismissContinuePrompt).toBeInstanceOf(Function);
  });

  it("renders children correctly", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ChatProvider>
          <div data-testid="child">Hello</div>
        </ChatProvider>
      </QueryClientProvider>
    );

    expect(screen.getByTestId("child")).toHaveTextContent("Hello");
  });
});

describe("appReducer - INIT_EMPTY", () => {
  beforeEach(() => {
    clearMessageHandlers();
    vi.clearAllMocks();
  });

  it("initializes with empty session list", () => {
    const { result } = renderHook(() => useChat(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.dispatch({
        type: "INIT_EMPTY",
        sessions: [],
        tokenTelemetry: null,
      });
    });

    expect(result.current.state.sessions).toEqual([]);
    expect(result.current.state.activeSessionId).toBeNull();
    expect(result.current.state.messages).toEqual([]);
  });

  it("sets sessions when initializing", () => {
    const mockSessions = [
      {
        id: "s1",
        summary: "Session 1",
        createTime: "2024-01-01T00:00:00Z",
        updateTime: "2024-01-01T00:00:00Z",
        status: "idle",
      },
      {
        id: "s2",
        summary: "Session 2",
        createTime: "2024-01-02T00:00:00Z",
        updateTime: "2024-01-02T00:00:00Z",
        status: "processing",
      },
    ];

    const { result } = renderHook(() => useChat(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.dispatch({
        type: "INIT_EMPTY",
        sessions: mockSessions,
        tokenTelemetry: null,
      });
    });

    expect(result.current.state.sessions).toEqual(mockSessions);
    expect(result.current.state.sessions).toHaveLength(2);
  });
});

describe("appReducer - LOAD_SESSION", () => {
  beforeEach(() => {
    clearMessageHandlers();
    vi.clearAllMocks();
  });

  it("loads session with messages", () => {
    const mockMessages = [
      { role: "user" as const, content: "Hello" },
      { role: "assistant" as const, content: "Hi there!" },
    ];

    const { result } = renderHook(() => useChat(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.dispatch({
        type: "LOAD_SESSION",
        sessionId: "s1",
        status: "idle",
        messages: mockMessages,
        sessions: [],
      });
    });

    expect(result.current.state.activeSessionId).toBe("s1");
    expect(result.current.state.activeSessionStatus).toBe("idle");
    expect(result.current.state.messages).toEqual(mockMessages);
    expect(result.current.state.lastMessageRole).toBe("assistant");
    expect(result.current.state.loading).toBe(false);
  });

  it("sets loading true for processing status", () => {
    const { result } = renderHook(() => useChat(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.dispatch({
        type: "LOAD_SESSION",
        sessionId: "s1",
        status: "processing",
        messages: [],
        sessions: [],
      });
    });

    expect(result.current.state.loading).toBe(true);
    expect(result.current.state.activeSessionStatus).toBe("processing");
  });

  it("sets loading true for pending status", () => {
    const { result } = renderHook(() => useChat(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.dispatch({
        type: "LOAD_SESSION",
        sessionId: "s1",
        status: "pending",
        messages: [],
        sessions: [],
      });
    });

    expect(result.current.state.loading).toBe(true);
  });

  it("handles null last message", () => {
    const { result } = renderHook(() => useChat(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.dispatch({
        type: "LOAD_SESSION",
        sessionId: "s1",
        status: "idle",
        messages: [],
        sessions: [],
      });
    });

    expect(result.current.state.lastMessageRole).toBeNull();
  });
});

describe("appReducer - SET_LOADING", () => {
  beforeEach(() => {
    clearMessageHandlers();
    vi.clearAllMocks();
  });

  it("sets loading to true", () => {
    const { result } = renderHook(() => useChat(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.dispatch({ type: "SET_LOADING", loading: true });
    });

    expect(result.current.state.loading).toBe(true);
  });

  it("sets loading to false", () => {
    const { result } = renderHook(() => useChat(), {
      wrapper: createWrapper(),
    });

    // First set to true
    act(() => {
      result.current.dispatch({ type: "SET_LOADING", loading: true });
    });

    // Then set to false
    act(() => {
      result.current.dispatch({ type: "SET_LOADING", loading: false });
    });

    expect(result.current.state.loading).toBe(false);
  });
});

describe("appReducer - USER_MESSAGE", () => {
  beforeEach(() => {
    clearMessageHandlers();
    vi.clearAllMocks();
  });

  it("appends user message", () => {
    const { result } = renderHook(() => useChat(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.dispatch({
        type: "USER_MESSAGE",
        content: "Hello world",
        meta: { timestamp: 123 },
      });
    });

    expect(result.current.state.messages).toHaveLength(1);
    expect(result.current.state.messages[0]).toEqual({
      role: "user",
      content: "Hello world",
      meta: { timestamp: 123 },
    });
    expect(result.current.state.lastMessageRole).toBe("user");
  });

  it("appends multiple user messages", () => {
    const { result } = renderHook(() => useChat(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.dispatch({ type: "USER_MESSAGE", content: "First" });
    });

    act(() => {
      result.current.dispatch({ type: "USER_MESSAGE", content: "Second" });
    });

    expect(result.current.state.messages).toHaveLength(2);
    expect(result.current.state.messages[0].content).toBe("First");
    expect(result.current.state.messages[1].content).toBe("Second");
    expect(result.current.state.lastMessageRole).toBe("user");
  });
});

describe("appReducer - ASSISTANT_MESSAGE", () => {
  beforeEach(() => {
    clearMessageHandlers();
    vi.clearAllMocks();
  });

  it("appends assistant message with content and html", () => {
    const { result } = renderHook(() => useChat(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.dispatch({
        type: "ASSISTANT_MESSAGE",
        content: "I'm an AI",
        meta: { model: "gpt-4" },
      });
    });

    expect(result.current.state.messages).toHaveLength(1);
    expect(result.current.state.messages[0]).toEqual({
      role: "assistant",
      content: "I'm an AI",
      meta: { model: "gpt-4" },
    });
    expect(result.current.state.lastMessageRole).toBe("assistant");
  });

  it("handles empty content", () => {
    const { result } = renderHook(() => useChat(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.dispatch({
        type: "ASSISTANT_MESSAGE",
        content: "",
      });
    });

    expect(result.current.state.messages).toHaveLength(1);
    expect(result.current.state.messages[0].content).toBe("");
  });
});

describe("appReducer - APPEND_MESSAGE", () => {
  beforeEach(() => {
    clearMessageHandlers();
    vi.clearAllMocks();
  });

  it("appends a complete message object", () => {
    const { result } = renderHook(() => useChat(), {
      wrapper: createWrapper(),
    });

    const msg = {
      role: "assistant" as const,
      content: "Streaming...",
      meta: { asThinking: true },
    };

    act(() => {
      result.current.dispatch({ type: "APPEND_MESSAGE", message: msg });
    });

    expect(result.current.state.messages).toHaveLength(1);
    expect(result.current.state.messages[0].meta).toEqual({ asThinking: true });
    expect(result.current.state.lastMessageRole).toBe("assistant");
  });
});

describe("appReducer - Skills management", () => {
  beforeEach(() => {
    clearMessageHandlers();
    vi.clearAllMocks();
  });

  it("sets available skills with SET_SKILLS", () => {
    const { result } = renderHook(() => useChat(), {
      wrapper: createWrapper(),
    });

    const mockSkills = [
      { name: "skill1", description: "Skill 1" },
      { name: "skill2", description: "Skill 2" },
    ];

    act(() => {
      result.current.dispatch({ type: "SET_SKILLS", skills: mockSkills });
    });

    expect(result.current.state.skills).toEqual(mockSkills);
    expect(result.current.state.skills).toHaveLength(2);
  });

  it("sets selected skills with SET_SELECTED_SKILLS", () => {
    const { result } = renderHook(() => useChat(), {
      wrapper: createWrapper(),
    });

    const allSkills = [
      { name: "skill1", description: "Skill 1" },
      { name: "skill2", description: "Skill 2" },
    ];
    const selectedSkills = [allSkills[0]];

    act(() => {
      result.current.dispatch({ type: "SET_SKILLS", skills: allSkills });
    });

    act(() => {
      result.current.dispatch({ type: "SET_SELECTED_SKILLS", skills: selectedSkills });
    });

    expect(result.current.state.skills).toEqual(allSkills);
    expect(result.current.state.selectedSkills).toEqual(selectedSkills);
  });
});

describe("appReducer - Permission state", () => {
  beforeEach(() => {
    clearMessageHandlers();
    vi.clearAllMocks();
  });

  it("sets permission prompt state", () => {
    const { result } = renderHook(() => useChat(), {
      wrapper: createWrapper(),
    });

    const promptState = {
      requests: [],
      prompts: [],
      index: 0,
      decisions: {},
      alwaysAllows: [],
      submitting: false,
    };

    act(() => {
      result.current.dispatch({ type: "SET_PERMISSION_PROMPT_STATE", state: promptState });
    });

    expect(result.current.state.permissionPromptState).toEqual(promptState);
  });

  it("sets pending permission reply", () => {
    const { result } = renderHook(() => useChat(), {
      wrapper: createWrapper(),
    });

    const reply = {
      permissions: [
        { toolCallId: "t1", permission: "allow" as const },
        { toolCallId: "t2", permission: "deny" as const },
      ],
      alwaysAllows: ["read-in-cwd"],
    };

    act(() => {
      result.current.dispatch({ type: "SET_PENDING_PERMISSION_REPLY", reply });
    });

    expect(result.current.state.pendingPermissionReply).toEqual(reply);
  });

  it("clears pending permission reply with null", () => {
    const { result } = renderHook(() => useChat(), {
      wrapper: createWrapper(),
    });

    // First set
    act(() => {
      result.current.dispatch({
        type: "SET_PENDING_PERMISSION_REPLY",
        reply: { permissions: [], alwaysAllows: [] },
      });
    });

    // Then clear
    act(() => {
      result.current.dispatch({
        type: "SET_PENDING_PERMISSION_REPLY",
        reply: null,
      });
    });

    expect(result.current.state.pendingPermissionReply).toBeNull();
  });
});

describe("appReducer - CLEAR_MESSAGES", () => {
  beforeEach(() => {
    clearMessageHandlers();
    vi.clearAllMocks();
  });

  it("clears all messages", () => {
    const { result } = renderHook(() => useChat(), {
      wrapper: createWrapper(),
    });

    // Add some messages
    act(() => {
      result.current.dispatch({ type: "USER_MESSAGE", content: "Hello" });
      result.current.dispatch({ type: "ASSISTANT_MESSAGE", content: "Hi" });
    });

    expect(result.current.state.messages).toHaveLength(2);

    // Clear
    act(() => {
      result.current.dispatch({ type: "CLEAR_MESSAGES" });
    });

    expect(result.current.state.messages).toEqual([]);
    expect(result.current.state.lastMessageRole).toBeNull();
  });
});

describe("appReducer - SET_ACTIVE_EDITOR", () => {
  beforeEach(() => {
    clearMessageHandlers();
    vi.clearAllMocks();
  });

  it("sets active editor information", () => {
    const { result } = renderHook(() => useChat(), {
      wrapper: createWrapper(),
    });

    const editor = {
      fileName: "test.ts",
      languageId: "typescript",
      lineCount: 100,
    };

    act(() => {
      result.current.dispatch({ type: "SET_ACTIVE_EDITOR", editor });
    });

    expect(result.current.state.activeEditor).toEqual(editor);
  });

  it("clears active editor with null", () => {
    const { result } = renderHook(() => useChat(), {
      wrapper: createWrapper(),
    });

    // Set first
    act(() => {
      result.current.dispatch({
        type: "SET_ACTIVE_EDITOR",
        editor: { fileName: "test.ts", languageId: "typescript", lineCount: 100 },
      });
    });

    // Then clear
    act(() => {
      result.current.dispatch({ type: "SET_ACTIVE_EDITOR", editor: null });
    });

    expect(result.current.state.activeEditor).toBeNull();
  });
});

describe("appReducer - LLM_STREAM_PROGRESS", () => {
  beforeEach(() => {
    clearMessageHandlers();
    vi.clearAllMocks();
  });

  it("handles start phase", () => {
    const { result } = renderHook(() => useChat(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.dispatch({
        type: "LLM_STREAM_PROGRESS",
        progress: { requestId: "r1", phase: "start" },
      });
    });

    expect(result.current.state.llmStreamProgress?.phase).toBe("start");
    expect(result.current.state.llmStreamProgress?.requestId).toBe("r1");
  });

  it("handles streaming phase with formatted tokens", () => {
    const { result } = renderHook(() => useChat(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.dispatch({
        type: "LLM_STREAM_PROGRESS",
        progress: {
          requestId: "r1",
          phase: "streaming",
          formattedTokens: "Thinking...",
        },
      });
    });

    expect(result.current.state.llmStreamProgress?.phase).toBe("streaming");
    expect(result.current.state.llmStreamProgress?.formattedTokens).toBe("Thinking...");
  });

  it("clears progress on end phase", () => {
    const { result } = renderHook(() => useChat(), {
      wrapper: createWrapper(),
    });

    // Start streaming
    act(() => {
      result.current.dispatch({
        type: "LLM_STREAM_PROGRESS",
        progress: { requestId: "r1", phase: "start" },
      });
    });

    expect(result.current.state.llmStreamProgress).not.toBeNull();

    // End streaming
    act(() => {
      result.current.dispatch({
        type: "LLM_STREAM_PROGRESS",
        progress: { requestId: "r1", phase: "end" },
      });
    });

    expect(result.current.state.llmStreamProgress).toBeNull();
  });
});

describe("appReducer - SESSION_STATUS", () => {
  beforeEach(() => {
    clearMessageHandlers();
    vi.clearAllMocks();
  });

  it("updates session status", () => {
    const { result } = renderHook(() => useChat(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.dispatch({
        type: "SESSION_STATUS",
        status: "processing",
      });
    });

    expect(result.current.state.activeSessionStatus).toBe("processing");
    expect(result.current.state.loading).toBe(true);
  });

  it("updates ask permissions", () => {
    const { result } = renderHook(() => useChat(), {
      wrapper: createWrapper(),
    });

    const permissions = [
      {
        toolCallId: "t1",
        name: "Read File",
        command: "readFile",
        description: "Read a file",
        scopes: ["read-in-cwd"],
      },
    ];

    act(() => {
      result.current.dispatch({
        type: "SESSION_STATUS",
        status: "ask_permission",
        askPermissions: permissions,
      });
    });

    expect(result.current.state.activeSessionStatus).toBe("ask_permission");
    expect(result.current.state.askPermissions).toEqual(permissions);
  });

  it("updates processes", () => {
    const { result } = renderHook(() => useChat(), {
      wrapper: createWrapper(),
    });

    const processes = {
      "123": { startTime: "2024-01-01T00:00:00Z", command: "npm test" },
    };

    act(() => {
      result.current.dispatch({
        type: "SESSION_STATUS",
        status: "processing",
        processes,
      });
    });

    expect(result.current.state.processes).toEqual(processes);
  });
});

describe("appReducer - Continue prompt", () => {
  beforeEach(() => {
    clearMessageHandlers();
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("showContinuePrompt defaults to false", () => {
    const { result } = renderHook(() => useChat(), {
      wrapper: createWrapper(),
    });

    expect(result.current.state.showContinuePrompt).toBe(false);
  });

  it("DISMISS_CONTINUE_PROMPT sets showContinuePrompt to false", () => {
    const { result } = renderHook(() => useChat(), {
      wrapper: createWrapper(),
    });

    // First show
    act(() => {
      result.current.dispatch({
        type: "SESSION_STATUS",
        status: "interrupted",
        sessionId: "s1",
      });
    });

    expect(result.current.state.showContinuePrompt).toBe(true);

    // Then dismiss
    act(() => {
      result.current.dispatch({ type: "DISMISS_CONTINUE_PROMPT" });
    });

    expect(result.current.state.showContinuePrompt).toBe(false);
  });

  it("SESSION_STATUS interrupted sets showContinuePrompt true without localStorage key", () => {
    const { result } = renderHook(() => useChat(), {
      wrapper: createWrapper(),
    });

    // Ensure no localStorage entry
    localStorage.removeItem("deepcode:continuePromptDismissed:s1");

    act(() => {
      result.current.dispatch({
        type: "SESSION_STATUS",
        status: "interrupted",
        sessionId: "s1",
      });
    });

    expect(result.current.state.activeSessionStatus).toBe("interrupted");
    expect(result.current.state.showContinuePrompt).toBe(true);
    expect(result.current.state.loading).toBe(false);
  });

  it("SESSION_STATUS interrupted does not show prompt when dismissed in localStorage", () => {
    const { result } = renderHook(() => useChat(), {
      wrapper: createWrapper(),
    });

    // Simulate that user previously dismissed
    localStorage.setItem("deepcode:continuePromptDismissed:s1", "1");

    act(() => {
      result.current.dispatch({
        type: "SESSION_STATUS",
        status: "interrupted",
        sessionId: "s1",
      });
    });

    expect(result.current.state.activeSessionStatus).toBe("interrupted");
    expect(result.current.state.showContinuePrompt).toBe(false);
  });

  it("SESSION_STATUS with non-interrupted status sets showContinuePrompt false", () => {
    const { result } = renderHook(() => useChat(), {
      wrapper: createWrapper(),
    });

    // First set interrupted
    act(() => {
      result.current.dispatch({
        type: "SESSION_STATUS",
        status: "interrupted",
        sessionId: "s1",
      });
    });

    expect(result.current.state.showContinuePrompt).toBe(true);

    // Then change to processing
    act(() => {
      result.current.dispatch({
        type: "SESSION_STATUS",
        status: "processing",
        sessionId: "s1",
      });
    });

    expect(result.current.state.showContinuePrompt).toBe(false);
  });

  it("LOAD_SESSION with interrupted status shows prompt without localStorage", () => {
    const { result } = renderHook(() => useChat(), {
      wrapper: createWrapper(),
    });

    localStorage.removeItem("deepcode:continuePromptDismissed:s1");

    act(() => {
      result.current.dispatch({
        type: "LOAD_SESSION",
        sessionId: "s1",
        status: "interrupted",
        messages: [],
        sessions: [],
      });
    });

    expect(result.current.state.activeSessionStatus).toBe("interrupted");
    expect(result.current.state.showContinuePrompt).toBe(true);
  });

  it("LOAD_SESSION with interrupted status does not show prompt when dismissed", () => {
    const { result } = renderHook(() => useChat(), {
      wrapper: createWrapper(),
    });

    localStorage.setItem("deepcode:continuePromptDismissed:s1", "1");

    act(() => {
      result.current.dispatch({
        type: "LOAD_SESSION",
        sessionId: "s1",
        status: "interrupted",
        messages: [],
        sessions: [],
      });
    });

    expect(result.current.state.activeSessionStatus).toBe("interrupted");
    expect(result.current.state.showContinuePrompt).toBe(false);
  });

  it("LOAD_SESSION with non-interrupted status does not show prompt", () => {
    const { result } = renderHook(() => useChat(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.dispatch({
        type: "LOAD_SESSION",
        sessionId: "s1",
        status: "completed",
        messages: [{ role: "user" as const, content: "Hello" }],
        sessions: [],
      });
    });

    expect(result.current.state.showContinuePrompt).toBe(false);
  });

  it("dismissContinuePrompt action persists to localStorage and dispatches", () => {
    const { result } = renderHook(() => useChat(), {
      wrapper: createWrapper(),
    });

    // Simulate loaded session with interrupted status
    act(() => {
      result.current.dispatch({
        type: "LOAD_SESSION",
        sessionId: "s1",
        status: "interrupted",
        messages: [],
        sessions: [],
      });
    });

    expect(result.current.state.showContinuePrompt).toBe(true);

    // Call dismissContinuePrompt
    act(() => {
      result.current.actions.dismissContinuePrompt();
    });

    expect(result.current.state.showContinuePrompt).toBe(false);
    expect(localStorage.getItem("deepcode:continuePromptDismissed:s1")).toBe("1");
  });

  it("different sessions have independent dismiss state", () => {
    const { result } = renderHook(() => useChat(), {
      wrapper: createWrapper(),
    });

    // Dismiss session 1
    localStorage.setItem("deepcode:continuePromptDismissed:s1", "1");

    // Session 1 should not show prompt
    act(() => {
      result.current.dispatch({
        type: "SESSION_STATUS",
        status: "interrupted",
        sessionId: "s1",
      });
    });

    expect(result.current.state.showContinuePrompt).toBe(false);

    // Session 2 should show prompt (not dismissed)
    act(() => {
      result.current.dispatch({
        type: "SESSION_STATUS",
        status: "interrupted",
        sessionId: "s2",
      });
    });

    expect(result.current.state.showContinuePrompt).toBe(true);
  });
});

describe("Message event handling", () => {
  beforeEach(() => {
    clearMessageHandlers();
    vi.clearAllMocks();
  });

  it("handles sessionStatus message", () => {
    const { result } = renderHook(() => useChat(), {
      wrapper: createWrapper(),
    });

    act(() => {
      postMessage({
        type: "sessionStatus",
        status: "processing",
        askPermissions: [],
        processes: null,
      });
    });

    expect(result.current.state.activeSessionStatus).toBe("processing");
  });

  it("handles activeEditor message", () => {
    const { result } = renderHook(() => useChat(), {
      wrapper: createWrapper(),
    });

    act(() => {
      postMessage({
        type: "activeEditor",
        fileName: "main.tsx",
        languageId: "typescript",
        lineCount: 50,
      });
    });

    expect(result.current.state.activeEditor?.fileName).toBe("main.tsx");
  });

  it("handles userMessage event", () => {
    const { result } = renderHook(() => useChat(), {
      wrapper: createWrapper(),
    });

    act(() => {
      postMessage({
        type: "userMessage",
        content: "Test message",
        meta: { timestamp: 123 },
      });
    });

    expect(result.current.state.messages).toHaveLength(1);
    expect(result.current.state.messages[0].content).toBe("Test message");
  });

  it("handles assistant event", () => {
    const { result } = renderHook(() => useChat(), {
      wrapper: createWrapper(),
    });

    act(() => {
      postMessage({
        type: "assistant",
        content: "AI response",
      });
    });

    expect(result.current.state.messages).toHaveLength(1);
    expect(result.current.state.messages[0].role).toBe("assistant");
  });

  it("handles loading event", () => {
    const { result } = renderHook(() => useChat(), {
      wrapper: createWrapper(),
    });

    act(() => {
      postMessage({ type: "loading", value: true });
    });

    expect(result.current.state.loading).toBe(true);

    act(() => {
      postMessage({ type: "loading", value: false });
    });

    expect(result.current.state.loading).toBe(false);
  });

  it("filters out interrupt messages from appendMessage", () => {
    const { result } = renderHook(() => useChat(), {
      wrapper: createWrapper(),
    });

    // Simulate an "Interrupted." message from core
    act(() => {
      postMessage({
        type: "appendMessage",
        message: { role: "user", content: "Interrupted." },
        shouldConnect: false,
      });
    });

    // Should NOT be appended to messages
    expect(result.current.state.messages).toHaveLength(0);

    // Normal message should still work
    act(() => {
      postMessage({
        type: "appendMessage",
        message: { role: "assistant", content: "Hello there" },
        shouldConnect: false,
      });
    });

    expect(result.current.state.messages).toHaveLength(1);
    expect(result.current.state.messages[0].content).toBe("Hello there");
  });

  it("filters out interrupt message with process info", () => {
    const { result } = renderHook(() => useChat(), {
      wrapper: createWrapper(),
    });

    // "Interrupted. Killed processes: ..." also filtered
    act(() => {
      postMessage({
        type: "appendMessage",
        message: { role: "user", content: "Interrupted. Killed processes: 12345." },
        shouldConnect: false,
      });
    });

    expect(result.current.state.messages).toHaveLength(0);
  });

  it("does NOT filter messages that merely contain 'Interrupted' in the middle", () => {
    const { result } = renderHook(() => useChat(), {
      wrapper: createWrapper(),
    });

    act(() => {
      postMessage({
        type: "appendMessage",
        message: { role: "user", content: "The process was Interrupted." },
        shouldConnect: false,
      });
    });

    // Messages with "Interrupted" not at the start should still be appended
    expect(result.current.state.messages).toHaveLength(1);
  });
});
