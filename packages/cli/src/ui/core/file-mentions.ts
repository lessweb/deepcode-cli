import * as fs from "fs";
import * as path from "path";
import ignore from "ignore";
import type { PromptBufferState } from "./prompt-buffer";

export type FileMentionItem = {
  path: string;
  type: "file" | "directory";
};

export type FileMentionToken = {
  query: string;
  start: number;
  end: number;
  quoted: boolean;
};

const DEFAULT_MAX_ITEMS = 20000;
const DEFAULT_MAX_DEPTH = 8;
const DEFAULT_NOISY_DIR_NAMES = [
  ".git",
  ".next",
  ".pytest_cache",
  ".ruff_cache",
  "__pycache__",
  "build",
  "dist",
  "node_modules",
  "out",
  "target",
];

type IgnoreMatcher = {
  base: string;
  matcher: ignore.Ignore;
};

export function scanFileMentionItems(root: string, maxItems = DEFAULT_MAX_ITEMS): FileMentionItem[] {
  const items: FileMentionItem[] = [];
  const seen = new Set<string>();
  const gitRoot = findGitRoot(root);
  const visitedDirectories = new Set<string>();

  function addItem(item: FileMentionItem): void {
    if (items.length >= maxItems || seen.has(item.path)) {
      return;
    }
    seen.add(item.path);
    items.push(item);
  }

  function visit(directory: string, depth: number, matchers: IgnoreMatcher[]): void {
    if (items.length >= maxItems || depth > DEFAULT_MAX_DEPTH) {
      return;
    }

    const currentMatchers = [...matchers, ...loadDirectoryIgnoreMatchers(directory, gitRoot)];

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) {
        return a.isDirectory() ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

    for (const entry of entries) {
      if (items.length >= maxItems) {
        return;
      }
      if (entry.name === "." || entry.name === ".." || entry.name === ".git") {
        continue;
      }

      const absolute = path.join(directory, entry.name);
      const relative = toMentionPath(path.relative(root, absolute));
      if (!relative) {
        continue;
      }

      const entryType = getMentionEntryType(entry, absolute);
      if (!entryType) {
        continue;
      }

      if (matchesAnyIgnore(absolute, entryType === "directory", currentMatchers)) {
        continue;
      }

      if (entryType === "directory") {
        const realPath = safeRealpath(absolute);
        if (realPath) {
          if (visitedDirectories.has(realPath)) {
            continue;
          }
          visitedDirectories.add(realPath);
        }
        addItem({ path: `${relative}/`, type: "directory" });
        visit(absolute, depth + 1, currentMatchers);
        continue;
      }

      if (entryType === "file") {
        addItem({ path: relative, type: "file" });
      }
    }
  }

  const rootRealPath = safeRealpath(root);
  if (rootRealPath) {
    visitedDirectories.add(rootRealPath);
  }
  const initialMatchers = [...loadDefaultIgnoreMatchers(root, gitRoot), ...loadAncestorIgnoreMatchers(root, gitRoot)];
  visit(root, 0, initialMatchers);
  return items;
}

function getMentionEntryType(entry: fs.Dirent, absolute: string): FileMentionItem["type"] | null {
  if (entry.isDirectory()) {
    return "directory";
  }
  if (entry.isFile()) {
    return "file";
  }
  if (!entry.isSymbolicLink()) {
    return null;
  }
  try {
    const stat = fs.statSync(absolute);
    if (stat.isDirectory()) {
      return "directory";
    }
    if (stat.isFile()) {
      return "file";
    }
  } catch {
    return null;
  }
  return null;
}

function safeRealpath(absolute: string): string | null {
  try {
    return fs.realpathSync(absolute);
  } catch {
    return null;
  }
}

function loadDirectoryIgnoreMatchers(directory: string, gitRoot: string | null): IgnoreMatcher[] {
  const matchers: IgnoreMatcher[] = [];
  if (gitRoot && isPathInsideOrEqual(directory, gitRoot)) {
    const gitignoreMatcher = loadIgnoreFileMatcher(directory, path.join(directory, ".gitignore"));
    if (gitignoreMatcher) {
      matchers.push(gitignoreMatcher);
    }
    if (path.resolve(directory) === path.resolve(gitRoot)) {
      const gitExcludeMatcher = loadIgnoreFileMatcher(directory, path.join(directory, ".git", "info", "exclude"));
      if (gitExcludeMatcher) {
        matchers.push(gitExcludeMatcher);
      }
    }
  }

  const ignoreMatcher = loadIgnoreFileMatcher(directory, path.join(directory, ".ignore"));
  if (ignoreMatcher) {
    matchers.push(ignoreMatcher);
  }
  return matchers;
}

function loadDefaultIgnoreMatchers(root: string, gitRoot: string | null): IgnoreMatcher[] {
  if (hasApplicableGitignore(root, gitRoot)) {
    return [];
  }
  const patterns = DEFAULT_NOISY_DIR_NAMES.map((name) => `${name}/`);
  return [{ base: root, matcher: ignore().add(patterns) }];
}

function hasApplicableGitignore(root: string, gitRoot: string | null): boolean {
  if (!gitRoot) {
    return false;
  }

  const resolvedGitRoot = path.resolve(gitRoot);
  let current = path.resolve(root);
  while (isPathInsideOrEqual(current, resolvedGitRoot)) {
    if (fs.existsSync(path.join(current, ".gitignore"))) {
      return true;
    }
    if (current === resolvedGitRoot) {
      break;
    }
    current = path.dirname(current);
  }
  return false;
}

function loadAncestorIgnoreMatchers(root: string, gitRoot: string | null): IgnoreMatcher[] {
  const resolvedRoot = path.resolve(root);
  const ancestors: string[] = [];
  let current = path.dirname(resolvedRoot);
  while (gitRoot && isPathInsideOrEqual(current, gitRoot)) {
    ancestors.push(current);
    if (path.resolve(current) === path.resolve(gitRoot)) {
      break;
    }
    current = path.dirname(current);
  }
  return ancestors.reverse().flatMap((directory) => loadDirectoryIgnoreMatchers(directory, gitRoot));
}

function loadIgnoreFileMatcher(base: string, ignoreFilePath: string): IgnoreMatcher | null {
  try {
    if (!fs.existsSync(ignoreFilePath)) {
      return null;
    }
    const content = fs.readFileSync(ignoreFilePath, "utf8");
    if (!content.trim()) {
      return null;
    }
    return { base, matcher: ignore().add(content) };
  } catch {
    return null;
  }
}

function matchesAnyIgnore(absolute: string, isDir: boolean, matchers: IgnoreMatcher[]): boolean {
  let ignored = false;
  for (const { base, matcher } of matchers) {
    const relative = toMentionPath(path.relative(base, absolute));
    if (!relative || relative.startsWith("../")) {
      continue;
    }
    const result = matcher.test(isDir ? `${relative}/` : relative);
    if (result.ignored) {
      ignored = true;
    }
    if (result.unignored) {
      ignored = false;
    }
  }
  return ignored;
}

function findGitRoot(start: string): string | null {
  let current = path.resolve(start);
  while (true) {
    if (fs.existsSync(path.join(current, ".git"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function isPathInsideOrEqual(candidate: string, parent: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function filterFileMentionItems(items: FileMentionItem[], query: string, maxResults = 12): FileMentionItem[] {
  const normalizedQuery = normalizeForSearch(query);
  const scored = items
    .map((item, index) => ({ item, index, score: scoreFileMention(item.path, normalizedQuery) }))
    .filter((entry) => entry.score !== Number.POSITIVE_INFINITY)
    .sort((a, b) => a.score - b.score || a.item.path.length - b.item.path.length || a.index - b.index);

  return scored.slice(0, maxResults).map((entry) => entry.item);
}

export function getCurrentFileMentionToken(state: PromptBufferState): FileMentionToken | null {
  const text = state.text;
  const cursor = clampCursorToBoundary(text, state.cursor);
  const quoted = getCurrentQuotedFileMentionToken(text, cursor);
  if (quoted) {
    return quoted;
  }
  return getCurrentBareFileMentionToken(text, cursor);
}

export function replaceCurrentFileMentionToken(
  state: PromptBufferState,
  token: FileMentionToken,
  selectedPath: string
): PromptBufferState {
  const inserted = `${formatFileMentionPath(selectedPath)} `;
  const end = token.end < state.text.length && isWhitespace(state.text[token.end] ?? "") ? token.end + 1 : token.end;
  const text = `${state.text.slice(0, token.start)}${inserted}${state.text.slice(end)}`;
  return { text, cursor: token.start + inserted.length };
}

export function formatFileMentionPath(filePath: string): string {
  if (!/[\s"]/.test(filePath)) {
    return `@${filePath}`;
  }
  return `@"${filePath.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function getCurrentBareFileMentionToken(text: string, cursor: number): FileMentionToken | null {
  const beforeCursor = text.slice(0, cursor);
  const afterCursor = text.slice(cursor);
  const start = findTokenStart(beforeCursor);
  const end = cursor + findTokenEnd(afterCursor);
  const token = text.slice(start, end);

  if (!token.startsWith("@") || token.startsWith('@"')) {
    return null;
  }
  if (start > 0 && !isWhitespace(text[start - 1] ?? "")) {
    return null;
  }
  return { query: token.slice(1), start, end, quoted: false };
}

function getCurrentQuotedFileMentionToken(text: string, cursor: number): FileMentionToken | null {
  for (let index = cursor; index >= 0; index--) {
    if (text[index] !== "@" || text[index + 1] !== '"') {
      continue;
    }
    if (index > 0 && !isWhitespace(text[index - 1] ?? "")) {
      continue;
    }

    const closeQuote = findClosingQuote(text, index + 2);
    if (closeQuote !== -1 && cursor > closeQuote) {
      continue;
    }

    const end = closeQuote === -1 ? cursor : closeQuote + 1;
    return {
      query: unescapeQuotedMentionQuery(
        text.slice(index + 2, Math.min(cursor, closeQuote === -1 ? cursor : closeQuote))
      ),
      start: index,
      end,
      quoted: true,
    };
  }
  return null;
}

function findTokenStart(beforeCursor: string): number {
  const whitespaceIndex = findLastWhitespaceIndex(beforeCursor);
  return whitespaceIndex === -1 ? 0 : whitespaceIndex + 1;
}

function findTokenEnd(afterCursor: string): number {
  const whitespaceIndex = afterCursor.search(/\s/);
  return whitespaceIndex === -1 ? afterCursor.length : whitespaceIndex;
}

function findLastWhitespaceIndex(value: string): number {
  for (let index = value.length - 1; index >= 0; index--) {
    if (isWhitespace(value[index] ?? "")) {
      return index;
    }
  }
  return -1;
}

function findClosingQuote(text: string, start: number): number {
  let escaped = false;
  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      return index;
    }
  }
  return -1;
}

function unescapeQuotedMentionQuery(query: string): string {
  return query.replace(/\\(["\\])/g, "$1");
}

function clampCursorToBoundary(text: string, cursor: number): number {
  return Math.max(0, Math.min(cursor, text.length));
}

function scoreFileMention(itemPath: string, normalizedQuery: string): number {
  if (!normalizedQuery) {
    return itemPath.endsWith("/") ? 5 : 10;
  }

  const normalizedPath = normalizeForSearch(itemPath);
  const normalizedBase = normalizeForSearch(path.posix.basename(itemPath.replace(/\/$/, "")));
  if (normalizedPath === normalizedQuery) {
    return 0;
  }
  if (normalizedPath.startsWith(normalizedQuery)) {
    return 1;
  }
  if (normalizedBase.startsWith(normalizedQuery)) {
    return isQueryBoundary(normalizedBase[normalizedQuery.length] ?? "") ? 2 : 3;
  }
  const pathIndex = normalizedPath.indexOf(normalizedQuery);
  if (pathIndex !== -1) {
    return 20 + pathIndex;
  }
  const fuzzyScore = fuzzyMatchScore(normalizedPath, normalizedQuery);
  return fuzzyScore === null ? Number.POSITIVE_INFINITY : 100 + fuzzyScore;
}

function fuzzyMatchScore(value: string, query: string): number | null {
  let valueIndex = 0;
  let score = 0;
  for (const char of query) {
    const nextIndex = value.indexOf(char, valueIndex);
    if (nextIndex === -1) {
      return null;
    }
    score += nextIndex - valueIndex;
    valueIndex = nextIndex + 1;
  }
  return score;
}

function normalizeForSearch(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function isQueryBoundary(value: string): boolean {
  return value === "" || /[\s._/-]/.test(value);
}

function toMentionPath(value: string): string {
  return value.split(path.sep).join("/");
}

function isWhitespace(value: string): boolean {
  return /\s/.test(value);
}
