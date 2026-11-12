import type { LlmStreamProgress, SessionEntry, SessionMessage, SessionMessageTarget } from "@vegamo/deepcode-core";
import { collectPromptImageUrls } from "./utils.js";

export interface TrajectoryRecord {
  id: string;
  source: SessionMessageTarget;
  editable: boolean;
  turnId: string;
  kind: "user" | "assistant" | "tool" | "system" | "context" | "compacted";
  label: string;
  time: string;
  content: string;
  thinking: string;
  parameters?: string;
  result?: string;
  status?: string;
  compacted: boolean;
  images: string[];
  raw: string;
}

export interface TrajectorySnapshot {
  sessionId: string | null;
  title: string;
  status: string | null;
  usage: SessionEntry["usage"];
  records: TrajectoryRecord[];
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function json(value: unknown): string {
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  return value == null ? "" : JSON.stringify(value, null, 2);
}

function resultStatus(content: string): string {
  try {
    const result = object(JSON.parse(content));
    if (result.ok === false) return "Failed";
    if (result.awaitUserResponse === true) return "Waiting for response";
  } catch {
    // Older tools may store plain text rather than a structured result.
  }
  return "Completed";
}

/** Project durable messages without applying the chat view's visibility filter. */
export function buildTrajectory(session: SessionEntry | null, messages: SessionMessage[]): TrajectorySnapshot {
  const records: TrajectoryRecord[] = [];
  const calls = new Map<string, TrajectoryRecord>();
  let turnId = "context";
  for (const message of messages) {
    const params = object(message.messageParams);
    const meta = message.meta;
    const context = meta?.isSummary || meta?.isToolFollowUp || meta?.skill || meta?.skillCatalog || meta?.isModelChange;
    if (message.role === "user" && !context && !meta?.isAnswers && message.visible !== false) turnId = message.id;
    const kind = meta?.isSummary
      ? "compacted"
      : message.role === "user" && (context || message.visible === false)
        ? "context"
        : message.role;
    const images = collectPromptImageUrls(message);
    const record: TrajectoryRecord = {
      id: message.id,
      source: { messageId: message.id },
      editable: message.role !== "user",
      turnId,
      kind,
      label: kind === "compacted" ? "Context compacted" : kind[0].toUpperCase() + kind.slice(1),
      time: message.createTime || "",
      content: message.content ?? "",
      thinking: string(params.reasoning_content),
      compacted: Boolean(message.compacted),
      images,
      raw: json({ ...message, html: undefined, checkpointHash: undefined }),
    };
    if (message.role === "tool") {
      const call = calls.get(string(params.tool_call_id));
      if (call) {
        call.result = record.content;
        call.status = resultStatus(record.content);
        call.compacted ||= record.compacted;
        call.raw = json({ call: JSON.parse(call.raw), result: JSON.parse(record.raw) });
        calls.delete(string(params.tool_call_id));
        continue;
      }
      const fn = object(meta?.function);
      record.label = string(fn.name) || "Tool";
      record.parameters = json(fn.arguments);
      record.result = record.content;
      record.content = "";
      record.status = resultStatus(record.result);
    }
    records.push(record);
    if (message.role !== "assistant" || !Array.isArray(params.tool_calls)) continue;
    for (const [index, value] of params.tool_calls.entries()) {
      const call = object(value);
      const fn = object(call.function);
      const callId = string(call.id);
      const tool: TrajectoryRecord = {
        id: `${message.id}:tool:${callId || index}`,
        source: { messageId: message.id, toolCallIndex: index },
        editable: true,
        turnId,
        kind: "tool",
        label: string(fn.name) || "Tool",
        time: message.createTime || "",
        content: "",
        thinking: "",
        parameters: json(fn.arguments),
        status: "No result",
        compacted: Boolean(message.compacted),
        images: [],
        raw: json(value),
      };
      records.push(tool);
      if (callId) calls.set(callId, tool);
    }
  }
  return {
    sessionId: session?.id ?? null,
    title: session?.summary || "Trajectory",
    status: session?.status ?? null,
    usage: session?.usage ?? null,
    records,
  };
}

export interface TrajectoryPanel {
  visible: boolean;
  reveal(): void;
  dispose(): void;
  onDidDispose(listener: () => void): unknown;
  onDidChangeViewState(listener: () => void): unknown;
  webview: {
    onDidReceiveMessage(listener: (message: unknown) => void): unknown;
  };
}

interface TrajectoryControllerDeps {
  createPanel: () => TrajectoryPanel;
  readSnapshot: () => TrajectorySnapshot;
  activeSessionId: () => string | null;
  send: (panel: TrajectoryPanel, snapshot: TrajectorySnapshot, progress: LlmStreamProgress | null) => void;
}

/** Owns one panel and coalesces updates independently of the chat Webview. */
export class TrajectoryController {
  private panel?: TrajectoryPanel;
  private ready = false;
  private dirty = true;
  private snapshot?: TrajectorySnapshot;
  private timer?: ReturnType<typeof setTimeout>;
  private progress = new Map<string, LlmStreamProgress>();

  constructor(private readonly deps: TrajectoryControllerDeps) {}

  open(): void {
    if (this.panel) {
      this.panel.reveal();
      this.invalidate();
      return;
    }
    const panel = this.deps.createPanel();
    this.panel = panel;
    this.ready = false;
    this.dirty = true;
    panel.onDidDispose(() => {
      if (this.panel !== panel) return;
      this.panel = undefined;
      this.ready = false;
      this.snapshot = undefined;
      clearTimeout(this.timer);
      this.timer = undefined;
    });
    panel.onDidChangeViewState(() => {
      if (this.panel === panel && panel.visible) this.invalidate();
    });
    panel.webview.onDidReceiveMessage((message) => {
      if (this.panel !== panel || object(message).type !== "trajectoryReady") return;
      this.ready = true;
      this.invalidate();
    });
  }

  invalidate(): void {
    this.dirty = true;
    this.schedule();
  }

  stream(progress: LlmStreamProgress): void {
    const id = progress.sessionId ?? this.deps.activeSessionId();
    if (!id) return;
    if (progress.phase === "end") {
      if (this.progress.get(id)?.requestId === progress.requestId) this.progress.delete(id);
    } else {
      this.progress.set(id, progress);
    }
    this.schedule();
  }

  private schedule(): void {
    if (!this.panel?.visible || !this.ready || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (!this.panel?.visible || !this.ready) return;
      if (this.dirty || this.snapshot?.sessionId !== this.deps.activeSessionId()) {
        this.snapshot = this.deps.readSnapshot();
        this.dirty = false;
      }
      if (this.snapshot) {
        this.deps.send(this.panel, this.snapshot, this.progress.get(this.snapshot.sessionId ?? "") ?? null);
      }
    }, 100);
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.panel?.dispose();
    this.panel = undefined;
    this.progress.clear();
  }
}
