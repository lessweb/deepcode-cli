import React, { useCallback, useEffect, useReducer, createContext, useContext } from "react";
import { wrpc } from "@/webview/wrpc";
import { chatService } from "@/webview/services/chatService";
import type {
  AppState,
  AppAction,
  SessionMessage,
  AskPermissionRequest,
  LlmStreamProgressData,
  TokenTelemetry,
  SkillInfo,
  ActiveEditor,
  EditingMessage,
} from "@/webview/types";

// ============================================================================
// Types
// ============================================================================

interface ChatContextValue {
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
  actions: {
    sendPrompt: (
      prompt: string,
      skills?: SkillInfo[],
      images?: string[],
      options?: { permissions?: unknown[]; alwaysAllows?: string[] }
    ) => Promise<void>;
    interrupt: () => Promise<void>;
    createNewSession: () => Promise<void>;
    selectSession: (sessionId: string) => Promise<void>;
    denyPermission: (sessionId: string) => Promise<void>;
    setSelectedSkills: (skills: SkillInfo[]) => void;
    editMessage: (editingMessage: EditingMessage | null) => void;
    renameSession: (sessionId: string, summary: string) => Promise<void>;
    deleteSession: (sessionId: string) => Promise<void>;
  };
}

const ChatContext = createContext<ChatContextValue | null>(null);

// ============================================================================
// Reducer
// ============================================================================

const initialState: AppState = {
  sessions: [],
  activeSessionId: null,
  activeSessionStatus: null,
  messages: [],
  loading: false,
  skills: [],
  selectedSkills: [],
  askPermissions: [],
  processes: null,
  tokenTelemetry: undefined,
  llmStreamProgress: null,
  lastMessageRole: null,
  permissionPromptState: null,
  pendingPermissionReply: null,
  activeEditor: null,
  editingMessage: null,
  askUserQuestions: null,
};

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "INIT_EMPTY":
      return {
        ...initialState,
        sessions: action.sessions,
        tokenTelemetry: action.tokenTelemetry ?? undefined,
      };
    case "LOAD_SESSION":
      return {
        ...state,
        activeSessionId: action.sessionId,
        activeSessionStatus: action.status,
        messages: action.messages,
        sessions: action.sessions,
        askPermissions: action.askPermissions ?? [],
        processes: action.processes ?? null,
        tokenTelemetry: action.tokenTelemetry ?? state.tokenTelemetry,
        lastMessageRole: action.messages.length > 0 ? action.messages[action.messages.length - 1].role : null,
        permissionPromptState: null,
        pendingPermissionReply: null,
        loading: action.status === "processing" || action.status === "pending",
      };
    case "SET_SESSIONS":
      return { ...state, sessions: action.sessions };
    case "SESSION_STATUS":
      return {
        ...state,
        activeSessionStatus: action.status,
        askPermissions: action.askPermissions ?? state.askPermissions,
        processes: action.processes ?? state.processes,
        tokenTelemetry: action.tokenTelemetry ?? state.tokenTelemetry,
        loading: action.status === "processing" || action.status === "pending",
      };
    case "LLM_STREAM_PROGRESS":
      if (action.progress.phase === "end") {
        return { ...state, llmStreamProgress: null };
      }
      return { ...state, llmStreamProgress: action.progress };
    case "USER_MESSAGE": {
      const newMsg: SessionMessage = { role: "user", content: action.content, meta: action.meta };
      return {
        ...state,
        messages: [...state.messages, newMsg],
        lastMessageRole: "user",
      };
    }
    case "ASSISTANT_MESSAGE": {
      const newMsg: SessionMessage = {
        role: "assistant",
        content: action.content || "",
        meta: action.meta,
      };
      return {
        ...state,
        messages: [...state.messages, newMsg],
        lastMessageRole: "assistant",
      };
    }
    case "APPEND_MESSAGE": {
      const msg = action.message;
      return {
        ...state,
        messages: [...state.messages, msg],
        lastMessageRole: msg.role,
      };
    }
    case "SET_LOADING":
      return {
        ...state,
        loading: action.loading,
        llmStreamProgress: action.loading ? state.llmStreamProgress : null,
      };
    case "SET_SKILLS":
      return { ...state, skills: action.skills };
    case "SET_SELECTED_SKILLS":
      return { ...state, selectedSkills: action.skills };
    case "SET_PERMISSION_PROMPT_STATE":
      return { ...state, permissionPromptState: action.state };
    case "SET_PENDING_PERMISSION_REPLY":
      return { ...state, pendingPermissionReply: action.reply };
    case "CLEAR_MESSAGES":
      return { ...state, messages: [], lastMessageRole: null };
    case "SET_ACTIVE_EDITOR":
      return { ...state, activeEditor: action.editor };
    case "SET_EDITING_MESSAGE":
      return { ...state, editingMessage: action.editingMessage };
    case "SET_ASK_USER_QUESTIONS":
      return { ...state, askUserQuestions: action.data };
    default:
      return state;
  }
}

// ============================================================================
// Provider
// ============================================================================

interface ChatProviderProps {
  children: React.ReactNode;
}

export function ChatProvider({ children }: ChatProviderProps) {
  const [state, dispatch] = useReducer(appReducer, initialState);

  // Load initial data via RPC
  const { data: initialData } = wrpc.useQuery("getInitialData");

  useEffect(() => {
    if (initialData) {
      const { sessions, activeSession, activeEditor } = initialData;
      if (activeSession) {
        dispatch({
          type: "LOAD_SESSION",
          sessionId: activeSession.id,
          status: activeSession.status,
          messages: activeSession.messages as SessionMessage[],
          sessions,
          askPermissions: activeSession.askPermissions as AskPermissionRequest[] | undefined,
          processes: activeSession.processes,
          tokenTelemetry: null,
        });
      } else {
        dispatch({ type: "INIT_EMPTY", sessions, tokenTelemetry: null });
      }
      if (activeEditor) {
        dispatch({
          type: "SET_ACTIVE_EDITOR",
          editor: activeEditor as ActiveEditor,
        });
      }
    }
  }, [initialData]);

  // Load skills via RPC
  const { data: skillsData } = wrpc.useQuery("getSkills");
  useEffect(() => {
    if (skillsData?.skills) {
      dispatch({ type: "SET_SKILLS", skills: skillsData.skills as SkillInfo[] });
    }
  }, [skillsData]);

  // Listen for streaming push messages from extension host
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const message = event.data as Record<string, unknown> | undefined;
      if (!message?.type) return;

      console.log("[ChatProvider] postMessage received:", message.type, message);

      switch (message.type) {
        case "sessionStatus":
          dispatch({
            type: "SESSION_STATUS",
            status: message.status as string | null,
            askPermissions: message.askPermissions as AskPermissionRequest[] | undefined,
            processes: message.processes as Record<string, { startTime: string; command: string }> | null | undefined,
            tokenTelemetry: message.tokenTelemetry as TokenTelemetry | undefined,
          });
          break;
        case "activeEditor":
          dispatch({
            type: "SET_ACTIVE_EDITOR",
            editor: message as { type: string; fileName: string; languageId: string; lineCount: number },
          });
          break;
        case "llmStreamProgress":
          dispatch({ type: "LLM_STREAM_PROGRESS", progress: message.progress as LlmStreamProgressData });
          break;
        case "userMessage":
          dispatch({
            type: "USER_MESSAGE",
            content: message.content as string,
            meta: message.meta as Record<string, unknown> | undefined,
          });
          break;
        case "assistant":
          dispatch({
            type: "ASSISTANT_MESSAGE",
            content: message.content as string,
            meta: message.meta as Record<string, unknown> | undefined,
          });
          break;
        case "appendMessage":
          dispatch({
            type: "APPEND_MESSAGE",
            message: message.message as SessionMessage,
          });
          if (
            (message.message as SessionMessage).role === "assistant" &&
            !((message.message as SessionMessage).meta as { asThinking?: boolean } | undefined)?.asThinking
          ) {
            dispatch({ type: "SET_LOADING", loading: false });
          }
          break;
        case "loading":
          dispatch({ type: "SET_LOADING", loading: Boolean(message.value) });
          break;
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  // Actions
  const sendPrompt = useCallback(
    async (
      prompt: string,
      skills?: SkillInfo[],
      images?: string[],
      options?: { permissions?: unknown[]; alwaysAllows?: string[] }
    ) => {
      dispatch({ type: "SET_LOADING", loading: true });
      try {
        await chatService.sendPrompt({
          prompt,
          skills,
          images,
          permissions: options?.permissions as Array<{ toolCallId: string; permission: "allow" | "deny" }> | undefined,
          alwaysAllows: options?.alwaysAllows,
        });
      } catch (err) {
        console.error("[ChatProvider] sendPrompt failed:", err);
        dispatch({ type: "SET_LOADING", loading: false });
      }
      const freshSkills = await chatService.getSkills();
      if (freshSkills.length > 0) {
        dispatch({ type: "SET_SKILLS", skills: freshSkills });
      }
    },
    []
  );

  const interrupt = useCallback(async () => {
    await chatService.interrupt();
    dispatch({ type: "SET_LOADING", loading: false });
  }, []);

  const createNewSession = useCallback(async () => {
    const result = await chatService.createNewSession();
    dispatch({ type: "INIT_EMPTY", sessions: result.sessions, tokenTelemetry: null });
    if (result.skills) {
      dispatch({ type: "SET_SKILLS", skills: result.skills });
    }
  }, []);

  const selectSession = useCallback(async (sessionId: string) => {
    const result = await chatService.selectSession(sessionId);
    if (result.ok && result.session) {
      dispatch({
        type: "LOAD_SESSION",
        sessionId: result.session.id,
        status: result.session.status,
        messages: result.messages ?? [],
        sessions: result.sessions ?? [],
        askPermissions: result.session.askPermissions,
        processes: result.session.processes,
        tokenTelemetry: null,
      });
      const skillsResult = await chatService.getSkills(sessionId);
      if (skillsResult.length > 0) {
        dispatch({ type: "SET_SKILLS", skills: skillsResult });
      }
    }
  }, []);

  const denyPermission = useCallback(async (sessionId: string) => {
    await chatService.denyPermission(sessionId);
  }, []);

  const setSelectedSkills = useCallback((skills: SkillInfo[]) => {
    dispatch({ type: "SET_SELECTED_SKILLS", skills });
  }, []);

  const editMessage = useCallback((editingMessage: EditingMessage | null) => {
    dispatch({ type: "SET_EDITING_MESSAGE", editingMessage });
  }, []);

  const renameSession = useCallback(
    async (sessionId: string, summary: string) => {
      await chatService.renameSession(sessionId, summary);
      // Only update the session title locally, don't reload messages
      dispatch({
        type: "SET_SESSIONS",
        sessions: state.sessions.map((s) => (s.id === sessionId ? { ...s, summary } : s)),
      });
    },
    [state.sessions]
  );

  const deleteSession = useCallback(
    async (sessionId: string) => {
      const result = await chatService.deleteSession(sessionId);
      if (result.ok) {
        const sessions = state.sessions.filter((s) => s.id !== sessionId);
        if (result.wasActiveSession) {
          await createNewSession();
        } else {
          dispatch({ type: "SET_SESSIONS", sessions });
        }
      }
    },
    [state.sessions, createNewSession]
  );

  const contextValue: ChatContextValue = {
    state,
    dispatch,
    actions: {
      sendPrompt,
      interrupt,
      createNewSession,
      selectSession,
      denyPermission,
      setSelectedSkills,
      editMessage,
      renameSession,
      deleteSession,
    },
  };

  return <ChatContext.Provider value={contextValue}>{children}</ChatContext.Provider>;
}

// ============================================================================
// Hook
// ============================================================================

export function useChat(): ChatContextValue {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error("useChat must be used within a ChatProvider");
  }
  return context;
}

// ============================================================================
// Export types for convenience
// ============================================================================

export type { ChatProviderProps };
