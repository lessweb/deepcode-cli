/**
 * Request body parsing helpers.
 *
 * Summary:
 * Reads JSON request bodies with a byte limit and returns typed request payloads.
 * This module deliberately contains only request parsing and validation concerns.
 *
 * Exports:
 * - readJsonBody(request: IncomingMessage): Promise<RequestBody>
 * - type RequestBody
 */
import type { IncomingMessage } from "node:http";

export type RequestBody = {
  text?: unknown;
  prompt?: unknown;
  skills?: unknown;
  images?: unknown;
  imageUrls?: unknown;
  sessionId?: unknown;
  permissions?: unknown;
  alwaysAllows?: unknown;
  decisions?: unknown;
  mode?: unknown;
  filePath?: unknown;
  path?: unknown;
  line?: unknown;
  messageId?: unknown;
  restoreCode?: unknown;
  restoreConversation?: unknown;
  summary?: unknown;
  name?: unknown;
  model?: unknown;
  thinkingEnabled?: unknown;
  reasoningEffort?: unknown;
  deltaMs?: unknown;
};

const MAX_BODY_BYTES = 16 * 1024 * 1024;
const MAX_BODY_MIB = MAX_BODY_BYTES / 1024 / 1024;

export async function readJsonBody(request: IncomingMessage): Promise<RequestBody> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      throw Object.assign(new Error(`Request body too large; limit is ${MAX_BODY_MIB} MiB`), { statusCode: 413 });
    }
    chunks.push(buffer);
  }
  if (chunks.length === 0) {
    return {};
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    return {};
  }
  try {
    return JSON.parse(raw) as RequestBody;
  } catch {
    throw Object.assign(new Error("Invalid JSON body"), { statusCode: 400 });
  }
}
