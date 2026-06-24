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
  if (request.headers["x-deepcode-token"] === token) {
    return true;
  }
  return request.headers.authorization === `Bearer ${token}`;
}
