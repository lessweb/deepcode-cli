/**
 * Server-sent events stream helpers.
 *
 * Summary:
 * Opens and writes SSE streams for frontend event subscriptions. Runtime event
 * production is represented by the shared ServerRuntime contract.
 *
 * Exports:
 * - openSseStream(request: IncomingMessage, response: ServerResponse, runtime: ServerRuntime): void
 * - writeSseEvent(response: ServerResponse, eventName: string, data: JsonValue): void
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ServerRuntime } from "./runtime-contract";
import type { JsonValue } from "./types";

export function openSseStream(request: IncomingMessage, response: ServerResponse, runtime: ServerRuntime): void {
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  writeSseEvent(response, "connected", { type: "connected" });
  const unsubscribe = runtime.subscribe((event) => writeSseEvent(response, event.type, event));
  const timer = setInterval(() => response.write(": keep-alive\n\n"), 15000);
  request.on("close", () => {
    clearInterval(timer);
    unsubscribe();
  });
}

export function writeSseEvent(response: ServerResponse, eventName: string, data: JsonValue): void {
  response.write(`event: ${eventName}\n`);
  response.write(`data: ${JSON.stringify(data)}\n\n`);
}
