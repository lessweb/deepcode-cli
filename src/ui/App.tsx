import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Static, Text, useApp, useStdout } from "ink";
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
  type UserPromptContent
} from "../session";
import { resolveSettings, type DeepcodingSettings } from "../settings";
import { PromptInput, type PromptSubmission } from "./PromptInput";
import { MessageView } from "./MessageView";
import { SessionList } from "./SessionList";
import { buildLoadingText } from "./loadingText";
import { findExpandedThinkingId } from "./thinkingState";
import { AskUserQuestionPrompt } from "./AskUserQuestionPrompt";
import {
  findPendingAskUserQuestion,
  formatAskUserQuestionAnswers,
  type AskUserQuestionAnswers
} from "./askUserQuestion";

const DEFAULT_MODEL = "deepseek-v4-pro";
const DEFAULT_BASE_URL = "https://api.deepseek.com";

type View = "chat" | "session-list";

type AppProps = {
  projectRoot: string;
};

export function App({ projectRoot }: AppProps): React.ReactElement {
  const { exit } = useApp();
  const { stdout, write } = useStdout();
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
  const [, setNowTick] = useState(0);

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
      }
    });
  }, [projectRoot]);

  useEffect(() => {
    if (!busy) {
      return;
    }
    const id = setInterval(() => setNowTick((tick) => tick + 1), 500);
    return () => clearInterval(id);
  }, [busy]);

  useEffect(() => {
    void refreshSkills();
    refreshSessionsList();
    const list = sessionManager.listSessions();
    if (list.length > 0) {
      const latest = list[0];
      sessionManager.setActiveSessionId(latest.id);
      setMessages(loadVisibleMessages(sessionManager, latest.id));
      setStatusLine(buildStatusLine(latest));
      setRunningProcesses(latest.processes);
      setActiveStatus(latest.status);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function loadVisibleMessages(manager: SessionManager, sessionId: string): SessionMessage[] {
    return manager.listSessionMessages(sessionId).filter((m) => m.visible);
  }

  function refreshSessionsList(): void {
    setSessions(sessionManager.listSessions());
  }

  async function refreshSkills(sessionId?: string): Promise<void> {
    try {
      const list = await sessionManager.listSkills(sessionId ?? sessionManager.getActiveSessionId() ?? undefined);
      setSkills(list);
    } catch {
      // ignore
    }
  }

  const handlePrompt = useCallback(
    async (submission: PromptSubmission) => {
      if (submission.command === "exit") {
        exit();
        process.exit(0);
        return;
      }
      if (submission.command === "new") {
        write("\u001B[2J\u001B[3J\u001B[H");
        sessionManager.setActiveSessionId(null);
        setMessages([]);
        setStatusLine("");
        setErrorLine(null);
        setRunningProcesses(null);
        setActiveStatus(null);
        setDismissedQuestionIds(new Set());
        await refreshSkills();
        refreshSessionsList();
        return;
      }
      if (submission.command === "resume") {
        refreshSessionsList();
        setView("session-list");
        return;
      }

      const prompt: UserPromptContent = {
        text: submission.text,
        imageUrls: submission.imageUrls,
        skills: submission.selectedSkill ? [submission.selectedSkill] : undefined
      };

      const trimmedText = (submission.text ?? "").trim();
      const userDisplayContent = trimmedText
        || (submission.selectedSkill ? `Use skill: ${submission.selectedSkill.name}` : "")
        || (submission.imageUrls.length > 0 ? "[Image]" : "");

      if (userDisplayContent) {
        setMessages((prev) => [
          ...prev,
          buildSyntheticUserMessage(userDisplayContent, submission.imageUrls.length)
        ]);
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
    [exit, sessionManager, write]
  );

  const handleInterrupt = useCallback(() => {
    sessionManager.interruptActiveSession();
  }, [sessionManager]);

  const handleSelectSession = useCallback(
    async (sessionId: string) => {
      sessionManager.setActiveSessionId(sessionId);
      setMessages(loadVisibleMessages(sessionManager, sessionId));
      const session = sessionManager.getSession(sessionId);
      setStatusLine(session ? buildStatusLine(session) : "");
      setRunningProcesses(session?.processes ?? null);
      setActiveStatus(session?.status ?? null);
      setView("chat");
      await refreshSkills(sessionId);
    },
    [sessionManager]
  );

  const screenWidth = stdout?.columns ?? 80;
  const promptHistory = useMemo(() => {
    return messages
      .filter((message) => message.role === "user" && typeof message.content === "string")
      .map((message) => (message.content ?? "").trim())
      .filter((content) => content.length > 0);
  }, [messages]);
  const expandedThinkingId = findExpandedThinkingId(messages);
  const pendingQuestion = useMemo(
    () => findPendingAskUserQuestion(messages, activeStatus),
    [activeStatus, messages]
  );
  const shouldShowQuestionPrompt = Boolean(
    pendingQuestion && !dismissedQuestionIds.has(pendingQuestion.messageId)
  );
  const loadingText = busy
    ? buildLoadingText({ progress: streamProgress, processes: runningProcesses, now: Date.now() })
    : null;

  const handleQuestionAnswers = useCallback(
    (answers: AskUserQuestionAnswers) => {
      void handlePrompt({
        text: formatAskUserQuestionAnswers(answers),
        imageUrls: []
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
    <Box flexDirection="column" width={screenWidth}>
      <Static items={messages}>
        {(message) => (
          <MessageView
            key={message.id}
            message={message}
            collapsed={isCollapsedThinking(message, expandedThinkingId)}
          />
        )}
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
      ) : (
        <PromptInput
          skills={skills}
          promptHistory={promptHistory}
          busy={busy}
          loadingText={loadingText}
          onSubmit={(submission) => void handlePrompt(submission)}
          onInterrupt={handleInterrupt}
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
            image_url: { url: "" }
          }))
        : null,
    messageParams: null,
    compacted: false,
    visible: true,
    createTime: now,
    updateTime: now
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
    const settingsPath = path.join(os.homedir(), ".deepcode", "settings.json");
    if (!fs.existsSync(settingsPath)) {
      return null;
    }
    const raw = fs.readFileSync(settingsPath, "utf8");
    return JSON.parse(raw) as DeepcodingSettings;
  } catch {
    return null;
  }
}

export function resolveCurrentSettings(): ReturnType<typeof resolveSettings> {
  return resolveSettings(readSettings(), {
    model: DEFAULT_MODEL,
    baseURL: DEFAULT_BASE_URL
  });
}

export function createOpenAIClient(): {
  client: OpenAI | null;
  model: string;
  baseURL: string;
  thinkingEnabled: boolean;
  reasoningEffort: "high" | "max";
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
      notify: settings.notify,
      webSearchTool: settings.webSearchTool,
      machineId: getMachineId()
    };
  }

  const client = new OpenAI({
    apiKey: settings.apiKey,
    baseURL: settings.baseURL || undefined
  });
  return {
    client,
    model: settings.model,
    baseURL: settings.baseURL,
    thinkingEnabled: settings.thinkingEnabled,
    reasoningEffort: settings.reasoningEffort,
    notify: settings.notify,
    webSearchTool: settings.webSearchTool,
    machineId: getMachineId()
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
