import type { DiffDetails, DiffLine } from "./diff-preview";
import childProcess from "node:child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { FileState, FileLineEnding } from "./state";

export type FileReadMetadata = {
  content: string;
  encoding: BufferEncoding;
  lineEndings: FileLineEnding;
  timestamp: number;
};

export function normalizeContent(value: string): string {
  return value.replace(/\r\n/g, "\n");
}

export function detectLineEndings(value: string): FileLineEnding {
  return value.includes("\r\n") ? "CRLF" : "LF";
}

export function platformLineEnding(eol: string = os.EOL): FileLineEnding {
  return eol === "\r\n" ? "CRLF" : "LF";
}

/** Resolve Git's eol attribute for a new file, falling back to the platform default. */
export function newFileLineEnding(filePath: string, eol: string = os.EOL): FileLineEnding {
  try {
    // The caller creates the parent directory first. Resolve from the target's
    // directory so nested attributes, worktrees, and files outside the session's
    // project root use the correct repository and Git's own matching rules.
    const output = childProcess.execFileSync(
      "git",
      ["check-attr", "-z", "text", "eol", "--", path.basename(filePath)],
      {
        cwd: path.dirname(filePath),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 5000,
        windowsHide: true,
      }
    );
    const [, , textAttribute, , , eolAttribute] = output.split("\0");
    // Git ignores eol when text conversion is explicitly disabled (-text/binary).
    if (textAttribute !== "unset") {
      if (eolAttribute === "lf") return "LF";
      if (eolAttribute === "crlf") return "CRLF";
    }
  } catch {
    // Missing Git, non-repository paths, or failed lookups must not block writes.
  }
  return platformLineEnding(eol);
}

export function detectEncoding(buffer: Buffer): BufferEncoding {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return "utf16le";
  }

  return "utf8";
}

export function readTextFileWithMetadata(filePath: string): FileReadMetadata {
  const buffer = fs.readFileSync(filePath);
  const stat = fs.statSync(filePath);
  const encoding = detectEncoding(buffer);
  const raw = buffer.toString(encoding);

  return {
    content: normalizeContent(raw),
    encoding,
    lineEndings: detectLineEndings(raw),
    timestamp: Math.floor(stat.mtimeMs),
  };
}

export function writeTextFile(
  filePath: string,
  content: string,
  encoding: BufferEncoding,
  lineEndings: FileLineEnding
): number {
  const normalized = normalizeContent(content);
  const toWrite = lineEndings === "CRLF" ? normalized.replace(/\n/g, "\r\n") : normalized;
  fs.writeFileSync(filePath, toWrite, { encoding });
  return Buffer.byteLength(toWrite, encoding === "utf16le" ? "utf16le" : "utf8");
}

export function ensureParentDirectory(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

export function hasFileChangedSinceState(filePath: string, state: FileState): boolean {
  const current = readTextFileWithMetadata(filePath);
  if (current.timestamp <= state.timestamp) {
    return false;
  }

  const isFullRead = !state.isPartialView && typeof state.offset === "undefined" && typeof state.limit === "undefined";

  return !(isFullRead && current.content === state.content);
}

export function buildFileDiff(
  filePath: string,
  originalContent: string | null,
  updatedContent: string,
  maxLines = 40
): { preview: string | null; details: DiffDetails | null } {
  const original = originalContent === null ? null : normalizeContent(originalContent);
  const updated = normalizeContent(updatedContent);

  if (original !== null && original === updated) {
    return { preview: null, details: null };
  }

  const oldLines = toDiffLines(original);
  const newLines = toDiffLines(updated);

  let prefix = 0;
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const oldChanged = oldLines.slice(prefix, oldLines.length - suffix);
  const newChanged = newLines.slice(prefix, newLines.length - suffix);
  const oldStart = original === null ? 0 : prefix + 1;
  const newStart = prefix + 1;

  const previewLines = [
    `--- ${original === null ? "/dev/null" : `a/${filePath}`}`,
    `+++ b/${filePath}`,
    `@@ -${oldStart},${oldChanged.length} +${newStart},${newChanged.length} @@`,
  ];

  const lines: DiffLine[] = [];
  if (prefix > 0) {
    lines.push({ kind: "context", content: oldLines[prefix - 1], lineNumber: prefix });
    previewLines.push(` ${oldLines[prefix - 1]}`);
  }

  oldChanged.forEach((line, index) => {
    previewLines.push(`-${line}`);
    lines.push({ kind: "removed", content: line, lineNumber: prefix + index + 1 });
  });

  newChanged.forEach((line, index) => {
    previewLines.push(`+${line}`);
    lines.push({ kind: "added", content: line, lineNumber: prefix + index + 1 });
  });

  if (suffix > 0) {
    lines.push({
      kind: "context",
      content: oldLines[oldLines.length - suffix],
      lineNumber: newLines.length - suffix + 1,
    });
    previewLines.push(` ${oldLines[oldLines.length - suffix]}`);
  }

  const truncated = previewLines.length > maxLines;
  const visibleLines = truncated ? lines.slice(0, Math.max(0, maxLines - 3)) : lines;
  if (truncated) {
    visibleLines.push({ kind: "context", content: "...", lineNumber: null });
  }
  return {
    preview: truncated ? `${previewLines.slice(0, maxLines).join("\n")}\n...` : previewLines.join("\n"),
    details: { added: newChanged.length, removed: oldChanged.length, lines: visibleLines },
  };
}

function toDiffLines(content: string | null): string[] {
  if (!content) {
    return [];
  }

  const lines = content.split("\n");
  if (lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

export function buildDiffPreview(
  filePath: string,
  originalContent: string | null,
  updatedContent: string,
  maxLines = 40
): string | null {
  return buildFileDiff(filePath, originalContent, updatedContent, maxLines).preview;
}
