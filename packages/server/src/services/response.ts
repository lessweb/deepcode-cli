/**
 * JSON response serialization helpers.
 *
 * Summary:
 * Serializes service payloads to HTTP responses and normalizes failed payloads
 * into stable HTTP status codes.
 *
 * Exports:
 * - sendJson(response: ServerResponse, statusCode: number, payload: JsonValue): void
 * - statusCodeForFailure(payload: { ok: false; error?: unknown }): number
 */
import type { ServerResponse } from "node:http";
import type { JsonValue } from "./types";

export function sendJson(response: ServerResponse, statusCode: number, payload: JsonValue): void {
  if (response.headersSent) {
    return;
  }
  const finalStatusCode = statusCode < 400 && isFailurePayload(payload) ? statusCodeForFailure(payload) : statusCode;
  response.writeHead(finalStatusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(`${JSON.stringify(payload, null, 2)}\n`);
}

export function statusCodeForFailure(payload: Record<string, unknown> & { ok: false; error?: unknown }): number {
  const error = typeof payload.error === "string" ? payload.error.toLowerCase() : "";
  if (error.includes("not found")) {
    return 404;
  }
  if (
    error.includes("required") ||
    error.includes("invalid") ||
    error.includes("unsupported") ||
    error.includes("too large") ||
    error.includes("must") ||
    error.includes("no permission replies")
  ) {
    return 400;
  }
  if (
    error.includes("busy") ||
    error.includes("no active") ||
    error.includes("pending") ||
    error.includes("permission request") ||
    error.includes("permission mismatch") ||
    error.includes("permission denied") ||
    error.includes("conflict") ||
    error.includes("state") ||
    error.includes("adjustable")
  ) {
    return 409;
  }
  return 400;
}

function isFailurePayload(payload: JsonValue): payload is Record<string, unknown> & { ok: false; error?: unknown } {
  return isRecord(payload) && payload.ok === false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
