import { test } from "node:test";
import assert from "node:assert/strict";
import { timeoutFetch } from "../common/openai-client";

function hangingFetch(onSignal?: (signal: AbortSignal) => void) {
  return (_input: unknown, init?: { signal?: AbortSignal }) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) return;
      onSignal?.(signal);
      signal.addEventListener("abort", () => reject(signal.reason));
    });
}

function stalledStreamFetch(firstChunk: string, onSignal?: (signal: AbortSignal) => void) {
  return (_input: unknown, init?: { signal?: AbortSignal }) => {
    const encoder = new TextEncoder();
    const signal = init?.signal;
    onSignal?.(signal!);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(firstChunk));
        signal?.addEventListener("abort", () => controller.error(signal.reason));
      },
    });
    return Promise.resolve(new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }));
  };
}

test("timeoutFetch passes a fast response through unchanged", async () => {
  const fetchImpl = timeoutFetch(async () => new Response('{"ok":true}', { status: 200 }));
  const res = await fetchImpl("https://api.example.com/v1/chat", { method: "POST" });
  assert.equal(res.status, 200);
  assert.equal(await res.text(), '{"ok":true}');
});

test("timeoutFetch keeps the caller's abort working", async () => {
  let observed: AbortSignal | undefined;
  const fetchImpl = timeoutFetch(hangingFetch((signal) => (observed = signal)));
  const caller = new AbortController();
  const pending = fetchImpl("https://api.example.com/v1/chat", { signal: caller.signal });
  caller.abort(new Error("user interrupt"));
  await assert.rejects(pending, /user interrupt/);
  assert.ok(observed?.aborted);
});

test("timeoutFetch aborts when response headers never arrive", async () => {
  const fetchImpl = timeoutFetch(hangingFetch(), { headerTimeoutMs: 20 });
  await assert.rejects(fetchImpl("https://api.example.com/v1/chat", { method: "POST" }), /No response headers/);
});

test("timeoutFetch delivers chunks that keep arriving", async () => {
  const encoder = new TextEncoder();
  const fetchImpl = timeoutFetch(
    async () => {
      let sent = 0;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (sent >= 5) {
            controller.close();
            return;
          }
          sent += 1;
          controller.enqueue(encoder.encode(`chunk-${sent}\n\n`));
        },
      });
      return new Response(body, { status: 200 });
    },
    { chunkTimeoutMs: 200 }
  );
  const res = await fetchImpl("https://api.example.com/v1/chat", { method: "POST" });
  const text = await res.text();
  assert.equal(text.split("\n\n").filter(Boolean).length, 5);
});

test("timeoutFetch aborts a stream that stalls between chunks", async () => {
  const fetchImpl = timeoutFetch(stalledStreamFetch("data: hello\n\n"), { chunkTimeoutMs: 20 });
  const res = await fetchImpl("https://api.example.com/v1/chat", { method: "POST" });
  const reader = res.body!.getReader();
  const first = await reader.read();
  assert.equal(new TextDecoder().decode(first.value), "data: hello\n\n");
  await assert.rejects(reader.read(), /No data received/);
});
