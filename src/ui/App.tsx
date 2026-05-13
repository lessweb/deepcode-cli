import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Static, Text, useApp, useStdout, useWindowSize } from "ink";
import chalk from "chalk";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import OpenAI from "openai";
import {
  SessionManager,
  type LlmStreamProgress,
  type SessionEntry,
  type SessionMessage,
  type SessionStatus,
  type SkillInfo,
  type UserPromptContent,
} from "../session";
import {
  applyModelConfigSelection,
  resolveSettings,
  type DeepcodingSettings,
  type ModelConfigSelection,
} from "../settings";
import { PromptInput, type PromptSubmission } from "./PromptInput";
import { MessageView } from "./MessageView";
import { SessionList } from "./SessionList";
import { buildLoadingText } from "./loadingText";
import { findExpandedThinkingId } from "./thinkingState";
import { WelcomeScreen } from "./WelcomeScreen";
import { AskUserQuestionPrompt } from "./AskUserQuestionPrompt";
import {
  findPendingAskUserQuestion,
  formatAskUserQuestionAnswers,
  type AskUserQuestionAnswers,
} from "./askUserQuestion";
import { buildExitSummaryText } from "./exitSummary";

const DEFAULT_MODEL = "deepseek-v4-pro";
const DEFAULT_BASE_URL = "https://api.deepseek.com";

type View = "chat" | "session-list";

type AppProps = {
  projectRoot: string;
  version?: string;
  onRestart?: () => void;
};

export function App({ projectRoot, version = "", onRestart }: AppProps): React.ReactElement {
  const { exit } = useApp();
  const { stdout, write } = useStdout();
  const { columns } = useWindowSize();
  const [view, setView] = useState<View>("chat");
  const [busy, setBusy] = useState(false);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [messages, setMessages] = useState<SessionMessage[]>([]);
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [statusLine, setStatusLine] = useState<string>("");
  const [errorLine, setErrorLine] = useState<string | null>(null);
  const [streamProgress, setStreamProgress] = useState<LlmStreamProgress | null>(null);
  const [runningProcesses, setRunningProcesses] = useState<SessionEntry["processes"]>(null);
  const [activeStatus, setActiveStatus] = useState<SessionStatus | null>(null);
  const [dismissedQuestionIds, setDismissedQuestionIds] = useState<Set<string>>(() => new Set());
  const [isExiting, setIsExiting] = useState(false);
  const [showWelcome, setShowWelcome] = useState(true);
  const [welcomeNonce, setWelcomeNonce] = useState(0);
  const [resolvedSettings, setResolvedSettings] = useState(() => resolveCurrentSettings());
  const [nowTick, setNowTick] = useState(0);

  const messagesRef = useRef<SessionMessage[]>([]);
  messagesRef.current = messages;

  const sessionManager = useMemo(() => {
    return new SessionManager({
      projectRoot,
      createOpenAIClient: () => createOpenAIClient(),
      getResolvedSettings: () => resolveCurrentSettings(),
      renderMarkdown: (text) => text,
      onAssistantMessage: (message: SessionMessage) => {
        setMessages((prev) => [...prev, message]);
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

  useEffect(() => {
    const settings = resolveCurrentSettings();
    void sessionManager.initMcpServers(settings.mcpServers);
  }, [sessionManager]);

  useEffect(() => {
    return () => {
      sessionManager.dispose();
    };
  }, [sessionManager]);

  const writeRef = useRef(write);
  writeRef.current = write;
  const handlePrompt = useCallback(
    async (submission: PromptSubmission) => {
      if (submission.command === "exit") {
        setIsExiting(true);
        setTimeout(() => {
          const activeSessionId = sessionManager.getActiveSessionId();
          const session = activeSessionId ? sessionManager.getSession(activeSessionId) : null;
          const allMessages = activeSessionId
            ? sessionManager.listSessionMessages(activeSessionId)
            : messagesRef.current;
          const resolved = resolveCurrentSettings();
          const summary = buildExitSummaryText({ session, messages: allMessages, model: resolved.model });
          process.stdout.write("\n");
          process.stdout.write(chalk.green("> /exit "));
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
      if (submission.command === "mcp") {
        process.stdout.write("\n");
        process.stdout.write(chalk.bold.cyan("MCP Server Status\n"));
        process.stdout.write(chalk.dim("─────────────────\n"));
        const statuses = sessionManager.getMcpStatus();
        if (statuses.length === 0) {
          process.stdout.write(chalk.dim("  No MCP servers configured.\n"));
        } else {
          for (const s of statuses) {
            const icon = s.connected ? chalk.green("✔") : chalk.red("✖");
            process.stdout.write(`  ${icon} ${chalk.bold(s.name)}`);
            if (s.connected) {
              process.stdout.write(chalk.dim(`  (${s.toolCount} tools)`));
            } else {
              process.stdout.write(chalk.dim(`  — ${s.error ?? "failed"}`));
            }
            process.stdout.write("\n");
            if (s.connected && s.tools.length > 0) {
              for (const tool of s.tools) {
                process.stdout.write(chalk.dim(`    - mcp__${s.name}__${tool}\n`));
              }
            }
          }
        }
        process.stdout.write(chalk.dim("─────────────────\n"));
        process.stdout.write(
          chalk.dim(`  Total: ${statuses.filter((s) => s.connected).length} connected, `) +
            chalk.dim(`${statuses.filter((s) => !s.connected).length} failed\n`)
        );
        process.stdout.write("\n");
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

      if (userDisplayContent) {
        setMessages((prev) => [...prev, buildSyntheticUserMessage(userDisplayContent, submission.imageUrls.length)]);
      }

      setBusy(true);
      setErrorLine(null);
      setRunningProcesses(null);
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

  const handleModelConfigChange = useCallback((selection: ModelConfigSelection): string => {
    const current = resolveCurrentSettings();
    const { changed } = writeModelConfigSelection(selection, current);
    const next = resolveCurrentSettings();
    setResolvedSettings(next);
    if (!changed) {
      return "Model settings unchanged";
    }
    return `Model settings updated: ${formatModelConfig(current)} → ${formatModelConfig(next)}`;
  }, []);

  const handleSubmit = useCallback(
    (submission: PromptSubmission) => {
      void handlePrompt(submission);
    },
    [handlePrompt]
  );

  const handleSelectSession = useCallback(
    async (sessionId: string) => {
      const currentSessionId = sessionManager.getActiveSessionId();
      if (currentSessionId !== sessionId) {
        process.stdout.write("\u001B[2J\u001B[3J\u001B[H");
      }
      sessionManager.setActiveSessionId(sessionId);
      // 先清空让 <Static> 的 index 重置为 0
      setMessages([]);
      setShowWelcome(false);
      setWelcomeNonce((n) => n + 1);
      setView("chat");
      // 再加载新消息，此时 index 已为 0，会渲染全部 items
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

  const [stableColumns, setStableColumns] = useState(columns);
  useEffect(() => {
    const timer = setTimeout(() => setStableColumns(columns), 100);
    return () => clearTimeout(timer);
  }, [columns]);
  const lastRenderedColumnsRef = useRef<number | null>(null);
  useEffect(() => {
    if (!stdout?.isTTY) {
      return;
    }
    if (stableColumns <= 0) {
      return;
    }
    if (lastRenderedColumnsRef.current === null) {
      lastRenderedColumnsRef.current = stableColumns;
      return;
    }
    if (lastRenderedColumnsRef.current === stableColumns) {
      return;
    }
    lastRenderedColumnsRef.current = stableColumns;

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
  }, [busy, sessionManager, stableColumns, stdout]);
  const screenWidth = useMemo(() => stableColumns ?? stdout?.columns ?? 80, [stableColumns, stdout]);
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
  const welcomeSettings = resolvedSettings;
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
    if (showWelcome && view === "chat") {
      return [welcomeItem, ...messages];
    }
    return messages;
  }, [showWelcome, view, messages, welcomeItem]);

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

  return (
    <Box flexDirection="column" width={screenWidth} minWidth={80} overflowX={"visible"}>
      <Static items={staticItems}>
        {(item) => {
          if (item.id.startsWith("__welcome__")) {
            return (
              <WelcomeScreen
                key={item.id}
                projectRoot={projectRoot}
                settings={welcomeSettings}
                skills={skills}
                version={version}
                width={screenWidth}
              />
            );
          }
          return <MessageView key={item.id} message={item} collapsed={isCollapsedThinking(item, expandedThinkingId)} />;
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
      {view === "session-list" ? (
        <SessionList
          sessions={sessions}
          onSelect={(id) => void handleSelectSession(id)}
          onCancel={() => setView("chat")}
        />
      ) : shouldShowQuestionPrompt && pendingQuestion && !busy ? (
        <AskUserQuestionPrompt
          questions={pendingQuestion.questions}
          onSubmit={handleQuestionAnswers}
          onCancel={handleQuestionCancel}
        />
      ) : isExiting ? null : (
        <PromptInput
          screenWidth={screenWidth}
          skills={skills}
          modelConfig={resolvedSettings}
          promptHistory={promptHistory}
          busy={busy}
          loadingText={loadingText}
          onSubmit={handleSubmit}
          onModelConfigChange={handleModelConfigChange}
          onInterrupt={handleInterrupt}
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
  try {
    const settingsPath = getSettingsPath();
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
  const settingsPath = getSettingsPath();
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

export function writeModelConfigSelection(
  selection: ModelConfigSelection,
  current: ModelConfigSelection = resolveCurrentSettings()
): { changed: boolean; settings: DeepcodingSettings } {
  const rawSettings = readSettings();
  const result = applyModelConfigSelection(rawSettings, current, selection);
  if (result.changed) {
    writeSettings(result.settings);
  }
  return result;
}

export function resolveCurrentSettings(): ReturnType<typeof resolveSettings> {
  return resolveSettings(readSettings(), {
    model: DEFAULT_MODEL,
    baseURL: DEFAULT_BASE_URL,
  });
}

export function createOpenAIClient(): {
  client: OpenAI | null;
  model: string;
  baseURL: string;
  thinkingEnabled: boolean;
  reasoningEffort: "high" | "max";
  debugLogEnabled: boolean;
  notify?: string;
  webSearchTool?: string;
  machineId?: string;
} {
  const settings = resolveCurrentSettings();
  if (!settings.apiKey) {
    return {
      client: null,
      model: settings.model,
      baseURL: settings.baseURL,
      thinkingEnabled: settings.thinkingEnabled,
      reasoningEffort: settings.reasoningEffort,
      debugLogEnabled: settings.debugLogEnabled,
      notify: settings.notify,
      webSearchTool: settings.webSearchTool,
      machineId: getMachineId(),
    };
  }

  const client = new OpenAI({
    apiKey: settings.apiKey,
    baseURL: settings.baseURL || undefined,
  });
  return {
    client,
    model: settings.model,
    baseURL: settings.baseURL,
    thinkingEnabled: settings.thinkingEnabled,
    reasoningEffort: settings.reasoningEffort,
    debugLogEnabled: settings.debugLogEnabled,
    notify: settings.notify,
    webSearchTool: settings.webSearchTool,
    machineId: getMachineId(),
  };
}

function getMachineId(): string | undefined {
  try {
    const idPath = path.join(os.homedir(), ".deepcode", "machine-id");
    if (fs.existsSync(idPath)) {
      const raw = fs.readFileSync(idPath, "utf8").trim();
      if (raw) {
        return raw;
      }
    }
    const generated = `${os.hostname()}-${Math.random().toString(36).slice(2)}-${Date.now()}`;
    fs.mkdirSync(path.dirname(idPath), { recursive: true });
    fs.writeFileSync(idPath, generated, "utf8");
    return generated;
  } catch {
    return undefined;
  }
}

function getSettingsPath(): string {
  return path.join(os.homedir(), ".deepcode", "settings.json");
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
