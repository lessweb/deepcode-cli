import { randomUUID } from "node:crypto";
import type { SessionMessage, UserPromptContent } from "./session";

export type PromptContent = Pick<UserPromptContent, "text" | "imageUrls" | "skills" | "planMode">;
export type QueuedMessage = {
  id: string;
  sessionId: string;
  submittedAt: string;
  content: PromptContent;
};
export type QueuePausedReason = "interrupted" | "failed" | "awaiting_user" | "session_inactive";

function cloneContent({ text, imageUrls, skills, planMode }: PromptContent): PromptContent {
  return structuredClone({ text, imageUrls, skills, planMode });
}

/** One session's inputs. An edit blocks that message and its FIFO suffix. */
export class PromptQueue {
  private messages: QueuedMessage[] = [];
  private readonly edits = new Set<string>();

  constructor(
    private readonly sessionId: string,
    private readonly changed: () => void = () => {}
  ) {}

  enqueue(content: PromptContent): QueuedMessage {
    const message = {
      id: randomUUID(),
      sessionId: this.sessionId,
      submittedAt: new Date().toISOString(),
      content: cloneContent(content),
    };
    this.messages.push(message);
    this.changed();
    return structuredClone(message);
  }

  list(): QueuedMessage[] {
    return structuredClone(this.messages);
  }

  executable(): QueuedMessage[] {
    const barrier = this.messages.findIndex((message) => this.edits.has(message.id));
    return this.messages.slice(0, barrier < 0 ? undefined : barrier);
  }

  /** Identity also detects edits made during asynchronous prompt preparation. */
  canCommit(message: QueuedMessage): boolean {
    return this.messages[0] === message && !this.edits.has(message.id);
  }

  remove(id: string): boolean {
    const index = this.messages.findIndex((message) => message.id === id);
    if (index < 0) return false;
    this.messages.splice(index, 1);
    this.edits.delete(id);
    this.changed();
    return true;
  }

  beginEdit(id: string): QueuedMessage | undefined {
    const message = this.messages.find((message) => message.id === id);
    if (!message || this.edits.has(id)) return undefined;
    this.edits.add(id);
    this.changed();
    return structuredClone(message);
  }

  finishEdit(id: string, content?: PromptContent): boolean {
    const index = this.messages.findIndex((message) => message.id === id);
    if (index < 0 || !this.edits.delete(id)) return false;
    if (content) this.messages[index] = { ...this.messages[index], content: cloneContent(content) };
    this.changed();
    return true;
  }

  clear(): void {
    this.messages = [];
    this.edits.clear();
    this.changed();
  }
}

/** The queue and the single owner of a session's asynchronous work share one lifetime. */
export class SessionRuntime {
  readonly queue: PromptQueue;
  readonly deferredMessages: SessionMessage[] = [];
  initialize?: (signal: AbortSignal) => Promise<void>;
  preparingPrompt?: QueuedMessage;
  pausedReason?: Exclude<QueuePausedReason, "session_inactive">;
  controller?: AbortController;
  task?: Promise<void>;

  constructor(
    sessionId: string,
    private readonly changed: () => void
  ) {
    this.queue = new PromptQueue(sessionId, changed);
  }

  run(operation: (controller: AbortController) => Promise<void>, controller = new AbortController()): Promise<void> {
    if (this.task) return this.task;
    this.controller = controller;
    const pause = () => {
      this.pausedReason = "interrupted";
    };
    controller.signal.addEventListener("abort", pause, { once: true });
    if (controller.signal.aborted) pause();
    this.task = Promise.resolve()
      .then(() => operation(controller))
      .finally(() => {
        controller.signal.removeEventListener("abort", pause);
        this.controller = undefined;
        this.task = undefined;
        this.preparingPrompt = undefined;
        this.changed();
      });
    this.changed();
    return this.task;
  }

  async wait(): Promise<void> {
    while (this.task) await this.task;
  }

  interrupt(): void {
    this.pausedReason = "interrupted";
    this.controller?.abort();
  }

  dispose(): void {
    this.interrupt();
    this.initialize = undefined;
    this.deferredMessages.length = 0;
    this.queue.clear();
  }
}
