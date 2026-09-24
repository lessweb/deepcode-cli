/**
 * Newline-delimited JSON output for `--exec` mode.
 *
 * The event shape deliberately mirrors Claude Code's `--output-format
 * stream-json` convention — one JSON object per line, each carrying a `type`
 * discriminator and the `session_id` — so tooling that already drives headless
 * coding agents can consume Deep Code without a bespoke parser.
 *
 * Every run emits exactly one `system`/`init` event first and exactly one
 * `result` event last, with zero or more message events in between. Fields
 * that have no Deep Code equivalent are omitted rather than invented.
 */

import type { ModelUsage, SessionMessage, SessionStatus } from "@vegamo/deepcode-core";

export const EXEC_OUTPUT_FORMATS = ["text", "json"] as const;

export type ExecOutputFormat = (typeof EXEC_OUTPUT_FORMATS)[number];

export function isExecOutputFormat(value: unknown): value is ExecOutputFormat {
  return typeof value === "string" && (EXEC_OUTPUT_FORMATS as readonly string[]).includes(value);
}

/** Why the run ended. `success` is the only non-error outcome. */
export type ExecResultSubtype = "success" | "error" | "interrupted" | "permission_required" | "input_required";

export interface ExecJsonContext {
  cwd: string;
  model: string;
  permissionMode: string;
  mcpServers: string[];
  resumedFrom?: string;
  forkedFrom?: string;
}

export interface ExecResultInput {
  subtype: ExecResultSubtype;
  /** Assistant reply for a successful turn. */
  result?: string | null;
  /** Human-readable failure reason, mirroring what goes to stderr. */
  error?: string;
  /** Deep Code's own session status, passed through verbatim when known. */
  status?: SessionStatus;
  usage?: ModelUsage | null;
}

/**
 * Serializes exec-mode progress as newline-delimited JSON.
 *
 * The emitter owns the "init is always first" invariant: the session id for a
 * fresh session is minted inside `handleUserPrompt`, so `noteSessionId` is
 * driven by the first streamed message. That still reaches stdout before the
 * turn completes, which is what lets a caller capture the id for a later
 * `--resume`.
 */
export class ExecJsonEmitter {
  private readonly startedAt = Date.now();
  private sessionId: string | null = null;
  private initEmitted = false;

  constructor(
    private readonly write: (line: string) => void,
    private readonly context: ExecJsonContext
  ) {}

  /** Records the session id, emitting the `init` event the first time one is known. */
  noteSessionId(sessionId: string | null | undefined): void {
    if (!sessionId) {
      return;
    }
    this.sessionId = sessionId;
    this.emitInit();
  }

  emitMessage(message: SessionMessage): void {
    this.noteSessionId(message.sessionId);
    this.emitInit();
    const payload: Record<string, unknown> = {
      type: message.role,
      session_id: this.sessionId,
      message: {
        id: message.id,
        role: message.role,
        content: message.content,
        visible: message.visible,
        create_time: message.createTime,
        content_params: message.contentParams ?? null,
        message_params: message.messageParams ?? null,
      },
    };
    // `system` is also the init event's type, so keep the two distinguishable.
    if (message.role === "system") {
      payload.subtype = "message";
    }
    this.emit(payload, () => ({
      type: message.role,
      session_id: this.sessionId,
      message: {
        id: message.id,
        role: message.role,
        content: message.content,
        visible: message.visible,
        create_time: message.createTime,
      },
    }));
  }

  emitResult(input: ExecResultInput): void {
    this.emitInit();
    const payload: Record<string, unknown> = {
      type: "result",
      subtype: input.subtype,
      is_error: input.subtype !== "success",
      session_id: this.sessionId,
      result: input.result ?? "",
      duration_ms: Date.now() - this.startedAt,
    };
    if (input.error) {
      payload.error = input.error;
    }
    if (input.status) {
      payload.status = input.status;
    }
    if (input.usage) {
      payload.usage = input.usage;
    }
    this.emit(payload);
  }

  private emitInit(): void {
    if (this.initEmitted) {
      return;
    }
    this.initEmitted = true;
    const payload: Record<string, unknown> = {
      type: "system",
      subtype: "init",
      session_id: this.sessionId,
      cwd: this.context.cwd,
      model: this.context.model,
      permission_mode: this.context.permissionMode,
      mcp_servers: this.context.mcpServers,
    };
    if (this.context.resumedFrom) {
      payload.resumed_from = this.context.resumedFrom;
    }
    if (this.context.forkedFrom) {
      payload.forked_from = this.context.forkedFrom;
    }
    this.emit(payload);
  }

  /**
   * Writes one JSON line. Tool payloads reach us as `unknown`, so a value that
   * cannot be serialized falls back to a reduced payload rather than throwing
   * and taking the whole run down.
   */
  private emit(payload: Record<string, unknown>, fallback?: () => Record<string, unknown>): void {
    let line: string;
    try {
      line = JSON.stringify(payload);
    } catch {
      try {
        line = JSON.stringify(fallback ? fallback() : { type: payload.type, session_id: this.sessionId });
      } catch {
        return;
      }
    }
    this.write(line);
  }
}
