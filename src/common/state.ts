import * as path from "path";
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
};

const fileStatesBySession = new Map<string, Map<string, FileState>>();
const snippetsBySession = new Map<string, Map<string, FileSnippet>>();
const snippetCountersBySession = new Map<string, number>();
const fileVersionsBySession = new Map<string, Map<string, number>>();

export function clearSessionState(sessionId: string): void {
  if (!sessionId) {
    return;
  }

  fileStatesBySession.delete(sessionId);
  snippetsBySession.delete(sessionId);
  snippetCountersBySession.delete(sessionId);
  fileVersionsBySession.delete(sessionId);
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
  if (!sessionId || !filePath || startLine < 1 || endLine < startLine) {
    return null;
  }

  const nextCounter = (snippetCountersBySession.get(sessionId) ?? 0) + 1;
  snippetCountersBySession.set(sessionId, nextCounter);

  const snippet: FileSnippet = {
    id: `snippet_${nextCounter}`,
    filePath: normalizeFilePath(filePath),
    startLine,
    endLine,
    preview,
    fileVersion: getFileVersion(sessionId, filePath),
  };

  let snippets = snippetsBySession.get(sessionId);
  if (!snippets) {
    snippets = new Map<string, FileSnippet>();
    snippetsBySession.set(sessionId, snippets);
  }
  snippets.set(snippet.id, snippet);
  return snippet;
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
