import type { McpTransport, McpTransportHandlers } from "./mcp-transport";

export type HttpTransportOptions = {
  url: string;
  headers?: Record<string, string>;
};

/**
 * Remote transport implementing the MCP "Streamable HTTP" protocol
 * (spec 2025-03-26). Each outbound JSON-RPC message is delivered with an HTTP
 * POST; the server replies either with a single JSON object or with an SSE
 * stream that may carry the response together with server notifications.
 *
 * The `Mcp-Session-Id` returned on initialize is echoed on every subsequent
 * request. The legacy two-endpoint HTTP+SSE transport (2024-11-05) is not
 * handled here.
 */
export class HttpTransport implements McpTransport {
  private handlers: McpTransportHandlers | null = null;
  private sessionId: string | null = null;
  private closed = false;
  private readonly activeRequests = new Set<AbortController>();

  constructor(
    private readonly serverName: string,
    private readonly options: HttpTransportOptions
  ) {}

  async start(handlers: McpTransportHandlers): Promise<void> {
    this.handlers = handlers;
    this.closed = false;
    this.sessionId = null;
    // Streamable HTTP is connectionless until the first message is sent, so
    // there is nothing to open here.
  }

  send(message: object): void {
    void this.post(message);
  }

  close(): void {
    this.closed = true;
    for (const controller of this.activeRequests) {
      try {
        controller.abort();
      } catch {
        // ignore abort errors
      }
    }
    this.activeRequests.clear();
  }

  isConnected(): boolean {
    return !this.closed;
  }

  decorateError(message: string): Error {
    return new Error(message);
  }

  private async post(message: object): Promise<void> {
    if (this.closed) return;

    const controller = new AbortController();
    this.activeRequests.add(controller);
    try {
      const headers: Record<string, string> = {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(this.options.headers ?? {}),
      };
      if (this.sessionId) {
        headers["mcp-session-id"] = this.sessionId;
      }

      const response = await fetch(this.options.url, {
        method: "POST",
        headers,
        body: JSON.stringify(message),
        signal: controller.signal,
      });

      const sessionId = response.headers.get("mcp-session-id");
      if (sessionId) {
        this.sessionId = sessionId;
      }

      // 202 Accepted (or 204) acknowledges a notification/response with no body.
      if (response.status === 202 || response.status === 204) {
        return;
      }

      if (!response.ok) {
        const body = await safeReadText(response);
        this.reportClose(
          `MCP server "${this.serverName}" returned HTTP ${response.status}${body ? `: ${truncate(body)}` : ""}`
        );
        return;
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("text/event-stream") && response.body) {
        await this.consumeEventStream(response.body);
      } else {
        const text = await safeReadText(response);
        if (text) {
          this.dispatchPayload(text);
        }
      }
    } catch (err) {
      if (this.closed || controller.signal.aborted) {
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      this.reportClose(`MCP server "${this.serverName}" request failed: ${message}`);
    } finally {
      this.activeRequests.delete(controller);
    }
  }

  private async consumeEventStream(body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");

        let boundary: number;
        while ((boundary = buffer.indexOf("\n\n")) !== -1) {
          const rawEvent = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const data = readSseData(rawEvent);
          if (data) {
            this.dispatchPayload(data);
          }
        }

        if (this.closed) break;
      }
    } catch {
      // Stream aborted or errored; close handling happens elsewhere.
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // ignore
      }
    }
  }

  private dispatchPayload(text: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return;
    }
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (item && typeof item === "object") {
          this.handlers?.onMessage(item as object);
        }
      }
      return;
    }
    if (parsed && typeof parsed === "object") {
      this.handlers?.onMessage(parsed as object);
    }
  }

  private reportClose(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    this.handlers?.onClose(reason);
  }
}

function readSseData(rawEvent: string): string {
  const dataLines: string[] = [];
  for (const line of rawEvent.split("\n")) {
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).replace(/^ /, ""));
    }
    // event:, id:, retry: and comment (":") lines are ignored.
  }
  return dataLines.join("\n");
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return (await response.text()).trim();
  } catch {
    return "";
  }
}

function truncate(text: string, max = 500): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
