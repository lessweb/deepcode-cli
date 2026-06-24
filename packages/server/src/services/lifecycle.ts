/**
 * Server lifecycle helpers.
 *
 * Summary:
 * Owns graceful HTTP server shutdown behavior and active response cleanup.
 *
 * Exports:
 * - shutdownServer(httpServer: ReturnType<typeof createServer>, activeResponses: Set<ServerResponse>): void
 */
import type { createServer, ServerResponse } from "node:http";

export function shutdownServer(
  httpServer: ReturnType<typeof createServer>,
  activeResponses: Set<ServerResponse>
): void {
  for (const response of activeResponses) {
    if (!response.writableEnded) {
      try {
        response.end();
      } catch {
        // Ignore close failures during shutdown.
      }
    }
  }
  httpServer.close();
}
