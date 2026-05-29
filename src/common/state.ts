import * as fs from "fs";
import * as path from "path";
import { readTextFileWithMetadata } from "./file-utils";
import { posixPathToWindowsPath } from "./shell-utils";

export type FileLineEnding = "LF" | "CRLF";

export type FileState = {
  filePath: string;
  content: string;
  timestamp: number;
  version?: number;
  offset?: number;
  limit?: number;
  isPartialView?: boolean;
  encoding?: BufferEncoding;
  lineEndings?: FileLineEnding;
};

export type FileSnippet = {
  id: string;
  filePath: string;
  startLine: number;
  endLine: number;
  preview: string;
  fileVersion: number;
  scopeType: "snippet" | "full";
};

export type SessionStateHistoryMessage = {
  role?: unknown;
  content?: unknown;
};

const fileStatesBySession = new Map<string, Map<string, FileState>>();
const snippetsBySession = new Map<string, Map<string, FileSnippet>>();
const snippetCountersBySession = new Map<string, number>();
const fullFileSnippetCountersBySession = new Map<string, number>();
const fileVersionsBySession = new Map<string, Map<string, number>>();

export function clearSessionState(sessionId: string): void {
  if (!sessionId) {
    return;
  }

  fileStatesBySession.delete(sessionId);
  snippetsBySession.delete(sessionId);
  snippetCountersBySession.delete(sessionId);
  fullFileSnippetCountersBySession.delete(sessionId);
  fileVersionsBySession.delete(sessionId);
}

export function hasSessionState(sessionId: string): boolean {
  if (!sessionId) {
    return false;
  }

  return Boolean(
    fileStatesBySession.get(sessionId)?.size ||
    snippetsBySession.get(sessionId)?.size ||
    snippetCountersBySession.has(sessionId) ||
    fullFileSnippetCountersBySession.has(sessionId) ||
    fileVersionsBySession.get(sessionId)?.size
  );
}

export function normalizeFilePath(filePath: string, platform: NodeJS.Platform = process.platform): string {
  const nativePath = normalizeNativeFilePath(filePath, platform);
  return platform === "win32" ? path.win32.normalize(nativePath) : path.normalize(nativePath);
}

export function normalizeNativeFilePath(filePath: string, platform: NodeJS.Platform = process.platform): string {
  if (platform !== "win32") {
    return filePath;
  }

  if (isGitBashAbsolutePath(filePath)) {
    return posixPathToWindowsPath(filePath);
  }

  return filePath;
}

export function isAbsoluteFilePath(filePath: string, platform: NodeJS.Platform = process.platform): boolean {
  const nativePath = normalizeNativeFilePath(filePath, platform);
  if (platform !== "win32") {
    return path.isAbsolute(nativePath);
  }

  const normalized = path.win32.normalize(nativePath);
  return path.win32.isAbsolute(normalized) && (/^[A-Za-z]:[\\/]/.test(normalized) || /^\\\\/.test(normalized));
}

function isGitBashAbsolutePath(filePath: string): boolean {
  return /^\/[A-Za-z](?:\/|$)/.test(filePath) || /^\/cygdrive\/[A-Za-z](?:\/|$)/.test(filePath);
}

export function recordFileState(
  sessionId: string,
  state: FileState,
  options: { incrementVersion?: boolean } = {}
): void {
  if (!sessionId || !state.filePath) {
    return;
  }

  let sessionState = fileStatesBySession.get(sessionId);
  if (!sessionState) {
    sessionState = new Map<string, FileState>();
    fileStatesBySession.set(sessionId, sessionState);
  }

  const normalizedPath = normalizeFilePath(state.filePath);
  const currentVersion = getFileVersion(sessionId, normalizedPath);
  const nextVersion = options.incrementVersion ? currentVersion + 1 : currentVersion;
  setFileVersion(sessionId, normalizedPath, nextVersion);
  sessionState.set(normalizedPath, {
    ...state,
    filePath: normalizedPath,
    version: nextVersion,
  });
}

export function markFileRead(
  sessionId: string,
  filePath: string,
  state: Omit<FileState, "filePath"> | null = null
): void {
  if (!sessionId || !filePath) {
    return;
  }

  recordFileState(sessionId, {
    filePath,
    content: state?.content ?? "",
    timestamp: state?.timestamp ?? 0,
    offset: state?.offset,
    limit: state?.limit,
    isPartialView: state?.isPartialView,
    encoding: state?.encoding,
    lineEndings: state?.lineEndings,
  });
}

export function getFileState(sessionId: string, filePath: string): FileState | null {
  if (!sessionId || !filePath) {
    return null;
  }

  return fileStatesBySession.get(sessionId)?.get(normalizeFilePath(filePath)) ?? null;
}

export function wasFileRead(sessionId: string, filePath: string): boolean {
  return getFileState(sessionId, filePath) !== null;
}

export function getFileVersion(sessionId: string, filePath: string): number {
  if (!sessionId || !filePath) {
    return 0;
  }
  return fileVersionsBySession.get(sessionId)?.get(normalizeFilePath(filePath)) ?? 0;
}

function setFileVersion(sessionId: string, filePath: string, version: number): void {
  let sessionVersions = fileVersionsBySession.get(sessionId);
  if (!sessionVersions) {
    sessionVersions = new Map<string, number>();
    fileVersionsBySession.set(sessionId, sessionVersions);
  }
  sessionVersions.set(normalizeFilePath(filePath), version);
}

export function isFullFileView(state: FileState | null): boolean {
  return Boolean(
    state && !state.isPartialView && typeof state.offset === "undefined" && typeof state.limit === "undefined"
  );
}

export function createSnippet(
  sessionId: string,
  filePath: string,
  startLine: number,
  endLine: number,
  preview: string
): FileSnippet | null {
  const nextCounter = (snippetCountersBySession.get(sessionId) ?? 0) + 1;
  snippetCountersBySession.set(sessionId, nextCounter);
  return createSnippetWithId(sessionId, filePath, startLine, endLine, preview, `snippet_${nextCounter}`, "snippet");
}

export function createFullFileSnippet(
  sessionId: string,
  filePath: string,
  startLine: number,
  endLine: number,
  preview: string
): FileSnippet | null {
  const nextCounter = fullFileSnippetCountersBySession.get(sessionId) ?? 0;
  fullFileSnippetCountersBySession.set(sessionId, nextCounter + 1);
  return createSnippetWithId(sessionId, filePath, startLine, endLine, preview, `full_file_${nextCounter}`, "full");
}

export function restoreSnippet(
  sessionId: string,
  snippet: {
    id: string;
    filePath: string;
    startLine: number;
    endLine: number;
    preview?: string;
    scopeType?: FileSnippet["scopeType"];
  }
): FileSnippet | null {
  const restored = createSnippetWithId(
    sessionId,
    snippet.filePath,
    snippet.startLine,
    snippet.endLine,
    snippet.preview ?? "",
    snippet.id,
    snippet.scopeType ?? inferSnippetScopeType(snippet.id)
  );
  if (restored) {
    updateSnippetCounters(sessionId, snippet.id);
  }
  return restored;
}

function createSnippetWithId(
  sessionId: string,
  filePath: string,
  startLine: number,
  endLine: number,
  preview: string,
  id: string,
  scopeType: FileSnippet["scopeType"]
): FileSnippet | null {
  if (!sessionId || !filePath || startLine < 1 || endLine < startLine) {
    return null;
  }

  const snippet: FileSnippet = {
    id,
    filePath: normalizeFilePath(filePath),
    startLine,
    endLine,
    preview,
    fileVersion: getFileVersion(sessionId, filePath),
    scopeType,
  };

  let snippets = snippetsBySession.get(sessionId);
  if (!snippets) {
    snippets = new Map<string, FileSnippet>();
    snippetsBySession.set(sessionId, snippets);
  }
  snippets.set(snippet.id, snippet);
  return snippet;
}

function inferSnippetScopeType(id: string): FileSnippet["scopeType"] {
  return id.startsWith("full_file_") ? "full" : "snippet";
}

function updateSnippetCounters(sessionId: string, id: string): void {
  const fullFileMatch = /^full_file_(\d+)$/.exec(id);
  if (fullFileMatch) {
    const nextCounter = Number(fullFileMatch[1]) + 1;
    const current = fullFileSnippetCountersBySession.get(sessionId) ?? 0;
    fullFileSnippetCountersBySession.set(sessionId, Math.max(current, nextCounter));
    return;
  }

  const snippetMatch = /^snippet_(\d+)$/.exec(id);
  if (snippetMatch) {
    const currentCounter = Number(snippetMatch[1]);
    const current = snippetCountersBySession.get(sessionId) ?? 0;
    snippetCountersBySession.set(sessionId, Math.max(current, currentCounter));
  }
}

export function getSnippet(sessionId: string, snippetId: string): FileSnippet | null {
  if (!sessionId || !snippetId) {
    return null;
  }
  return snippetsBySession.get(sessionId)?.get(snippetId) ?? null;
}

export function hasSnippetOutdatedFileVersion(sessionId: string, snippet: FileSnippet): boolean {
  return getFileVersion(sessionId, snippet.filePath) > snippet.fileVersion;
}

export function rebuildSessionStateFromHistory(
  sessionId: string,
  messages: Iterable<SessionStateHistoryMessage>
): void {
  if (!sessionId || hasSessionState(sessionId)) {
    return;
  }

  for (const message of messages) {
    if (message.role !== "tool" || typeof message.content !== "string") {
      continue;
    }

    const result = parsePersistedToolResult(message.content);
    if (!result || result.ok !== true) {
      continue;
    }

    const metadata = asRecord(result.metadata);
    if (!metadata) {
      continue;
    }

    if (result.name === "read") {
      rebuildReadResult(sessionId, result, metadata);
    } else if (result.name === "edit") {
      rebuildEditResult(sessionId, metadata);
    } else if (result.name === "write") {
      rebuildWriteResult(sessionId, metadata);
    }
  }
}

function rebuildReadResult(
  sessionId: string,
  result: Record<string, unknown>,
  metadata: Record<string, unknown>
): void {
  const snippet = asRecord(metadata.snippet);
  if (!snippet) {
    return;
  }

  const restored = restoreSnippetFromRecord(sessionId, snippet, {
    idKey: "id",
    filePathKey: "filePath",
    startLineKey: "startLine",
    endLineKey: "endLine",
    preview: typeof result.output === "string" ? result.output : "",
  });
  if (!restored) {
    return;
  }

  refreshRebuiltFileState(sessionId, restored.filePath, {
    scopeType: restored.scopeType,
    startLine: restored.startLine,
    endLine: restored.endLine,
    incrementVersion: false,
  });
}

function rebuildEditResult(sessionId: string, metadata: Record<string, unknown>): void {
  const scope = asRecord(metadata.scope);
  if (scope) {
    restoreSnippetFromRecord(sessionId, scope, {
      idKey: "snippet_id",
      filePathKey: "file_path",
      startLineKey: "start_line",
      endLineKey: "end_line",
      scopeType: metadata.read_scope_type === "full" ? "full" : undefined,
    });
  }

  const scopeFilePath = typeof scope?.file_path === "string" ? scope.file_path : undefined;
  rebuildCandidateSnippets(sessionId, metadata, scopeFilePath);

  const filePath = typeof metadata.file_path === "string" ? metadata.file_path : scopeFilePath;
  if (filePath && metadata.cache_refreshed === true) {
    refreshRebuiltFileState(sessionId, filePath, { incrementVersion: true });
  }
}

function rebuildWriteResult(sessionId: string, metadata: Record<string, unknown>): void {
  if (metadata.cache_refreshed !== true || typeof metadata.file_path !== "string") {
    return;
  }

  refreshRebuiltFileState(sessionId, metadata.file_path, { incrementVersion: true });
}

function rebuildCandidateSnippets(
  sessionId: string,
  metadata: Record<string, unknown>,
  filePath: string | undefined
): void {
  if (!filePath) {
    return;
  }

  const candidates = Array.isArray(metadata.candidates) ? metadata.candidates : [];
  for (const candidate of candidates) {
    const record = asRecord(candidate);
    if (!record) {
      continue;
    }
    restoreSnippetFromRecord(
      sessionId,
      { ...record, file_path: filePath },
      {
        idKey: "snippet_id",
        filePathKey: "file_path",
        startLineKey: "start_line",
        endLineKey: "end_line",
        scopeType: "snippet",
        preview: typeof record.preview === "string" ? record.preview : "",
      }
    );
  }

  const closestMatch = asRecord(metadata.closest_match);
  if (closestMatch) {
    restoreSnippetFromRecord(
      sessionId,
      { ...closestMatch, file_path: filePath },
      {
        idKey: "snippet_id",
        filePathKey: "file_path",
        startLineKey: "start_line",
        endLineKey: "end_line",
        scopeType: "snippet",
        preview: typeof closestMatch.preview === "string" ? closestMatch.preview : "",
      }
    );
  }
}

function restoreSnippetFromRecord(
  sessionId: string,
  record: Record<string, unknown>,
  options: {
    idKey: string;
    filePathKey: string;
    startLineKey: string;
    endLineKey: string;
    preview?: string;
    scopeType?: FileSnippet["scopeType"];
  }
): FileSnippet | null {
  const rawId = record[options.idKey];
  const rawFilePath = record[options.filePathKey];
  const id = typeof rawId === "string" ? rawId.trim() : "";
  const filePath = typeof rawFilePath === "string" ? normalizeFilePath(rawFilePath) : "";
  const startLine = toPositiveInteger(record[options.startLineKey]);
  const endLine = toPositiveInteger(record[options.endLineKey]);
  if (!id || !filePath || startLine === null || endLine === null) {
    return null;
  }

  return restoreSnippet(sessionId, {
    id,
    filePath,
    startLine,
    endLine,
    preview: options.preview,
    scopeType: options.scopeType,
  });
}

function refreshRebuiltFileState(
  sessionId: string,
  rawFilePath: string,
  options: {
    scopeType?: FileSnippet["scopeType"];
    startLine?: number;
    endLine?: number;
    incrementVersion?: boolean;
  } = {}
): void {
  const filePath = normalizeFilePath(rawFilePath);
  if (!filePath || !fs.existsSync(filePath)) {
    return;
  }

  try {
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      return;
    }

    const metadata = readTextFileWithMetadata(filePath);
    const isPartialView = options.scopeType === "snippet";
    const content = isPartialView
      ? metadata.content
          .split("\n")
          .slice((options.startLine ?? 1) - 1, options.endLine)
          .join("\n")
      : metadata.content;

    recordFileState(
      sessionId,
      {
        filePath,
        content,
        timestamp: metadata.timestamp,
        offset: isPartialView ? options.startLine : undefined,
        limit:
          isPartialView && options.startLine !== undefined && options.endLine !== undefined
            ? Math.max(1, options.endLine - options.startLine + 1)
            : undefined,
        isPartialView,
        encoding: metadata.encoding,
        lineEndings: metadata.lineEndings,
      },
      { incrementVersion: options.incrementVersion }
    );
  } catch {
    // Best-effort restore: later tool execution will return the precise filesystem error.
  }
}

function parsePersistedToolResult(content: string): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(content));
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function toPositiveInteger(value: unknown): number | null {
  const numberValue = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isInteger(numberValue) || numberValue < 1) {
    return null;
  }
  return numberValue;
}
