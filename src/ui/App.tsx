import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Box, Static, Text, useApp, useStdout, useWindowSize } from "ink";
import chalk from "chalk";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createOpenAIClient } from "../common/openai-client";
import {
  type LlmStreamProgress,
  type MessageMeta,
  type SessionEntry,
  SessionManager,
  type SessionMessage,
  type SessionStatus,
  type SkillInfo,
  type UndoTarget,
  type UserPromptContent,
} from "../session";
import {
  applyModelConfigSelection,
  type DeepcodingSettings,
  type ModelConfigSelection,
  type ResolvedDeepcodingSettings,
  resolveSettingsSources,
} from "../settings";
import { PromptInput, type PromptDraft, type PromptSubmission } from "./PromptInput";
import { MessageView, RawModeExitPrompt } from "./components";
import { SessionList } from "./SessionList";
import { UndoSelector, type UndoRestoreMode } from "./UndoSelector";
import { buildLoadingText } from "./loadingText";
import { findExpandedThinkingId } from "./thinkingState";
import { WelcomeScreen } from "./WelcomeScreen";
import { AskUserQuestionPrompt } from "./AskUserQuestionPrompt";
import { McpStatusList } from "./McpStatusList";
import { ProcessStdoutView } from "./ProcessStdoutView";
import {
  type AskUserQuestionAnswers,
  findPendingAskUserQuestion,
  formatAskUserQuestionAnswers,
} from "./askUserQuestion";
import { buildExitSummaryText } from "./exitSummary";
import { RawMode, useRawModeContext } from "./contexts";
import { renderMessageToStdout } from "./components/MessageView/utils";

const DEFAULT_MODEL = "deepseek-v4-pro";
const DEFAULT_BASE_URL = "https://api.deepseek.com";

type View = "chat" | "session-list" | "undo" | "mcp-status";

type AppProps = {
  projectRoot: string;
  initialPrompt?: string;
  onRestart?: () => void;
};

export function App({ projectRoot, initialPrompt, onRestart }: AppProps): React.ReactElement {
  const { exit } = useApp();
  const { stdout, write } = useStdout();
  const { columns, rows } = useWindowSize();
  const { mode, setMode } = useRawModeContext();
  const initialPromptSubmittedRef = useRef(false);
  const processStdoutRef = useRef<Map<number, string>>(new Map());
  const rawModeRef = useRef<RawMode>(mode);
  const writeRef = useRef(write);
  const lastRenderedColumnsRef = useRef<number | null>(null);
  const messagesRef = useRef<SessionMessage[]>([]);
  const [view, setView] = useState<View>("chat");
  const [busy, setBusy] = useState(false);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [messages, setMessages] = useState<SessionMessage[]>([]);
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [undoTargets, setUndoTargets] = useState<UndoTarget[]>([]);
  const [promptDraft, setPromptDraft] = useState<PromptDraft | null>(null);
  const [statusLine, setStatusLine] = useState<string>("");
  const [errorLine, setErrorLine] = useState<string | null>(null);
  const [streamProgress, setStreamProgress] = useState<LlmStreamProgress | null>(null);
  const [runningProcesses, setRunningProcesses] = useState<SessionEntry["processes"]>(null);
  const [activeStatus, setActiveStatus] = useState<SessionStatus | null>(null);
  const [dismissedQuestionIds, setDismissedQuestionIds] = useState<Set<string>>(() => new Set());
  const [isExiting, setIsExiting] = useState(false);
  const [showWelcome, setShowWelcome] = useState(true);
  const [welcomeNonce, setWelcomeNonce] = useState(0);
  const [resolvedSettings, setResolvedSettings] = useState(() => resolveCurrentSettings(projectRoot));
  const [nowTick, setNowTick] = useState(0);
  const [mcpStatuses, setMcpStatuses] = useState<ReturnType<typeof sessionManager.getMcpStatus>>([]);
  const [showProcessStdout, setShowProcessStdout] = useState(false);

  rawModeRef.current = mode;
  messagesRef.current = messages;

  const sessionManager = useMemo(() => {
    return new SessionManager({
      projectRoot,
      createOpenAIClient: () => createOpenAIClient(projectRoot),
      getResolvedSettings: () => resolveCurrentSettings(projectRoot),
      renderMarkdown: (text) => text,
      onAssistantMessage: (message: SessionMessage) => {
        setMessages((prev) => [...prev, message]);
        if (rawModeRef.current === RawMode.Raw) {
          process.stdout.write("\n");
          process.stdout.write(renderMessageToStdout(message, rawModeRef.current) + "\n\n");
        }
      },
      onSessionEntryUpdated: (entry) => {
        setStatusLine(buildStatusLine(entry));
        setRunningProcesses(entry.processes);
        setActiveStatus(entry.status);
      },
      onLlmStreamProgress: (progress) => {
        if (progress.phase === "end") {
          setStreamProgress(null);
          return;
        }
        setStreamProgress(progress);
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
  }, [projectRoot]);

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

  useEffect(() => {
    refreshSessionsList();
    void refreshSkills();
  }, [refreshSessionsList, refreshSkills]);

  // Eagerly create the OpenAI client on mount so the TCP+TLS connection
  // warmup (fire-and-forget inside createOpenAIClient) starts before the
  // user sends their first prompt.
  useEffect(() => {
    createOpenAIClient(projectRoot);
  }, [projectRoot]);

  useLayoutEffect(() => {
    const settings = resolveCurrentSettings(projectRoot);
    void sessionManager.initMcpServers(settings.mcpServers);
  }, [projectRoot, sessionManager]);

  useEffect(() => {
    return () => {
      sessionManager.dispose();
    };
  }, [sessionManager]);

  writeRef.current = write;
  const handlePrompt = useCallback(
    async (submission: PromptSubmission) => {
      if (submission.command === "exit") {
        setIsExiting(true);
        setTimeout(() => {
          const activeSessionId = sessionManager.getActiveSessionId();
          const session = activeSessionId ? sessionManager.getSession(activeSessionId) : null;
          const summary = buildExitSummaryText({ session });
          process.stdout.write("\n");
          process.stdout.write(chalk.rgb(34, 154, 195)("> /exit "));
          process.stdout.write("\n\n");
          process.stdout.write(summary);
          process.stdout.write("\n\n");
          sessionManager.dispose();
          exit();
        }, 0);
        return;
      }
      if (submission.command === "new") {
        if (onRestart) {
          onRestart();
        } else {
          writeRef.current("\u001B[2J\u001B[3J\u001B[H");
          sessionManager.setActiveSessionId(null);
          setMessages([]);
          setStatusLine("");
          setErrorLine(null);
          setRunningProcesses(null);
          setActiveStatus(null);
          setDismissedQuestionIds(new Set());
          setShowWelcome(true);
          setWelcomeNonce((n) => n + 1);
          await refreshSkills();
          refreshSessionsList();
        }
        return;
      }
      if (submission.command === "resume") {
        setShowWelcome(false);
        refreshSessionsList();
        setView("session-list");
        return;
      }
      if (submission.command === "continue" && isCurrentSessionEmpty(sessionManager)) {
        setShowWelcome(false);
        refreshSessionsList();
        setView("session-list");
        return;
      }
      if (submission.command === "undo") {
        const activeSessionId = sessionManager.getActiveSessionId();
        if (!activeSessionId) {
          setErrorLine("No active session to undo.");
          return;
        }
        setShowWelcome(false);
        setUndoTargets(sessionManager.listUndoTargets(activeSessionId));
        setView("undo");
        return;
      }
      if (submission.command === "mcp") {
        setShowWelcome(false);
        setMcpStatuses(sessionManager.getMcpStatus());
        setView("mcp-status");
        return;
      }

      const prompt: UserPromptContent = {
        text: submission.text,
        imageUrls: submission.imageUrls,
        skills:
          submission.selectedSkills && submission.selectedSkills.length > 0 ? submission.selectedSkills : undefined,
      };

      const trimmedText = (submission.text ?? "").trim();
      const selectedSkillNames = submission.selectedSkills?.map((skill) => skill.name).filter(Boolean) ?? [];
      const userDisplayContent =
        trimmedText ||
        (selectedSkillNames.length > 0 ? `Use skills: ${selectedSkillNames.join(", ")}` : "") ||
        (submission.imageUrls.length > 0 ? "[Image]" : "");

      if (userDisplayContent && submission.command !== "continue") {
        setMessages((prev) => [...prev, buildSyntheticUserMessage(userDisplayContent, submission.imageUrls.length)]);
      }

      setBusy(true);
      setErrorLine(null);
      setRunningProcesses(null);
      setShowProcessStdout(false);
      processStdoutRef.current.clear();
      try {
        await sessionManager.handleUserPrompt(prompt);
        await refreshSkills();
        refreshSessionsList();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setErrorLine(message);
      } finally {
        setBusy(false);
        setStreamProgress(null);
        setRunningProcesses(null);
      }
    },
    [exit, onRestart, sessionManager, refreshSkills, refreshSessionsList]
  );

  const handleInterrupt = useCallback(() => {
    sessionManager.interruptActiveSession();
  }, [sessionManager]);

  const handleToggleProcessStdout = useCallback(() => {
    setShowProcessStdout(true);
  }, []);

  const handleDismissProcessStdout = useCallback(() => {
    setShowProcessStdout(false);
  }, []);

  const handleAdjustBashTimeout = useCallback(
    (deltaMs: number) => sessionManager.adjustActiveBashTimeout(deltaMs),
    [sessionManager]
  );

  const handleModelConfigChange = useCallback(
    (selection: ModelConfigSelection): string => {
      const current = resolveCurrentSettings(projectRoot);
      const { changed } = writeModelConfigSelection(selection, current, projectRoot);
      const next = resolveCurrentSettings(projectRoot);
      setResolvedSettings(next);

      if (!changed) {
        return "Model settings unchanged";
      }

      const activeSessionId = sessionManager.getActiveSessionId();
      const meta: MessageMeta = {
        isModelChange: true,
      };
      const content = `/model\n└ Set model to ${selection.model} (${selection?.thinkingEnabled ? selection?.reasoningEffort : "no thinking"})`;

      if (activeSessionId) {
        sessionManager.addSessionSystemMessage(activeSessionId, content, true, meta);
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
    [projectRoot, sessionManager]
  );

  const handleSubmit = useCallback(
    (submission: PromptSubmission) => {
      void handlePrompt(submission);
    },
    [handlePrompt]
  );

  const reloadActiveSessionView = useCallback(
    (sessionId: string): void => {
      process.stdout.write("\u001B[2J\u001B[3J\u001B[H");
      setMessages([]);
      setShowWelcome(false);
      setWelcomeNonce((n) => n + 1);
      setTimeout(() => {
        setMessages(loadVisibleMessages(sessionManager, sessionId));
        setShowWelcome(true);
      }, 0);
    },
    [sessionManager]
  );

  useEffect(() => {
    if (initialPromptSubmittedRef.current || !initialPrompt || !initialPrompt.trim()) {
      return;
    }

    initialPromptSubmittedRef.current = true;
    handleSubmit({
      text: initialPrompt,
      imageUrls: [],
      selectedSkills: undefined,
    });
  }, [handleSubmit, initialPrompt]);

  const handleSelectSession = useCallback(
    async (sessionId: string) => {
      const currentSessionId = sessionManager.getActiveSessionId();
      if (currentSessionId !== sessionId) {
        process.stdout.write("\u001B[2J\u001B[3J\u001B[H");
      }
      sessionManager.setActiveSessionId(sessionId);
      // Clear first so <Static> resets its index to 0.
      setMessages([]);
      setShowWelcome(false);
      setWelcomeNonce((n) => n + 1);
      setView("chat");
      // Load messages after the reset so all static items are rendered.
      setTimeout(() => {
        setMessages(loadVisibleMessages(sessionManager, sessionId));
        setShowWelcome(true);
      }, 0);
      const session = sessionManager.getSession(sessionId);
      setStatusLine(session ? buildStatusLine(session) : "");
      setRunningProcesses(session?.processes ?? null);
      setActiveStatus(session?.status ?? null);
      await refreshSkills(sessionId);
    },
    [sessionManager, refreshSkills]
  );

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
      // Reset chat view state synchronously so the transition frame does not
      // re-render a stale welcome screen before handleSelectSession runs.
      setShowWelcome(false);
      setMessages([]);
      // Clear screen to remove stale formatted text.
      process.stdout.write("\u001B[2J\u001B[3J\u001B[H");

      setTimeout(() => {
        if (nextMode === RawMode.Raw) {
          // Write all messages directly to stdout for raw scrollback mode.
          const allMessages = activeSessionId ? loadVisibleMessages(sessionManager, activeSessionId) : [];
          for (const msg of allMessages) {
            process.stdout.write("\n");
            process.stdout.write(renderMessageToStdout(msg, nextMode) + "\n\n");
          }
          if (allMessages.length > 0) {
            process.stdout.write("\n\n");
            process.stdout.write(chalk.dim("Press ESC to exit raw mode"));
          } else {
            process.stdout.write("\n");
            process.stdout.write(chalk.dim("(No messages in this session yet. Start chatting to see them here.)"));
            process.stdout.write("\n\n");
            process.stdout.write(chalk.dim("Press ESC to exit raw mode"));
          }
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
      // Use process.stdout.write instead of writeRef to avoid Ink interference.
      process.stdout.write("\u001B[2J\u001B[3J\u001B[H");
      const activeSessionId = sessionManager.getActiveSessionId();
      const allMessages = activeSessionId ? loadVisibleMessages(sessionManager, activeSessionId) : [];
      for (const msg of allMessages) {
        process.stdout.write("\n");
        process.stdout.write(renderMessageToStdout(msg, mode) + "\n\n");
      }
      if (allMessages.length > 0) {
        process.stdout.write("\n\n");
        process.stdout.write(chalk.dim("Press ESC to exit raw mode"));
      } else {
        process.stdout.write("\n");
        process.stdout.write(chalk.dim("(No messages in this session yet. Start chatting to see them here.)"));
        process.stdout.write("\n\n");
        process.stdout.write(chalk.dim("Press ESC to exit raw mode"));
      }
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
  const promptHistory = useMemo(() => {
    return messages
      .filter((message) => message.role === "user" && typeof message.content === "string")
      .map((message) => (message.content ?? "").trim())
      .filter((content) => content.length > 0);
  }, [messages]);
  const expandedThinkingId = findExpandedThinkingId(messages);
  const pendingQuestion = useMemo(() => findPendingAskUserQuestion(messages, activeStatus), [activeStatus, messages]);
  const shouldShowQuestionPrompt = Boolean(pendingQuestion && !dismissedQuestionIds.has(pendingQuestion.messageId));
  const loadingText = useMemo(
    () => (busy ? buildLoadingText({ progress: streamProgress, processes: runningProcesses, now: Date.now() }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nowTick forces periodic recalculation for spinner animation
    [busy, streamProgress, runningProcesses, nowTick]
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

  const handleQuestionAnswers = useCallback(
    (answers: AskUserQuestionAnswers) => {
      void handlePrompt({
        text: formatAskUserQuestionAnswers(answers),
        imageUrls: [],
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

  if (mode === RawMode.Raw) {
    return <RawModeExitPrompt onExit={(prev) => handleRawModeChange(prev)} />;
  }

  return (
    <Box flexDirection="column" width={screenWidth} minWidth={80} overflowX={"visible"}>
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
              collapsed={isCollapsedThinking(item, expandedThinkingId)}
              width={screenWidth}
            />
          );
        }}
      </Static>
      {statusLine ? (
        <Box>
          <Text dimColor>{statusLine}</Text>
        </Box>
      ) : null}
      {errorLine ? (
        <Box>
          <Text color="red">Error: {errorLine}</Text>
        </Box>
      ) : null}
      {showProcessStdout ? (
        <ProcessStdoutView
          processStdoutRef={processStdoutRef}
          runningProcesses={runningProcesses}
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
        />
      ) : view === "undo" ? (
        <UndoSelector
          targets={undoTargets}
          onSelect={(target, restoreMode) => void handleUndoRestore(target, restoreMode)}
          onCancel={() => {
            setView("chat");
            setShowWelcome(true);
          }}
        />
      ) : view === "mcp-status" ? (
        <McpStatusList
          statuses={mcpStatuses}
          onCancel={() => setView("chat")}
          onReconnect={(name) => {
            const latest = resolveCurrentSettings(projectRoot);
            void sessionManager.reconnectMcpServer(name, latest.mcpServers?.[name]);
          }}
        />
      ) : shouldShowQuestionPrompt && pendingQuestion && !busy ? (
        <AskUserQuestionPrompt
          questions={pendingQuestion.questions}
          onSubmit={handleQuestionAnswers}
          onCancel={handleQuestionCancel}
        />
      ) : isExiting ? null : (
        <PromptInput
          projectRoot={projectRoot}
          screenWidth={screenWidth}
          skills={skills}
          modelConfig={resolvedSettings}
          promptHistory={promptHistory}
          busy={busy}
          loadingText={loadingText}
          runningProcesses={runningProcesses}
          promptDraft={promptDraft}
          onSubmit={handleSubmit}
          onModelConfigChange={handleModelConfigChange}
          onRawModeChange={handleRawModeChange}
          onInterrupt={handleInterrupt}
          onToggleProcessStdout={handleToggleProcessStdout}
          placeholder="Type your message..."
        />
      )}
    </Box>
  );
}

function isCollapsedThinking(message: SessionMessage, expandedId: string | null): boolean {
  if (message.role !== "assistant") {
    return false;
  }
  if (!message.meta?.asThinking) {
    return false;
  }
  return message.id !== expandedId;
}

function buildSyntheticUserMessage(content: string, imageCount: number): SessionMessage {
  const now = new Date().toISOString();
  return {
    id: `local-${Math.random().toString(36).slice(2)}`,
    sessionId: "local",
    role: "user",
    content,
    contentParams:
      imageCount > 0
        ? Array.from({ length: imageCount }, () => ({
            type: "image_url",
            image_url: { url: "" },
          }))
        : null,
    messageParams: null,
    compacted: false,
    visible: true,
    createTime: now,
    updateTime: now,
  };
}

export function buildPromptDraftFromSessionMessage(message: SessionMessage, nonce: number): PromptDraft {
  return {
    nonce,
    text: typeof message.content === "string" ? message.content : "",
    imageUrls: extractImageUrlsFromContentParams(message.contentParams),
  };
}

function extractImageUrlsFromContentParams(contentParams: unknown): string[] {
  const params = Array.isArray(contentParams) ? contentParams : contentParams ? [contentParams] : [];
  const imageUrls: string[] = [];
  for (const param of params) {
    if (!param || typeof param !== "object") {
      continue;
    }
    const record = param as { type?: unknown; image_url?: { url?: unknown } };
    const url = record.image_url?.url;
    if (record.type === "image_url" && typeof url === "string" && url) {
      imageUrls.push(url);
    }
  }
  return imageUrls;
}

function isCurrentSessionEmpty(sessionManager: SessionManager): boolean {
  const activeSessionId = sessionManager.getActiveSessionId();
  return !activeSessionId || !sessionManager.getSession(activeSessionId);
}

function buildStatusLine(entry: SessionEntry): string {
  const parts: string[] = [];
  parts.push(`status: ${entry.status}`);
  if (typeof entry.activeTokens === "number" && entry.activeTokens > 0) {
    parts.push(`tokens: ${entry.activeTokens}`);
  }
  if (entry.failReason) {
    parts.push(`fail: ${entry.failReason}`);
  }
  return parts.join(" · ");
}

export function readSettings(): DeepcodingSettings | null {
  return readSettingsFile(getUserSettingsPath());
}

export function readProjectSettings(projectRoot: string = process.cwd()): DeepcodingSettings | null {
  return readSettingsFile(getProjectSettingsPath(projectRoot));
}

function readSettingsFile(settingsPath: string): DeepcodingSettings | null {
  try {
    if (!fs.existsSync(settingsPath)) {
      return null;
    }
    const raw = fs.readFileSync(settingsPath, "utf8");
    return JSON.parse(raw) as DeepcodingSettings;
  } catch {
    return null;
  }
}

export function writeSettings(settings: DeepcodingSettings): void {
  const settingsPath = getUserSettingsPath();
  writeSettingsFile(settingsPath, settings);
}

export function writeProjectSettings(settings: DeepcodingSettings, projectRoot: string = process.cwd()): void {
  const settingsPath = getProjectSettingsPath(projectRoot);
  writeSettingsFile(settingsPath, settings);
}

function writeSettingsFile(settingsPath: string, settings: DeepcodingSettings): void {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

export function writeModelConfigSelection(
  selection: ModelConfigSelection,
  current: ModelConfigSelection = resolveCurrentSettings(),
  projectRoot: string = process.cwd()
): { changed: boolean; settings: DeepcodingSettings } {
  const projectSettingsPath = getProjectSettingsPath(projectRoot);
  const shouldWriteProjectSettings = fs.existsSync(projectSettingsPath);
  const rawSettings = shouldWriteProjectSettings ? readProjectSettings(projectRoot) : readSettings();
  const result = applyModelConfigSelection(rawSettings, current, selection);
  if (result.changed) {
    if (shouldWriteProjectSettings) {
      writeProjectSettings(result.settings, projectRoot);
    } else {
      writeSettings(result.settings);
    }
  }
  return result;
}

export function resolveCurrentSettings(projectRoot: string = process.cwd()): ResolvedDeepcodingSettings {
  return resolveSettingsSources(
    readSettings(),
    readProjectSettings(projectRoot),
    {
      model: DEFAULT_MODEL,
      baseURL: DEFAULT_BASE_URL,
    },
    process.env
  );
}

export { createOpenAIClient } from "../common/openai-client";

function getUserSettingsPath(): string {
  return path.join(os.homedir(), ".deepcode", "settings.json");
}

function getProjectSettingsPath(projectRoot: string): string {
  return path.join(projectRoot, ".deepcode", "settings.json");
}

function formatThinkingMode(settings: Pick<ModelConfigSelection, "thinkingEnabled" | "reasoningEffort">): string {
  if (!settings.thinkingEnabled) {
    return "no thinking";
  }
  return `thinking ${settings.reasoningEffort}`;
}

function formatModelConfig(settings: ModelConfigSelection): string {
  return `${settings.model}, ${formatThinkingMode(settings)}`;
}
