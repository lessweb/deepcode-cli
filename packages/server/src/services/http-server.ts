/**
 * HTTP/SSE server service entry.
 *
 * Summary:
 * Starts the standalone local HTTP/SSE runtime host and wires request handling to
 * the split service modules.
 *
 * Exports:
 * - runHeadlessHttp(options: HeadlessOptions): Promise<void>
 * - type HeadlessOptions
 */
import crypto from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { isAuthorized } from "./auth";
import { shutdownServer } from "./lifecycle";
import { sendJson } from "./response";
import { routeRequest } from "./routes";
import { parseServerOptions } from "./server-options";
import { openSseStream } from "./sse";
import { ServerRuntimeService } from "./runtime";

export type HeadlessOptions = {
  args: string[];
  projectRoot: string;
  version: string;
};

export async function runHeadlessHttp(options: HeadlessOptions): Promise<void> {
  const { host, port, authDisabled } = parseServerOptions(options.args);
  if (authDisabled) {
    process.stderr.write("Warning: deepcode server auth is disabled. Use only in a trusted local dev environment.\n");
  }

  const accessToken = authDisabled ? null : crypto.randomUUID();
  const runtime = new ServerRuntimeService(options.projectRoot);
  await runtime.init();

  const activeResponses = new Set<ServerResponse>();
  const httpServer = createServer(async (request, response) => {
    activeResponses.add(response);
    response.on("close", () => activeResponses.delete(response));
    try {
      setBaseHeaders(request, response);
      if (request.method === "OPTIONS") {
        response.writeHead(204);
        response.end();
        return;
      }
      if (accessToken && !isAuthorized(request, accessToken)) {
        sendJson(response, 401, { ok: false, error: "Unauthorized" });
        return;
      }
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const pathname = url.pathname.replace(/\/+$/u, "") || "/";
      if (request.method === "GET" && pathname === "/events") {
        openSseStream(request, response, runtime);
        return;
      }
      await routeRequest({
        request,
        response,
        runtime,
        version: options.version,
        projectRoot: options.projectRoot,
        shutdown: () => shutdown(),
      });
    } catch (error) {
      sendJson(response, statusCodeFromError(error), {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  let shuttingDown = false;
  const shutdown = (): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    runtime.notifyShutdown();
    shutdownServer(httpServer, activeResponses);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  await new Promise<void>((resolve) => {
    httpServer.listen(port, host, resolve);
  });

  const authHint = accessToken ? ` token=${accessToken}` : " auth=disabled";
  process.stdout.write(`deepcode server listening on http://${host}:${port}${authHint}\n`);

  await new Promise<void>((resolve) => {
    httpServer.on("close", resolve);
  });
  runtime.dispose();
}

function setBaseHeaders(request: IncomingMessage, response: ServerResponse): void {
  const origin = request.headers.origin;
  response.setHeader("Access-Control-Allow-Origin", isAllowedLocalOrigin(origin) ? origin : "http://127.0.0.1");
  response.setHeader("Vary", "Origin");
  response.setHeader("Access-Control-Allow-Headers", "content-type, x-deepcode-token, authorization");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}

function isAllowedLocalOrigin(origin: unknown): origin is string {
  if (typeof origin !== "string") {
    return false;
  }
  try {
    const url = new URL(origin);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      (url.hostname === "127.0.0.1" || url.hostname === "localhost")
    );
  } catch {
    return false;
  }
}

function statusCodeFromError(error: unknown): number {
  if (isRecord(error) && typeof error.statusCode === "number" && Number.isInteger(error.statusCode)) {
    return error.statusCode;
  }
  return 500;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
