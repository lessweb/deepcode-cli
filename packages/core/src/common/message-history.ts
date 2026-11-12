import fs from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import lockfile from "proper-lockfile";
import type { SessionMessage } from "../session";

export type HistorySettings = {
  persistence?: "saveAll" | "none";
  maxBytes?: number;
};
export type ResolvedHistorySettings = Required<HistorySettings>;
export const DEFAULT_HISTORY_SETTINGS: ResolvedHistorySettings = { persistence: "saveAll", maxBytes: 10_485_760 };
export const HISTORY_BATCH_ROWS = 128;
export const HISTORY_BATCH_BYTES = 64 * 1024;

export function resolveHistorySettings(user?: HistorySettings, project?: HistorySettings): ResolvedHistorySettings {
  for (const value of [user, project]) {
    if (value === undefined) continue;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("history must be an object.");
    if (value.persistence !== undefined && value.persistence !== "saveAll" && value.persistence !== "none") {
      throw new Error('history.persistence must be "saveAll" or "none".');
    }
    if (value.maxBytes !== undefined && (!Number.isSafeInteger(value.maxBytes) || value.maxBytes < 0)) {
      throw new Error("history.maxBytes must be a non-negative safe integer.");
    }
  }
  return {
    persistence: project?.persistence ?? user?.persistence ?? DEFAULT_HISTORY_SETTINGS.persistence,
    maxBytes: project?.maxBytes ?? user?.maxBytes ?? DEFAULT_HISTORY_SETTINGS.maxBytes,
  };
}

/** Legacy user messages have no userPrompt metadata; hidden/generated messages are excluded. */
export function isUserHistoryMessage(message: SessionMessage): boolean {
  return (
    message.role === "user" &&
    message.visible &&
    !message.meta?.isSummary &&
    !message.meta?.isToolFollowUp &&
    typeof message.content === "string" &&
    message.content.trim().length > 0
  );
}

export type HistoryEntry = { session_id: string; ts: number; text: string };
export type HistoryCursor = { position: number; revision: string };
export type HistoryBatch = {
  entries: HistoryEntry[];
  cursor: HistoryCursor | null;
  revision: string;
  rows: number;
  bytes: number;
};

export function getMessageHistoryPath(): string {
  return path.join(os.homedir(), ".deepcode", "history.jsonl");
}

function revisionOf(stat: Awaited<ReturnType<FileHandle["stat"]>>): string {
  return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
}

export async function getHistoryRevision(filePath = getMessageHistoryPath()): Promise<string> {
  try {
    return revisionOf(await fs.stat(filePath));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    throw error;
  }
}

export class HistoryChangedError extends Error {
  constructor() {
    super("History changed while reading.");
  }
}

/** One scanner per batch, retaining its read block while moving backwards. */
class ReverseLines {
  private block = Buffer.alloc(0);
  private blockStart = -1;
  constructor(
    private file: FileHandle,
    public position: number
  ) {}

  private async blockAt(position: number): Promise<Buffer> {
    if (position < this.blockStart || position >= this.blockStart + this.block.length) {
      this.blockStart = Math.max(0, position + 1 - 8192);
      const buffer = Buffer.alloc(position + 1 - this.blockStart);
      const { bytesRead } = await this.file.read(buffer, 0, buffer.length, this.blockStart);
      if (bytesRead !== buffer.length) throw new HistoryChangedError();
      this.block = buffer;
    }
    return this.block;
  }

  async previous(limit = Infinity): Promise<{ bytes: Buffer; start: number; end: number } | null> {
    const end = this.position;
    if (end === 0) return null;
    let position = end;
    const parts: Buffer[] = [];
    // The trailing newline belongs to this record, not an extra empty line.
    const last = await this.blockAt(position - 1);
    if (last[position - 1 - this.blockStart] === 10) {
      position--;
      parts.push(Buffer.from("\n"));
    }
    while (position > 0) {
      const block = await this.blockAt(position - 1);
      const index = position - this.blockStart;
      const separator = block.lastIndexOf(10, index - 1);
      const start = separator < 0 ? 0 : separator + 1;
      parts.push(block.subarray(start, index));
      position = this.blockStart + start;
      if (end - position > limit) return null;
      if (separator >= 0) break;
    }
    if (end - position > limit) return null;
    this.position = position;
    return { bytes: Buffer.concat(parts.reverse()), start: position, end };
  }
}

/** Malformed rows count against the bounds so corrupt files cannot cause an unbounded batch. */
export async function readHistoryBatch(
  cursor?: HistoryCursor,
  maxRows = HISTORY_BATCH_ROWS,
  filePath = getMessageHistoryPath()
): Promise<HistoryBatch> {
  let file: FileHandle;
  try {
    file = await fs.open(filePath, "r");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    if (cursor) throw new HistoryChangedError();
    return { entries: [], cursor: null, revision: "missing", rows: 0, bytes: 0 };
  }
  try {
    const stat = await file.stat();
    const revision = revisionOf(stat);
    if (cursor && cursor.revision !== revision) throw new HistoryChangedError();
    const scanner = new ReverseLines(file, cursor?.position ?? stat.size);
    const entries: HistoryEntry[] = [];
    let rows = 0;
    let bytes = 0;
    while (scanner.position > 0 && rows < Math.min(maxRows, HISTORY_BATCH_ROWS)) {
      const line = await scanner.previous(rows === 0 ? Infinity : HISTORY_BATCH_BYTES - bytes);
      if (!line) break;
      rows++;
      bytes += line.bytes.length;
      try {
        const entry: unknown = JSON.parse(line.bytes.toString("utf8"));
        if (isHistoryEntry(entry) && entry.text.trim()) entries.push(entry);
      } catch {
        /* Skip the malformed row, keeping its byte position consumed. */
      }
      if (bytes >= HISTORY_BATCH_BYTES) break;
    }
    if (revisionOf(await file.stat()) !== revision || (await getHistoryRevision(filePath)) !== revision) {
      throw new HistoryChangedError();
    }
    return {
      entries,
      cursor: scanner.position > 0 ? { position: scanner.position, revision } : null,
      revision,
      rows,
      bytes,
    };
  } finally {
    await file.close();
  }
}

function isHistoryEntry(value: unknown): value is HistoryEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<HistoryEntry>;
  return (
    typeof entry.text === "string" &&
    typeof entry.session_id === "string" &&
    typeof entry.ts === "number" &&
    Number.isFinite(entry.ts)
  );
}

const writeQueues = new Map<string, Promise<void>>();

export async function appendHistoryEntry(
  entry: HistoryEntry,
  settings: ResolvedHistorySettings = DEFAULT_HISTORY_SETTINGS,
  filePath = getMessageHistoryPath()
): Promise<void> {
  if (settings.persistence === "none" || !entry.text.trim()) return;
  const previous = writeQueues.get(filePath) ?? Promise.resolve();
  const pending = previous.catch(() => {}).then(() => appendLocked(entry, settings, filePath));
  writeQueues.set(filePath, pending);
  try {
    await pending;
  } finally {
    if (writeQueues.get(filePath) === pending) writeQueues.delete(filePath);
  }
}

async function appendLocked(entry: HistoryEntry, settings: ResolvedHistorySettings, filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const release = await lockfile.lock(filePath, {
    realpath: false,
    retries: { retries: 10, minTimeout: 100, maxTimeout: 100, factor: 1 },
  });
  try {
    const file = await fs.open(filePath, "a+", 0o600);
    try {
      const size = (await file.stat()).size;
      let separator = "";
      if (size) {
        const last = Buffer.alloc(1);
        await file.read(last, 0, 1, size - 1);
        if (last[0] !== 10) separator = "\n";
      }
      await file.writeFile(`${separator}${JSON.stringify(entry)}\n`, "utf8");
    } finally {
      await file.close();
    }
    if (settings.maxBytes > 0) await trimHistory(filePath, settings.maxBytes);
  } finally {
    await release();
  }
}

async function trimHistory(filePath: string, maxBytes: number): Promise<void> {
  const file = await fs.open(filePath, "r");
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  try {
    const size = (await file.stat()).size;
    if (size <= maxBytes) return;
    const scanner = new ReverseLines(file, size);
    const newest = await scanner.previous();
    if (!newest) return;
    const target = Math.max(newest.bytes.length, Math.floor(maxBytes * 0.8));
    let start = newest.start;
    while (scanner.position > 0) {
      const row = await scanner.previous(target - (size - start));
      if (!row) break;
      start = row.start;
    }
    const output = await fs.open(temporaryPath, "wx", 0o600);
    try {
      const buffer = Buffer.alloc(HISTORY_BATCH_BYTES);
      for (let position = start; position < size; ) {
        const { bytesRead } = await file.read(buffer, 0, Math.min(buffer.length, size - position), position);
        if (!bytesRead) throw new HistoryChangedError();
        await output.writeFile(buffer.subarray(0, bytesRead));
        position += bytesRead;
      }
    } finally {
      await output.close();
    }
    // Close before rename for Windows compatibility.
    await file.close();
    await fs.rename(temporaryPath, filePath);
  } finally {
    await file.close();
    await fs.rm(temporaryPath, { force: true });
  }
}
