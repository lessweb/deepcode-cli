import { getCompletedProposedPlan } from "@vegamo/deepcode-core/common/plan-implementation";
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Box, Static, Text, useApp, useStdout, useWindowSize } from "ink";
import chalk from "chalk";
import { createOpenAIClientFactory } from "@vegamo/deepcode-core";
import type { PermissionSettingsEdit, PermissionSettingsChanges } from "@vegamo/deepcode-core";
import { type ModelConfigSelection, type SettingsTarget } from "@vegamo/deepcode-core";
import { type PromptDraft, PromptInput, type PromptSubmission } from "./PromptInput";
import { MessageView, RawModeExitPrompt } from "../components";
import { SessionList } from "./SessionList";
import { type UndoRestoreMode, UndoSelector } from "./UndoSelector";
import { StatusLine } from "../components/status-line";
import { buildLoadingText } from "../core/loading-text";
import { writeClipboardTextAsync } from "../core/clipboard";
import { findExpandedThinkingId } from "../core/thinking-state";
import { WelcomeScreen } from "./WelcomeScreen";
import { AskUserQuestionPrompt } from "./AskUserQuestionPrompt";
import { McpStatusList } from "./McpStatusList";
import { buildProcessOutputItems } from "../core/process-output";
import { ProcessStdoutView } from "./ProcessStdoutView";
import {
  type AskUserQuestionAnswers,
  findPendingAskUserQuestion,
  formatAskUserQuestionAnswers,
} from "../core/ask-user-question";
import { PermissionPrompt, type PermissionPromptResult } from "./PermissionPrompt";
import {
  PlanImplementationPrompt,
  getClearContextImplementationPrompt,
  getImplementationPrompt,
  type PlanImplementationChoice,
} from "./PlanImplementationPrompt";
import { buildExitSummaryText, buildPluginRateLimitHintText, buildResumeHintText } from "../exit-summary";
import { RawMode, useRawModeContext } from "../contexts";
import { renderMessageToStdout } from "../components/MessageView/utils";
import {
  buildPromptDraftFromSessionMessage,
  buildPromptHistory,
  buildStatusLine,
  buildSyntheticUserMessage,
  formatModelConfig,
  isCurrentSessionEmpty,
  renderRawModeMessages,
} from "../utils";
import {
  resolveCurrentSettings,
  writeModelConfigSelection,
  writePermissionSettingsChanges,
} from "@vegamo/deepcode-core";
import { useStatusLine } from "../hooks";
import type { SessionInfo } from "../statusline";
import { isCollapsedThinking } from "../core/thinking-state";
import { ANSI_CLEAR_SCREEN } from "../constants";
import type {
  LlmStreamProgress,
  LlmRetryEvent,
  MessageMeta,
  SessionEntry,
  SessionMessage,
  SessionStatus,
  SkillInfo,
  UndoTarget,
  UserPromptContent,
} from "@vegamo/deepcode-core";
import { SessionManager } from "@vegamo/deepcode-core";
import { writeStdout, writeStdoutLine } from "../../utils/stdio-helpers";
import { createTerminalTitle, terminalTitleState } from "../../utils/terminal-title";
import { writeRawMode } from "../../common/cli-config";

type View = "chat" | "session-list" | "undo" | "mcp-status";

type AppProps = {
  projectRoot: string;
  settingsFile?: string;
  initialPrompt?: string;
  resumeSessionId?: string | true;
  forkSessionId?: string;
  onRestart?: () => void;
};

function App({
  projectRoot,
  settingsFile,
  initialPrompt,
  resumeSessionId,
  forkSessionId,
  onRestart,
}: AppProps): React.ReactElement {
  const { exit } = useApp();
  const { stdout, write } = useStdout();
  const terminalTitle = useMemo(() => createTerminalTitle(stdout), [stdout]);
  const { columns, rows } = useWindowSize();
  const { mode, setMode } = useRawModeContext();
  const initialPromptSubmittedRef = useRef(false);
  const resumeSessionIdRef = useRef(false);
  const startupDoneRef = useRef(false);
  const processStdoutRef = useRef<Map<number, string>>(new Map());
  const rawModeRef = useRef<RawMode>(mode);
  const writeRef = useRef(write);
  const lastRenderedColumnsRef = useRef<number | null>(null);
  const messagesRef = useRef<SessionMessage[]>([]);
  const compactionControllerRef = useRef<AbortController | null>(null);
  const [view, setView] = useState<View>("chat");
  const [busy, setBusy] = useState(false);
  const [compacting, setCompacting] = useState(false);
  const [commandNotice, setCommandNotice] = useState<string | null>(null);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [messages, setMessages] = useState<SessionMessage[]>([]);
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [undoTargets, setUndoTargets] = useState<UndoTarget[]>([]);
  const [promptDraft, setPromptDraft] = useState<PromptDraft | null>(null);
  const [statusLine, setStatusLine] = useState<string>("");
  const [errorLine, setErrorLine] = useState<string | null>(null);
  const [streamProgress, setStreamProgress] = useState<LlmStreamProgress | null>(null);
  const [retryEvent, setRetryEvent] = useState<LlmRetryEvent | null>(null);
  const [runningProcesses, setRunningProcesses] = useState<SessionEntry["processes"]>(null);
  const [activeStatus, setActiveStatus] = useState<SessionStatus | null>(null);
  const [activeAskPermissions, setActiveAskPermissions] = useState<SessionEntry["askPermissions"]>(undefined);
  const [pendingPermissionReply, setPendingPermissionReply] = useState<{
    sessionId: string;
    result: PermissionPromptResult;
  } | null>(null);
  const [dismissedQuestionIds, setDismissedQuestionIds] = useState<Set<string>>(() => new Set());
  const [isExiting, setIsExiting] = useState(false);
  const [showWelcome, setShowWelcome] = useState(true);
  const [welcomeNonce, setWelcomeNonce] = useState(0);
  const [resolvedSettings, setResolvedSettings] = useState(() => resolveCurrentSettings(projectRoot, settingsFile));
  const [nowTick, setNowTick] = useState(0);
  const [mcpStatuses, setMcpStatuses] = useState<ReturnType<typeof sessionManager.getMcpStatus>>([]);
  const [showProcessStdout, setShowProcessStdout] = useState(false);
  const [planMode, setPlanMode] = useState(false);
  const [pendingPlanImplementation, setPendingPlanImplementation] = useState<string | null>(null);

  rawModeRef.current = mode;
  messagesRef.current = messages;

  const clientFactory = useMemo(
    () => createOpenAIClientFactory(projectRoot, settingsFile),
    [projectRoot, settingsFile]
  );

  const sessionManager = useMemo(() => {
    return new SessionManager({
      projectRoot,
      createOpenAIClient: clientFactory,
      getResolvedSettings: () => resolveCurrentSettings(projectRoot, settingsFile),
      renderMarkdown: (text) => text,
      onAssistantMessage: (message: SessionMessage) => {
        setMessages((prev) => [...prev, message]);
        if (rawModeRef.current === RawMode.Raw) {
          writeStdoutLine("\n");
          writeStdoutLine(renderMessageToStdout(message, rawModeRef.current) + "\n\n");
        }
      },
      onSessionEntryUpdated: (entry) => {
        setSessions((previous) =>
          [...previous.filter((session) => session.id !== entry.id), entry].sort((a, b) =>
            b.updateTime.localeCompare(a.updateTime)
          )
        );
        if (sessionManager.getActiveSessionId() !== entry.id) return;
        setStatusLine(buildStatusLine(entry, resolveCurrentSettings(projectRoot, settingsFile)));
        setRunningProcesses(entry.processes);
        setActiveStatus(entry.status);
        setActiveAskPermissions(entry.askPermissions);
      },
      onLlmStreamProgress: (progress) => {
        setRetryEvent(null);
        if (progress.phase === "end") {
          setStreamProgress(null);
          return;
        }
        setStreamProgress(progress);
      },
      onLlmRetry: (event) => {
        setRetryEvent(event);
      },
      onMcpStatusChanged: () => {
        // 当 MCP 状态变更时，如果当前正在查看 MCP 状态页面，则更新显示
        setMcpStatuses(sessionManager.getMcpStatus());
      },
      onProcessStdout: (pid, chunk) => {
        const buf = processStdoutRef.current;
        const current = buf.get(pid) ?? "";
        // Cap at 1 MB per process to avoid unbounded memory growth
        // on noisy or long-running commands like `yes` or verbose builds.
        const MAX_STDOUT_BUFFER = 1_000_000;
        if (current.length >= MAX_STDOUT_BUFFER) {
          return;
        }
        const text = typeof chunk === "string" ? chunk : String(chunk);
        const available = MAX_STDOUT_BUFFER - current.length;
        buf.set(pid, current + text.slice(0, available));
      },
    });
  }, [projectRoot, settingsFile, clientFactory]);

  const activeSessionId = sessionManager.getActiveSessionId();
  useEffect(() => {
    processStdoutRef.current.clear();
  }, [activeSessionId]);
  const processOutputItems = useMemo(
    () =>
      buildProcessOutputItems(
        showProcessStdout && activeSessionId ? sessionManager.listSessionMessages(activeSessionId) : messages,
        runningProcesses
      ),
    [showProcessStdout, activeSessionId, sessionManager, messages, runningProcesses]
  );
  useEffect(() => {
    const entry = activeSessionId ? sessionManager.getSession(activeSessionId) : null;
    terminalTitle.set(entry?.summary || "Deep Code", terminalTitleState(entry?.status));
  }, [activeSessionId, sessionManager, sessions, terminalTitle]);

  useEffect(() => () => terminalTitle.clear(), [terminalTitle]);

  /**
   * Navigate to a sub-view.
   */
  const navigateToSubView = useCallback((targetView: View) => {
    setShowWelcome(false);
    setView(targetView);
  }, []);

  /**
   * Reset the static view to the welcome screen.
   */
  const resetStaticView = useCallback(
    (loadedMessages: SessionMessage[], options?: { clearScreen?: boolean }): Promise<void> => {
      if (options?.clearScreen) {
        writeStdout(ANSI_CLEAR_SCREEN);
      }
      setMessages([]);
      setWelcomeNonce((n) => n + 1);
      navigateToSubView("chat");
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          setMessages(loadedMessages);
          setShowWelcome(true);
          resolve();
        }, 0);
      });
    },
    [navigateToSubView]
  );

  useEffect(() => {
    if (!busy) {
      return;
    }
    const id = setInterval(() => setNowTick((tick) => tick + 1), 500);
    return () => clearInterval(id);
  }, [busy]);

  function loadVisibleMessages(manager: SessionManager, sessionId: string): SessionMessage[] {
    return manager.listSessionMessages(sessionId).filter((m) => m.visible);
  }

  const refreshSessionsList = useCallback((): void => {
    setSessions(sessionManager.listSessions());
  }, [sessionManager]);

  const refreshSkills = useCallback(
    async (sessionId?: string): Promise<void> => {
      try {
        const list = await sessionManager.listSkills(sessionId ?? sessionManager.getActiveSessionId() ?? undefined);
        setSkills(list);
      } catch {
        // ignore
      }
    },
    [sessionManager]
  );

  /**
   * Reset the app to the welcome screen.
   */
  const resetToWelcome = useCallback(async () => {
    writeRef.current(ANSI_CLEAR_SCREEN);
    sessionManager.setActiveSessionId(null);
    setStatusLine("");
    setErrorLine(null);
    setCommandNotice(null);
    setRunningProcesses(null);
    setActiveStatus(null);
    setActiveAskPermissions(undefined);
    setPendingPermissionReply(null);
    setPlanMode(false);
    setPendingPlanImplementation(null);
    setDismissedQuestionIds(new Set());
    await resetStaticView([]);
    await refreshSkills();
  }, [sessionManager, resetStaticView, refreshSkills]);

  /**
   * Refresh the list of sessions.
   */
  useEffect(() => {
    refreshSessionsList();
    void refreshSkills();
  }, [refreshSessionsList, refreshSkills]);

  // Eagerly create the OpenAI client on mount so the TCP+TLS connection
  // warmup (fire-and-forget inside createOpenAIClient) starts before the
  // user sends their first prompt.
  useEffect(() => {
    try {
      clientFactory();
    } catch (error) {
      setErrorLine(error instanceof Error ? error.message : String(error));
    }
  }, [clientFactory]);

  /**
   * Initialize MCP servers.
   */
  useLayoutEffect(() => {
    const settings = resolveCurrentSettings(projectRoot, settingsFile);
    void sessionManager.initMcpServers(settings.mcpServers);
  }, [projectRoot, settingsFile, sessionManager]);

  /**
   * Dispose the session manager on unmount.
   */
  useEffect(() => {
    return () => {
      compactionControllerRef.current?.abort();
      compactionControllerRef.current = null;
      sessionManager.dispose();
    };
  }, [sessionManager]);

  writeRef.current = write;
  const handleExit = useCallback(
    ({ showCommand, showSummary }: { showCommand: boolean; showSummary: boolean }) => {
      compactionControllerRef.current?.abort();
      compactionControllerRef.current = null;
      setIsExiting(true);
      setTimeout(() => {
        const activeSessionId = sessionManager.getActiveSessionId();
        const session = activeSessionId ? sessionManager.getSession(activeSessionId) : null;
        const resumeHint = buildResumeHintText(activeSessionId ?? undefined);
        const rateLimitHint = buildPluginRateLimitHintText(session);

        writeStdoutLine("\n");
        if (showCommand) {
          writeStdoutLine(chalk.rgb(34, 154, 195)(" > /exit "));
          writeStdoutLine("\n");
        }
        if (showSummary) {
          const summary = buildExitSummaryText({ session, sessionId: activeSessionId ?? undefined });
          writeStdoutLine(summary);
          writeStdoutLine("\n");
        }
        if (resumeHint) {
          writeStdoutLine(resumeHint);
          if (rateLimitHint) {
            writeStdoutLine(rateLimitHint);
          }
          writeStdoutLine("\n");
        }

        sessionManager.dispose();
        exit();
      }, 0);
    },
    [exit, sessionManager]
  );

  const handlePrompt = useCallback(
    async (submission: PromptSubmission) => {
      if (submission.command === "exit") {
        handleExit({ showCommand: true, showSummary: true });
        return;
      }
      if (compactionControllerRef.current) return;
      setCommandNotice(null);
      if (submission.command === "copy") {
        if (busy) return;
        setErrorLine(null);
        const sessionId = sessionManager.getActiveSessionId();
        const lastAssistant = sessionId
          ? [...sessionManager.listSessionMessages(sessionId)].reverse().find((message) => message.role === "assistant")
          : undefined;
        if (!lastAssistant) {
          return "No assistant messages to copy yet.";
        }
        if (lastAssistant.meta?.asThinking || !lastAssistant.content?.trim()) {
          return "No text to copy from the last assistant message.";
        }
        try {
          const success = await writeClipboardTextAsync(lastAssistant.content);
          return success ? "Copied to clipboard" : "Failed to copy";
        } catch {
          return "Failed to copy";
        }
      }
      if (submission.command === "compact") {
        if (busy) return;
        setErrorLine(null);
        const sessionId = sessionManager.getActiveSessionId();
        if (!sessionId || !sessionManager.getSession(sessionId)) {
          setCommandNotice("No active conversation to compact.");
          return;
        }
        const controller = new AbortController();
        compactionControllerRef.current = controller;
        setBusy(true);
        setCompacting(true);
        setStreamProgress(null);
        setRetryEvent(null);
        try {
          const changed = await sessionManager.compactSession(sessionId, controller.signal);
          if (compactionControllerRef.current !== controller) return;
          const session = sessionManager.getSession(sessionId);
          setStatusLine(session ? buildStatusLine(session, resolveCurrentSettings(projectRoot, settingsFile)) : "");
          refreshSessionsList();
          if (!changed) setCommandNotice("Conversation was not compacted.");
        } catch (error) {
          if (compactionControllerRef.current !== controller) return;
          if (controller.signal.aborted) {
            setCommandNotice("Compaction cancelled.");
          } else {
            setErrorLine(error instanceof Error ? error.message : String(error));
          }
        } finally {
          if (compactionControllerRef.current === controller) {
            compactionControllerRef.current = null;
            setCompacting(false);
            setBusy(false);
            setStreamProgress(null);
            setRetryEvent(null);
          }
        }
        return;
      }
      if (submission.command === "new") {
        if (onRestart) {
          onRestart();
        } else {
          await resetToWelcome();
          refreshSessionsList();
        }
        return;
      }
      if (submission.command === "resume") {
        refreshSessionsList();
        navigateToSubView("session-list");
        return;
      }
      if (submission.command === "fork") {
        const sourceSessionId = sessionManager.getActiveSessionId();
        if (!sourceSessionId) {
          setErrorLine("No active session to fork.");
          return;
        }
        try {
          const sessionId = sessionManager.forkSession(sourceSessionId);
          sessionManager.setActiveSessionId(sessionId);
          await resetStaticView(loadVisibleMessages(sessionManager, sessionId), { clearScreen: true });
          const session = sessionManager.getSession(sessionId);
          setStatusLine(session ? buildStatusLine(session, resolveCurrentSettings(projectRoot, settingsFile)) : "");
          setRunningProcesses(null);
          setActiveStatus(session?.status ?? null);
          setActiveAskPermissions(undefined);
          setPlanMode(session?.planMode === true);
          setPendingPlanImplementation(null);
          setPendingPermissionReply(null);
          setErrorLine(null);
          refreshSessionsList();
          await refreshSkills(sessionId);
        } catch (error) {
          setErrorLine(error instanceof Error ? error.message : String(error));
        }
        return;
      }
      if (submission.command === "continue" && isCurrentSessionEmpty(sessionManager)) {
        refreshSessionsList();
        navigateToSubView("session-list");
        return;
      }
      if (submission.command === "undo") {
        const activeSessionId = sessionManager.getActiveSessionId();
        if (!activeSessionId) {
          setErrorLine("No active session to undo.");
          return;
        }
        setUndoTargets(sessionManager.listUndoTargets(activeSessionId));
        navigateToSubView("undo");
        return;
      }
      if (submission.command === "mcp") {
        setMcpStatuses(sessionManager.getMcpStatus());
        navigateToSubView("mcp-status");
        return;
      }

      const activeSessionId = sessionManager.getActiveSessionId();
      const permissionReply =
        pendingPermissionReply?.sessionId === activeSessionId ? pendingPermissionReply.result : null;
      const { permissions, alwaysAllows, sessionAllows } = permissionReply ?? submission;
      const prompt: UserPromptContent = {
        text: submission.text,
        imageUrls: submission.imageUrls,
        skills:
          submission.selectedSkills && submission.selectedSkills.length > 0 ? submission.selectedSkills : undefined,
        permissions,
        alwaysAllows,
        sessionAllows,
        planMode: submission.planMode ?? planMode,
        isAnswers: submission.isAnswers,
      };

      const trimmedText = (submission.text ?? "").trim();
      const selectedSkillNames = submission.selectedSkills?.map((skill) => skill.name).filter(Boolean) ?? [];
      const userDisplayContent =
        trimmedText ||
        (selectedSkillNames.length > 0 ? `Use skills: ${selectedSkillNames.join(", ")}` : "") ||
        (submission.imageUrls.length > 0 ? "[Image]" : "");

      if (userDisplayContent && submission.command !== "continue") {
        setMessages((prev) => [
          ...prev,
          buildSyntheticUserMessage(
            userDisplayContent,
            submission.imageUrls.length,
            submission.isAnswers ? { isAnswers: true } : undefined
          ),
        ]);
      }

      setBusy(true);
      setErrorLine(null);
      setRetryEvent(null);
      const activeProcesses = activeSessionId ? (sessionManager.getSession(activeSessionId)?.processes ?? null) : null;
      setRunningProcesses(activeProcesses);
      setShowProcessStdout(false);
      if (!activeProcesses || activeProcesses.size === 0) {
        processStdoutRef.current.clear();
      }
      try {
        await sessionManager.handleUserPrompt(prompt);
        if (permissionReply) {
          setPendingPermissionReply(null);
        }
        await refreshSkills();
        refreshSessionsList();
        const completedSession = sessionManager.getSession(sessionManager.getActiveSessionId() ?? "");
        const proposedPlan = getCompletedProposedPlan(
          prompt.planMode === true,
          completedSession?.status,
          completedSession?.assistantReply ?? null
        );
        setPendingPlanImplementation(proposedPlan);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setErrorLine(message);
      } finally {
        setBusy(false);
        setStreamProgress(null);
        setRetryEvent(null);
        const finalActiveSessionId = sessionManager.getActiveSessionId();
        setRunningProcesses(
          finalActiveSessionId ? (sessionManager.getSession(finalActiveSessionId)?.processes ?? null) : null
        );
      }
    },
    [
      busy,
      sessionManager,
      pendingPermissionReply,
      handleExit,
      onRestart,
      refreshSkills,
      refreshSessionsList,
      navigateToSubView,
      resetToWelcome,
      resetStaticView,
      planMode,
      projectRoot,
      settingsFile,
    ]
  );

  const handleInterrupt = useCallback(() => {
    if (compactionControllerRef.current) {
      compactionControllerRef.current.abort();
      return;
    }
    sessionManager.interruptActiveSession();
  }, [sessionManager]);

  const handleToggleProcessStdout = useCallback(() => {
    setShowProcessStdout(true);
  }, []);

  const handleDismissProcessStdout = useCallback(() => {
    setShowProcessStdout(false);
  }, []);

  const handleAdjustBashTimeout = useCallback(
    (deltaMs: number, processId: string) => sessionManager.adjustActiveBashTimeout(deltaMs, processId),
    [sessionManager]
  );

  const handlePermissionSettingsChange = useCallback(
    (target: PermissionSettingsEdit["target"], changes: PermissionSettingsChanges): string => {
      const { changed } = writePermissionSettingsChanges(target, changes, projectRoot);
      setResolvedSettings(resolveCurrentSettings(projectRoot, settingsFile));
      return changed
        ? `Permissions saved (${target === "project" ? "This Project" : "All Projects"})`
        : "Permissions unchanged";
    },
    [projectRoot, settingsFile]
  );

  const handleModelConfigChange = useCallback(
    (selection: ModelConfigSelection, target: SettingsTarget): string => {
      const current = resolveCurrentSettings(projectRoot, settingsFile);
      const { changed } = writeModelConfigSelection(selection, current, projectRoot, target);
      const next = resolveCurrentSettings(projectRoot, settingsFile);
      setResolvedSettings(next);

      if (!changed) {
        return "Model settings unchanged";
      }
      if (formatModelConfig(current) === formatModelConfig(next)) {
        return `Model settings saved (${target === "project" ? "This Project" : "All Projects"})`;
      }

      const activeSessionId = sessionManager.getActiveSessionId();
      const meta: MessageMeta = {
        isModelChange: true,
      };
      const content = `/model\n└ Set model to ${next.model} (${next.thinkingEnabled ? next.reasoningEffort : "no thinking"})`;

      if (activeSessionId) {
        sessionManager.addSessionSystemMessage(activeSessionId, content, true, meta);
        const activeSession = sessionManager.getSession(activeSessionId);
        setStatusLine(activeSession ? buildStatusLine(activeSession, next) : "");
      } else {
        const now = new Date().toISOString();
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            sessionId: "local",
            role: "system" as const,
            content,
            contentParams: null,
            messageParams: null,
            compacted: false,
            visible: true,
            createTime: now,
            updateTime: now,
            meta,
          },
        ]);
      }

      return `Model settings updated: ${formatModelConfig(current)} → ${formatModelConfig(next)}`;
    },
    [projectRoot, settingsFile, sessionManager]
  );

  const handleSubmit = useCallback(
    (submission: PromptSubmission) => {
      return handlePrompt(submission);
    },
    [handlePrompt]
  );

  const handlePlanImplementationChoice = useCallback(
    (choice: PlanImplementationChoice) => {
      const proposedPlan = pendingPlanImplementation;
      setPendingPlanImplementation(null);
      if (choice === "stay") {
        return;
      }
      setPlanMode(false);
      if (choice === "clear-context" && proposedPlan) {
        void resetToWelcome().then(() => {
          handleSubmit({
            text: getClearContextImplementationPrompt(proposedPlan),
            imageUrls: [],
            planMode: false,
          });
        });
        return;
      }
      if (choice === "implement" && proposedPlan) {
        handleSubmit({
          text: getImplementationPrompt(proposedPlan),
          imageUrls: [],
          planMode: false,
        });
      }
    },
    [handleSubmit, pendingPlanImplementation, resetToWelcome]
  );

  const handleExitShortcut = useCallback(() => {
    handleExit({ showCommand: false, showSummary: false });
  }, [handleExit]);

  const reloadActiveSessionView = useCallback(
    (sessionId: string): void => {
      resetStaticView(loadVisibleMessages(sessionManager, sessionId), { clearScreen: true });
    },
    [resetStaticView, sessionManager]
  );

  const handleSelectSession = useCallback(
    async (sessionId: string) => {
      setCommandNotice(null);
      sessionManager.setActiveSessionId(sessionId);
      // Clear first so <Static> resets its index to 0.
      await resetStaticView(loadVisibleMessages(sessionManager, sessionId), { clearScreen: true });
      const session = sessionManager.getSession(sessionId);
      setStatusLine(session ? buildStatusLine(session, resolveCurrentSettings(projectRoot, settingsFile)) : "");
      setRunningProcesses(session?.processes ?? null);
      setActiveStatus(session?.status ?? null);
      setActiveAskPermissions(session?.askPermissions);
      setPlanMode(session?.planMode === true);
      setPendingPlanImplementation(null);
      if (pendingPermissionReply && pendingPermissionReply.sessionId !== sessionId) {
        setPendingPermissionReply(null);
      }
      await refreshSkills(sessionId);
    },
    [sessionManager, resetStaticView, pendingPermissionReply, projectRoot, settingsFile, refreshSkills]
  );

  /**
   * Coordinated startup effect: handle --resume and --prompt together.
   * When both are present, resume the session first, then submit the prompt.
   */
  useEffect(() => {
    if (startupDoneRef.current) {
      return;
    }
    startupDoneRef.current = true;

    async function run() {
      try {
        // Step 1: Resume or fork a session if requested
        if (forkSessionId) {
          const sessionId = sessionManager.forkSession(forkSessionId);
          await handleSelectSession(sessionId);
        } else if (resumeSessionId) {
          resumeSessionIdRef.current = true;
          if (resumeSessionId === true) {
            // Bare --resume — show session picker; prompt makes no sense here
            refreshSessionsList();
            navigateToSubView("session-list");
            return;
          }
          await handleSelectSession(resumeSessionId);
        }

        // Step 2: Submit prompt if provided
        if (initialPrompt && initialPrompt.trim()) {
          initialPromptSubmittedRef.current = true;
          handleSubmit({
            text: initialPrompt,
            imageUrls: [],
            selectedSkills: undefined,
          });
        }
      } catch (error) {
        setErrorLine(error instanceof Error ? error.message : String(error));
      }
    }

    void run();
  }, [
    forkSessionId,
    handleSubmit,
    handleSelectSession,
    initialPrompt,
    navigateToSubView,
    refreshSessionsList,
    resumeSessionId,
    sessionManager,
  ]);

  const handleDeleteSession = useCallback(
    async (id: string): Promise<void> => {
      const isActiveSession = sessionManager.getActiveSessionId() === id;

      // If the deleted session is the active one, clear the active session first
      if (isActiveSession) {
        sessionManager.setActiveSessionId(null);
      }

      sessionManager.deleteSession(id);
      refreshSessionsList();

      if (isActiveSession) {
        await resetToWelcome();
      }
    },
    [sessionManager, refreshSessionsList, resetToWelcome]
  );

  const handlePromptDraftApplied = useCallback((nonce: number) => {
    // Consume the draft so remounting PromptInput cannot restore it again.
    setPromptDraft((draft) => (draft?.nonce === nonce ? null : draft));
  }, []);

  const handleUndoRestore = useCallback(
    async (target: UndoTarget, restoreMode: UndoRestoreMode): Promise<void> => {
      const sessionId = sessionManager.getActiveSessionId();
      if (!sessionId) {
        setErrorLine("No active session to undo.");
        setView("chat");
        setShowWelcome(true);
        return;
      }

      const errors: string[] = [];
      if (restoreMode === "code-and-conversation") {
        try {
          sessionManager.restoreSessionCode(sessionId, target.message.id);
        } catch (error) {
          errors.push(`Code restore failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      let conversationRestored = false;
      try {
        sessionManager.restoreSessionConversation(sessionId, target.message.id);
        conversationRestored = true;
      } catch (error) {
        errors.push(`Conversation restore failed: ${error instanceof Error ? error.message : String(error)}`);
      }

      refreshSessionsList();
      await refreshSkills(sessionId);
      setView("chat");
      setErrorLine(errors.length > 0 ? errors.join(" ") : null);
      if (conversationRestored) {
        setPromptDraft(buildPromptDraftFromSessionMessage(target.message, Date.now()));
      }
      reloadActiveSessionView(sessionId);
    },
    [reloadActiveSessionView, refreshSessionsList, refreshSkills, sessionManager]
  );

  const handleRawModeChange = useCallback(
    (nextMode: string) => {
      const activeSessionId = sessionManager.getActiveSessionId();
      setMode(nextMode as RawMode);
      if (nextMode === RawMode.Lite || nextMode === RawMode.None) {
        try {
          writeRawMode(nextMode === RawMode.Lite ? "lite" : "normal");
        } catch {
          setErrorLine("Could not save display mode.");
        }
      }
      // Reset chat view state synchronously so the transition frame does not
      // re-render a stale welcome screen before handleSelectSession runs.
      setShowWelcome(false);
      setMessages([]);
      // Clear screen to remove stale formatted text.
      writeStdout(ANSI_CLEAR_SCREEN);

      setTimeout(() => {
        if (nextMode === RawMode.Raw) {
          // Write all messages directly to stdout for raw scrollback mode.
          const allMessages = activeSessionId ? loadVisibleMessages(sessionManager, activeSessionId) : [];
          renderRawModeMessages(allMessages, nextMode);
        } else if (activeSessionId) {
          // Switch to chat view to render messages.
          handleSelectSession(activeSessionId);
        } else {
          // No active session: just show the welcome screen once.
          setWelcomeNonce((n) => n + 1);
          setShowWelcome(true);
        }
      }, 200);
    },
    [handleSelectSession, sessionManager, setMode]
  );

  useEffect(() => {
    if (!stdout?.isTTY) {
      return;
    }
    if (columns <= 0) {
      return;
    }
    if (lastRenderedColumnsRef.current === null) {
      lastRenderedColumnsRef.current = columns;
      return;
    }
    if (lastRenderedColumnsRef.current === columns) {
      return;
    }
    lastRenderedColumnsRef.current = columns;

    if (mode === RawMode.Raw) {
      // In raw mode, re-render all messages directly to stdout at the new width.
      // Use direct stdout instead of writeRef to avoid Ink interference.
      writeStdout(ANSI_CLEAR_SCREEN);
      const activeSessionId = sessionManager.getActiveSessionId();
      const allMessages = activeSessionId ? loadVisibleMessages(sessionManager, activeSessionId) : [];
      renderRawModeMessages(allMessages, mode);
      return;
    }

    // Force full redraw on terminal resize to avoid stale wrapped rows.
    writeRef.current("\u001B[2J\u001B[H");

    setMessages([]);
    setShowWelcome(false);
    setWelcomeNonce((n) => n + 1);

    const activeSessionId = sessionManager.getActiveSessionId();
    const nextMessages =
      activeSessionId && !busy ? loadVisibleMessages(sessionManager, activeSessionId) : messagesRef.current;
    setTimeout(() => {
      setMessages(nextMessages);
      setShowWelcome(true);
    }, 0);
  }, [busy, mode, sessionManager, columns, stdout]);

  const screenWidth = useMemo(() => columns ?? stdout?.columns ?? 80, [columns, stdout]);
  const screenHeight = useMemo(() => rows ?? stdout?.rows ?? 24, [rows, stdout]);
  const getSessionInfo = useCallback((): SessionInfo | null => {
    const activeSessionId = sessionManager.getActiveSessionId();
    const settings = resolveCurrentSettings(projectRoot, settingsFile);
    const model = settings.model || "";
    const thinkingEnabled = settings.thinkingEnabled;
    const reasoningEffort = settings.reasoningEffort;
    const maxContextTokens = settings.contextWindow;
    if (!activeSessionId) {
      return {
        activeSessionId: null,
        messageCount: 0,
        requestCount: 0,
        totalTokens: 0,
        activeTokens: 0,
        maxContextTokens,
        model,
        thinkingEnabled,
        reasoningEffort,
        toolUsage: {},
      };
    }
    const session = sessionManager.getSession(activeSessionId);
    const messages = sessionManager.listSessionMessages(activeSessionId);
    const usage = session?.usage;
    const totalTokens =
      usage && typeof (usage as { total_tokens?: unknown }).total_tokens === "number"
        ? ((usage as { total_tokens: number }).total_tokens ?? 0)
        : 0;
    const requestCount =
      usage && typeof (usage as { total_reqs?: unknown }).total_reqs === "number"
        ? ((usage as { total_reqs: number }).total_reqs ?? 0)
        : 0;
    const toolUsage: Record<string, number> = {};
    for (const msg of messages) {
      if (msg.role === "tool" && msg.meta?.function) {
        const fn = msg.meta.function as { name?: string };
        if (fn.name) {
          toolUsage[fn.name] = (toolUsage[fn.name] || 0) + 1;
        }
      }
    }
    return {
      activeSessionId,
      messageCount: messages.length,
      requestCount,
      totalTokens,
      activeTokens: session?.activeTokens ?? 0,
      maxContextTokens,
      model,
      thinkingEnabled,
      reasoningEffort,
      toolUsage,
    };
  }, [sessionManager, projectRoot, settingsFile]);
  const statusLineSegments = useStatusLine(resolvedSettings.statusline, projectRoot, getSessionInfo);
  const promptHistory = useMemo(() => buildPromptHistory(messages), [messages]);
  const expandedThinkingId = findExpandedThinkingId(messages);
  const pendingQuestion = useMemo(() => findPendingAskUserQuestion(messages, activeStatus), [activeStatus, messages]);
  const shouldShowQuestionPrompt = Boolean(pendingQuestion && !dismissedQuestionIds.has(pendingQuestion.messageId));
  const loadingText = useMemo(
    () =>
      compacting
        ? "Compacting conversation..."
        : busy
          ? buildLoadingText({
              progress: streamProgress,
              retry: retryEvent,
              processes: runningProcesses,
              screenWidth,
              now: Date.now(),
            })
          : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nowTick forces periodic recalculation for spinner animation
    [compacting, busy, streamProgress, retryEvent, runningProcesses, nowTick, screenWidth]
  );

  const welcomeItem: SessionMessage = useMemo(
    () => ({
      id: `__welcome__${welcomeNonce}`,
      sessionId: "",
      role: "system",
      content: "",
      contentParams: null,
      messageParams: null,
      compacted: false,
      visible: true,
      createTime: "",
      updateTime: "",
    }),
    [welcomeNonce]
  );
  const staticItems = useMemo(() => {
    if (mode === RawMode.Raw) {
      return [];
    }
    if (showWelcome && view === "chat") {
      return [welcomeItem, ...messages];
    }
    return messages;
  }, [mode, showWelcome, view, messages, welcomeItem]);
  const promptCursorLayoutKey = useMemo(() => {
    const lastStaticItem = staticItems.at(-1);
    return [
      view,
      busy ? "busy" : "idle",
      statusLine,
      errorLine ?? "",
      commandNotice ?? "",
      showProcessStdout ? "stdout" : "main",
      activeStatus ?? "",
      staticItems.length,
      lastStaticItem?.id ?? "",
      lastStaticItem?.updateTime ?? "",
      shouldShowQuestionPrompt ? (pendingQuestion?.messageId ?? "") : "",
      activeAskPermissions?.length ?? 0,
      pendingPermissionReply ? "pending-permission-reply" : "no-pending-permission-reply",
    ].join("\u001E");
  }, [
    activeAskPermissions,
    activeStatus,
    busy,
    commandNotice,
    errorLine,
    pendingPermissionReply,
    pendingQuestion,
    shouldShowQuestionPrompt,
    showProcessStdout,
    staticItems,
    statusLine,
    view,
  ]);

  const handleQuestionAnswers = useCallback(
    (answers: AskUserQuestionAnswers) => {
      void handlePrompt({
        text: formatAskUserQuestionAnswers(answers),
        imageUrls: [],
        isAnswers: true,
      });
    },
    [handlePrompt]
  );

  const handleQuestionCancel = useCallback(() => {
    if (!pendingQuestion) {
      return;
    }
    setDismissedQuestionIds((prev) => new Set(prev).add(pendingQuestion.messageId));
  }, [pendingQuestion]);

  const handlePermissionResult = useCallback(
    (result: PermissionPromptResult) => {
      const sessionId = sessionManager.getActiveSessionId();
      if (!sessionId) {
        return;
      }
      setPromptDraft(null);
      if (result.permissions.some(({ permission }) => permission === "deny")) {
        setPendingPermissionReply({ sessionId, result });
        setStatusLine("Permission denied. Add a reply, then press Enter to continue.");
        sessionManager.denySessionPermission(sessionId);
        return;
      }
      void handlePrompt({
        text: "/continue",
        imageUrls: [],
        command: "continue",
        ...result,
      });
    },
    [handlePrompt, sessionManager]
  );

  const handlePermissionCancel = useCallback(() => {
    sessionManager.interruptActiveSession();
    setActiveStatus("interrupted");
    setActiveAskPermissions(undefined);
    setPromptDraft(null);
    refreshSessionsList();
  }, [refreshSessionsList, sessionManager]);

  if (mode === RawMode.Raw) {
    return <RawModeExitPrompt onExit={(prev) => handleRawModeChange(prev)} />;
  }

  return (
    <Box flexDirection="column" width={screenWidth}>
      <Static items={staticItems}>
        {(item) => {
          if (item.id.startsWith("__welcome__")) {
            return (
              <WelcomeScreen
                key={item.id}
                projectRoot={projectRoot}
                settings={resolvedSettings}
                skills={skills}
                width={screenWidth}
              />
            );
          }
          return (
            <MessageView
              key={item.id}
              message={item}
              projectRoot={projectRoot}
              collapsed={isCollapsedThinking(item, expandedThinkingId)}
              width={screenWidth}
            />
          );
        }}
      </Static>
      {(busy || statusLine) && !isExiting ? <StatusLine busy={busy} text={statusLine} width={screenWidth} /> : null}
      {commandNotice && !isExiting ? (
        <Box>
          <Text dimColor>{commandNotice}</Text>
        </Box>
      ) : null}
      {errorLine ? (
        <Box>
          <Text color="red">Error: {errorLine}</Text>
        </Box>
      ) : null}
      {showProcessStdout ? (
        <ProcessStdoutView
          key={activeSessionId}
          items={processOutputItems}
          processStdoutRef={processStdoutRef}
          onDismiss={handleDismissProcessStdout}
          onAdjustTimeout={handleAdjustBashTimeout}
          screenWidth={screenWidth}
          screenHeight={screenHeight}
        />
      ) : view === "session-list" ? (
        <SessionList
          sessions={sessions}
          onSelect={(id) => void handleSelectSession(id)}
          onCancel={() => setView("chat")}
          onDelete={(id) => {
            void handleDeleteSession(id);
          }}
          onRename={(id, newName) => {
            if (sessionManager.renameSession(id, newName)) {
              refreshSessionsList();
              setStatusLine(`Session renamed to "${newName}".`);
            } else {
              setErrorLine("Failed to rename session.");
            }
          }}
        />
      ) : view === "undo" ? (
        <UndoSelector
          targets={undoTargets}
          onSelect={(target, restoreMode) => void handleUndoRestore(target, restoreMode)}
          onCancel={() => {
            setPromptDraft(null);
            setView("chat");
          }}
        />
      ) : view === "mcp-status" ? (
        <McpStatusList
          statuses={mcpStatuses}
          onCancel={() => setView("chat")}
          onReconnect={(name) => {
            const latest = resolveCurrentSettings(projectRoot, settingsFile);
            void sessionManager.reconnectMcpServer(name, latest.mcpServers?.[name]);
          }}
        />
      ) : shouldShowQuestionPrompt && pendingQuestion && !busy ? (
        <AskUserQuestionPrompt
          questions={pendingQuestion.questions}
          onSubmit={handleQuestionAnswers}
          onCancel={handleQuestionCancel}
        />
      ) : activeStatus === "ask_permission" &&
        activeAskPermissions &&
        activeAskPermissions.length > 0 &&
        !pendingPermissionReply &&
        !busy ? (
        <PermissionPrompt
          key={sessionManager.getActiveSessionId()}
          requests={activeAskPermissions}
          planMode={sessionManager.getSession(sessionManager.getActiveSessionId() ?? "")?.planMode === true}
          onSubmit={handlePermissionResult}
          onCancel={handlePermissionCancel}
        />
      ) : pendingPlanImplementation && !busy ? (
        <PlanImplementationPrompt onSelect={handlePlanImplementationChoice} />
      ) : isExiting ? null : (
        <PromptInput
          key={sessionManager.getActiveSessionId() ?? "new"}
          projectRoot={projectRoot}
          screenWidth={screenWidth}
          skills={skills}
          modelConfig={resolvedSettings}
          promptHistory={promptHistory}
          busy={busy}
          cursorLayoutKey={promptCursorLayoutKey}
          loadingText={loadingText}
          promptDraft={promptDraft}
          onPromptDraftApplied={handlePromptDraftApplied}
          onSubmit={handleSubmit}
          onModelConfigChange={handleModelConfigChange}
          onPermissionSettingsChange={handlePermissionSettingsChange}
          onRawModeChange={handleRawModeChange}
          onInterrupt={handleInterrupt}
          onToggleProcessStdout={handleToggleProcessStdout}
          onExitShortcut={handleExitShortcut}
          placeholder="Type your message..."
          statusLineSegments={statusLineSegments}
          statusLineSeparator={resolvedSettings.statusline.separator}
          planMode={planMode}
          onPlanModeChange={setPlanMode}
        />
      )}
    </Box>
  );
}

export default App;
