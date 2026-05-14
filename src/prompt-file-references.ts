import * as fs from "fs";
import * as path from "path";
import { normalizeContent } from "./common/file-utils";

export const MAX_PROMPT_FILE_REFERENCE_BYTES = 128 * 1024;
export const MAX_PROMPT_FILE_REFERENCES_TOTAL_BYTES = 256 * 1024;

export type PromptFileReference = {
  raw: string;
  path: string;
  displayPath: string;
  content: string;
  sizeBytes: number;
};

export type PromptFileReferenceToken = {
  raw: string;
  path: string;
  start: number;
  end: number;
};

export type PromptFileReferenceError = {
  raw: string;
  message: string;
};

export type ResolvePromptFileReferencesResult = {
  references: PromptFileReference[];
  errors: PromptFileReferenceError[];
};

const PATH_BOUNDARY_CHARS = new Set(["(", "[", "{", "<", '"', "'", "`", ",", ":"]);

export function parsePromptFileReferenceTokens(text: string): PromptFileReferenceToken[] {
  const tokens: PromptFileReferenceToken[] = [];

  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== "@") {
      continue;
    }
    if (!isReferenceBoundary(text[index - 1])) {
      continue;
    }

    const next = text[index + 1];
    if (!next || /\s/.test(next)) {
      continue;
    }

    const quoted = next === '"' || next === "'";
    if (quoted) {
      const quote = next;
      let end = index + 2;
      while (end < text.length && text[end] !== quote) {
        end += 1;
      }
      if (end >= text.length) {
        continue;
      }

      const rawPath = text.slice(index + 2, end);
      if (rawPath.trim()) {
        tokens.push({
          raw: text.slice(index, end + 1),
          path: rawPath,
          start: index,
          end: end + 1,
        });
      }
      index = end;
      continue;
    }

    let end = index + 1;
    while (end < text.length && !/\s/.test(text[end])) {
      end += 1;
    }

    const rawPath = trimTrailingPunctuation(text.slice(index + 1, end));
    if (!rawPath) {
      continue;
    }
    const tokenEnd = index + 1 + rawPath.length;
    tokens.push({
      raw: text.slice(index, tokenEnd),
      path: rawPath,
      start: index,
      end: tokenEnd,
    });
    index = tokenEnd - 1;
  }

  return tokens;
}

export function resolvePromptFileReferences(
  text: string,
  projectRoot: string,
  options?: {
    maxFileBytes?: number;
    maxTotalBytes?: number;
  }
): ResolvePromptFileReferencesResult {
  const maxFileBytes = options?.maxFileBytes ?? MAX_PROMPT_FILE_REFERENCE_BYTES;
  const maxTotalBytes = options?.maxTotalBytes ?? MAX_PROMPT_FILE_REFERENCES_TOTAL_BYTES;
  const references: PromptFileReference[] = [];
  const errors: PromptFileReferenceError[] = [];
  const seenPaths = new Set<string>();
  let totalBytes = 0;

  for (const token of parsePromptFileReferenceTokens(text)) {
    const absolutePath = resolveReferencePath(token.path, projectRoot);
    const displayPath = formatDisplayPath(absolutePath, projectRoot);

    if (seenPaths.has(absolutePath)) {
      continue;
    }
    seenPaths.add(absolutePath);

    let stat: fs.Stats;
    try {
      stat = fs.statSync(absolutePath);
    } catch {
      errors.push({ raw: token.raw, message: `File reference not found: ${token.raw}` });
      continue;
    }

    if (!stat.isFile()) {
      errors.push({ raw: token.raw, message: `File reference is not a file: ${token.raw}` });
      continue;
    }
    if (stat.size > maxFileBytes) {
      errors.push({
        raw: token.raw,
        message: `File reference is too large: ${token.raw} (${formatBytes(stat.size)}, limit ${formatBytes(
          maxFileBytes
        )})`,
      });
      continue;
    }
    if (totalBytes + stat.size > maxTotalBytes) {
      errors.push({
        raw: token.raw,
        message: `File references are too large in total (limit ${formatBytes(maxTotalBytes)})`,
      });
      continue;
    }

    const buffer = fs.readFileSync(absolutePath);
    if (isLikelyBinary(buffer)) {
      errors.push({ raw: token.raw, message: `Binary file references are not supported: ${token.raw}` });
      continue;
    }

    const content = normalizeContent(buffer.toString("utf8"));
    references.push({
      raw: token.raw,
      path: absolutePath,
      displayPath,
      content,
      sizeBytes: stat.size,
    });
    totalBytes += stat.size;
  }

  return { references, errors };
}

export function buildPromptTextWithFileReferences(
  text: string | undefined,
  references?: PromptFileReference[]
): string {
  const baseText = text ?? "";
  if (!references || references.length === 0) {
    return baseText;
  }

  const fileBlocks = references
    .map((reference) => {
      return `<file path="${escapeXmlAttribute(reference.displayPath)}">\n${escapeCdata(reference.content)}\n</file>`;
    })
    .join("\n\n");

  return `${baseText}\n\n<referenced_files>\n${fileBlocks}\n</referenced_files>`;
}

function resolveReferencePath(referencePath: string, projectRoot: string): string {
  const expandedPath = referencePath.startsWith("~/")
    ? path.join(process.env.HOME ?? process.env.USERPROFILE ?? "", referencePath.slice(2))
    : referencePath;
  return path.resolve(projectRoot, expandedPath);
}

function formatDisplayPath(absolutePath: string, projectRoot: string): string {
  const relative = path.relative(projectRoot, absolutePath);
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
    return normalizeSeparators(relative);
  }
  return normalizeSeparators(absolutePath);
}

function normalizeSeparators(value: string): string {
  return value.replace(/\\/g, "/");
}

function isReferenceBoundary(previous: string | undefined): boolean {
  return previous === undefined || /\s/.test(previous) || PATH_BOUNDARY_CHARS.has(previous);
}

function trimTrailingPunctuation(value: string): string {
  return value.replace(/[),.;:!?]+$/u, "");
}

function isLikelyBinary(buffer: Buffer): boolean {
  return buffer.includes(0);
}

function escapeXmlAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeCdata(value: string): string {
  return `<![CDATA[\n${value.replace(/\]\]>/g, "]]]]><![CDATA[>")}\n]]>`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  return `${Math.ceil(bytes / 1024)} KiB`;
}
