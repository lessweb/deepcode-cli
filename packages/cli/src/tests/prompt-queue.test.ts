import assert from "node:assert/strict";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import { createPromptQueue } from "../ui/core/prompt-queue";
import type { PromptSubmission } from "../ui/views/PromptInput";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function harness() {
  const started: string[] = [];
  const errors: unknown[] = [];
  const runs = new Map<string, ReturnType<typeof deferred>>();
  let active = 0;
  let maxActive = 0;
  const queue = createPromptQueue<PromptSubmission>(
    async (prompt) => {
      started.push(prompt.text);
      if (prompt.command === "exit") return;
      active++;
      maxActive = Math.max(maxActive, active);
      const run = deferred();
      runs.set(prompt.text, run);
      try {
        await run.promise;
      } finally {
        active--;
      }
    },
    (error) => errors.push(error)
  );
  return {
    queue,
    started,
    errors,
    runs,
    submit: (text: string) => queue.submit({ text, imageUrls: [] }),
    get maxActive() {
      return maxActive;
    },
  };
}

test("prompt queue executes A, B, C in FIFO order with at most one active run", async () => {
  const h = harness();
  h.submit("A");
  h.submit("B");
  h.submit("C");
  assert.deepEqual(h.started, ["A"]);
  assert.equal(h.queue.pending, 2);

  h.runs.get("A")!.resolve();
  await setImmediate();
  assert.deepEqual(h.started, ["A", "B"]);
  assert.equal(h.queue.pending, 1);

  h.runs.get("B")!.resolve();
  await setImmediate();
  assert.deepEqual(h.started, ["A", "B", "C"]);
  assert.equal(h.queue.pending, 0);

  h.runs.get("C")!.resolve();
  await setImmediate();
  assert.equal(h.maxActive, 1);
  assert.deepEqual(h.errors, []);
});

test("submitting B while A is running does not start B concurrently", async () => {
  const h = harness();
  h.submit("A");
  await setImmediate();
  h.submit("B");
  await setImmediate();
  assert.deepEqual(h.started, ["A"]);
  assert.equal(h.queue.pending, 1);

  h.runs.get("A")!.resolve();
  await setImmediate();
  assert.deepEqual(h.started, ["A", "B"]);
  h.runs.get("B")!.resolve();
  await setImmediate();
  assert.equal(h.maxActive, 1);
});

test("interrupt clears B and C so neither executes when A settles", async () => {
  const h = harness();
  h.submit("A");
  h.submit("B");
  h.submit("C");
  h.queue.interrupt();
  assert.equal(h.queue.pending, 0);
  assert.deepEqual(h.started, ["A"]);

  h.runs.get("A")!.resolve();
  await setImmediate();
  assert.deepEqual(h.started, ["A"]);

  h.submit("D");
  assert.deepEqual(h.started, ["A", "D"]);
  h.runs.get("D")!.resolve();
  await setImmediate();
});

test("a new prompt after interrupt waits for the aborting run without an interrupt lock", async () => {
  const h = harness();
  h.submit("A");
  h.submit("B");
  h.submit("C");
  h.queue.interrupt();
  h.submit("D");
  await setImmediate();
  assert.deepEqual(h.started, ["A"]);
  assert.equal(h.queue.pending, 1);

  h.runs.get("A")!.resolve();
  await setImmediate();
  assert.deepEqual(h.started, ["A", "D"]);
  h.runs.get("D")!.resolve();
  await setImmediate();
  assert.equal(h.maxActive, 1);
});

test("/exit bypasses an active run immediately and discards waiting prompts", async () => {
  const h = harness();
  h.submit("A");
  h.submit("B");
  h.submit("C");
  h.queue.submit({ text: "/exit", command: "exit", imageUrls: [] });
  assert.deepEqual(h.started, ["A", "/exit"]);
  assert.equal(h.queue.pending, 0);
  assert.equal(h.maxActive, 1);

  h.runs.get("A")!.resolve();
  await setImmediate();
  assert.deepEqual(h.started, ["A", "/exit"]);
});

test("question answers and permission continuations use the same FIFO as plain prompts", async () => {
  const h = harness();
  h.submit("A");
  h.queue.submit({ text: "answer", imageUrls: [], isAnswers: true });
  h.queue.submit({ text: "/continue", imageUrls: [], command: "continue", permissions: [], alwaysAllows: [] });
  await setImmediate();
  assert.deepEqual(h.started, ["A"]);
  assert.equal(h.queue.pending, 2);

  h.runs.get("A")!.resolve();
  await setImmediate();
  assert.deepEqual(h.started, ["A", "answer"]);
  h.runs.get("answer")!.resolve();
  await setImmediate();
  assert.deepEqual(h.started, ["A", "answer", "/continue"]);
  h.runs.get("/continue")!.resolve();
  await setImmediate();
  assert.equal(h.maxActive, 1);
});

test("a failed run reports its error and preserves queued prompts", async () => {
  const h = harness();
  const error = new Error("run failed");
  h.submit("A");
  h.submit("B");
  h.runs.get("A")!.reject(error);
  await setImmediate();
  assert.deepEqual(h.errors, [error]);
  assert.deepEqual(h.started, ["A", "B"]);
  h.runs.get("B")!.resolve();
  await setImmediate();

  h.submit("C");
  assert.deepEqual(h.started, ["A", "B", "C"]);
  h.runs.get("C")!.resolve();
  await setImmediate();
  assert.equal(h.maxActive, 1);
});

test("pending count excludes the active run, updates on interrupt, and can be unsubscribed", async () => {
  const h = harness();
  const counts: number[] = [];
  const unsubscribe = h.queue.subscribe((count) => counts.push(count));
  assert.equal(counts.at(-1), 0);
  h.submit("A");
  assert.equal(counts.at(-1), 0);
  h.submit("B");
  assert.equal(counts.at(-1), 1);
  h.submit("C");
  assert.equal(counts.at(-1), 2);
  h.queue.interrupt();
  assert.equal(counts.at(-1), 0);

  unsubscribe();
  const before = counts.length;
  h.runs.get("A")!.resolve();
  await setImmediate();
  assert.equal(counts.length, before);
});

test("a synchronous runner error is reported and the queue remains usable", async () => {
  const started: string[] = [];
  const errors: unknown[] = [];
  const error = new Error("synchronous failure");
  const queue = createPromptQueue<{ text: string; command?: string }>(
    (prompt) => {
      started.push(prompt.text);
      if (prompt.text === "A") throw error;
      return Promise.resolve();
    },
    (error) => errors.push(error)
  );
  queue.submit({ text: "A" });
  queue.submit({ text: "B" });
  await setImmediate();
  assert.deepEqual(errors, [error]);
  assert.deepEqual(started, ["A", "B"]);
  assert.equal(queue.pending, 0);
});

test("queued items are FIFO snapshots, exclude the active run, and disappear on interrupt", async () => {
  const h = harness();
  const snapshots: Array<readonly PromptSubmission[]> = [];
  const unsubscribe = h.queue.subscribe(() => snapshots.push(h.queue.items));
  h.submit("A");
  h.submit("B");
  h.submit("C");
  const snapshot = h.queue.items;
  assert.deepEqual(
    snapshot.map((item) => item.text),
    ["B", "C"]
  );
  // Mutating a consumer's copy must not alter the underlying queue.
  (snapshot as PromptSubmission[]).pop();
  assert.deepEqual(
    h.queue.items.map((item) => item.text),
    ["B", "C"]
  );

  h.runs.get("A")!.resolve();
  await setImmediate();
  assert.deepEqual(
    h.queue.items.map((item) => item.text),
    ["C"]
  );
  assert.deepEqual(
    snapshots.at(-1)?.map((item) => item.text),
    ["C"]
  );
  assert.deepEqual(
    snapshots.find((items) => items.length === 2)?.map((item) => item.text),
    ["B", "C"]
  );

  h.queue.interrupt();
  assert.deepEqual(h.queue.items, []);
  assert.deepEqual(snapshots.at(-1), []);
  h.runs.get("B")!.resolve();
  await setImmediate();
  assert.deepEqual(h.started, ["A", "B"]);
  unsubscribe();
});
