/**
 * Request authorization helpers.
 *
 * Summary:
 * Contains token matching logic for local HTTP requests. This is separated from
 * route execution so auth policy can be audited independently.
 *
 * Exports:
 * - isAuthorized(request: IncomingMessage, token: string): boolean
 */
import type { IncomingMessage } from "node:http";

export function isAuthorized(request: IncomingMessage, token: string): boolean {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (url.searchParams.get("token") === token) {
    return true;
  }

  const tokenHeader = firstHeaderValue(request.headers["x-deepcode-token"]);
  if (tokenHeader === token) {
    return true;
  }

  const authorization = firstHeaderValue(request.headers.authorization);
  if (!authorization) {
    return false;
  }

  const [scheme, ...rest] = authorization.trim().split(/\s+/u);
  return scheme.toLowerCase() === "bearer" && rest.join(" ") === token;
}

function firstHeaderValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}
