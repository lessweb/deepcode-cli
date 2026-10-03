export type PromptQueueItem = {
  command?: string;
};

export type PromptQueue<T extends PromptQueueItem> = {
  /**
   * Start the prompt immediately when idle, otherwise append it to the FIFO.
   * `command: "exit"` drops waiting prompts and runs immediately regardless.
   */
  submit(prompt: T): void;
  /**
   * Drop every prompt that has not started yet. Does not abort the active run,
   * and deliberately does not lock the queue: prompts submitted while the active
   * run is still settling are queued behind it and execute once it finishes.
   */
  interrupt(): void;
  /** Number of prompts waiting; excludes the active run. */
  readonly pending: number;
  /** Snapshot of waiting prompts in FIFO order; excludes the active run. */
  readonly items: readonly T[];
  /** Subscribe to pending-count changes. Returns an unsubscribe function. */
  subscribe(listener: (pending: number) => void): () => void;
};

/**
 * A minimal single-flight FIFO queue for prompt submissions.
 * Normal submissions never invoke `run` concurrently. The first starts
 * immediately; later submissions execute in arrival order. Only `/exit`
 * bypasses serialization, and its handler must exit without starting a prompt.
 */
export function createPromptQueue<T extends PromptQueueItem>(
  run: (prompt: T) => Promise<void>,
  onError: (error: unknown) => void
): PromptQueue<T> {
  let queue: T[] = [];
  let running = false;
  const listeners = new Set<(pending: number) => void>();

  function notify(): void {
    const pending = queue.length;
    for (const listener of listeners) {
      listener(pending);
    }
  }

  async function execute(prompt: T): Promise<void> {
    try {
      await run(prompt);
    } catch (error) {
      onError(error);
    }
  }

  async function drain(): Promise<void> {
    try {
      while (queue.length > 0) {
        const next = queue.shift()!;
        notify();
        await execute(next);
      }
    } finally {
      running = false;
      notify();
    }
  }

  return {
    submit(prompt: T): void {
      // `/exit` stays immediate even while another run is active.
      if (prompt.command === "exit") {
        queue = [];
        notify();
        void execute(prompt);
        return;
      }
      queue.push(prompt);
      if (running) {
        notify();
        return;
      }
      running = true;
      void drain();
    },
    interrupt(): void {
      queue = [];
      notify();
    },
    get pending(): number {
      return queue.length;
    },
    get items(): readonly T[] {
      return queue.slice();
    },
    subscribe(listener: (pending: number) => void): () => void {
      listeners.add(listener);
      listener(queue.length);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
