import * as fs from "fs";
import { z } from "zod";
import { buildThinkingRequestOptions } from "../common/openai-thinking";
import type { ToolExecutionContext, ToolExecutionResult } from "./executor";
import {
  buildDiffPreview,
  hasFileChangedSinceState,
  readTextFileWithMetadata,
  writeTextFile,
} from "../common/file-utils";
import { executeValidatedTool, semanticBoolean } from "../common/validate";
import {
  createSnippet,
  getFileState,
  getSnippet,
  hasSnippetOutdatedFileVersion,
  isAbsoluteFilePath,
  normalizeFilePath,
  recordFileState,
} from "../common/state";

const MAX_CANDIDATE_COUNT = 5;
const REPLACE_ALL_MATCH_THRESHOLD = 5;
const SHORT_REPLACE_ALL_LENGTH = 40;
const MIN_FUZZY_SCORE = 0.8;
const CLOSEST_MATCH_CONTEXT_LINES = 2;
const OUTDATED_SNIPPET_NOT_FOUND_ERROR =
  "old_string was not found in this snippet scope. The file has changed since this snippet was created. Read the file again before editing.";

type LineIndex = {
  lines: string[];
  lineStarts: number[];
};

type SearchScope = {
  filePath: string;
  startOffset: number;
  endOffset: number;
  startLine: number;
  endLine: number;
  snippetId: string | null;
};

type MatchOccurrence = {
  startOffset: number;
  endOffset: number;
  startLine: number;
  endLine: number;
};

type ClosestMatch = {
  text: string;
  startLine: number;
  endLine: number;
  score: number;
  strategy: "loose_escape" | "fuzzy_window";
};

type LooseEscapeMatch = MatchOccurrence & {
  text: string;
  score: number;
};

type CorrectedEditStrings = {
  oldString: string;
  newString: string;
};

const editSchema = z.strictObject({
  file_path: z.string().optional(),
  snippet_id: z.string().min(1, "snippet_id is required."),
  old_string: z.string(),
  new_string: z.string(),
  replace_all: semanticBoolean(false).optional(),
  expected_occurrences: z.preprocess((value) => {
    if (value === undefined || value === null || value === "") {
      return undefined;
    }
    if (typeof value === "string") {
      return Number(value);
    }
    return value;
  }, z.number().int().min(1, "expected_occurrences must be >= 1.").optional()),
});

export async function handleEditTool(
  args: Record<string, unknown>,
  context: ToolExecutionContext
): Promise<ToolExecutionResult> {
  return executeValidatedTool(
    "edit",
    editSchema,
    args,
    context,
    async (input) => {
      const snippetId = input.snippet_id.trim();
      const snippet = getSnippet(context.sessionId, snippetId);

      let filePath = input.file_path?.trim() ?? "";
      if (!snippet) {
        return {
          ok: false,
          name: "edit",
          error: `Unknown snippet_id: ${snippetId}`,
        };
      }

      if (!filePath) {
        filePath = snippet.filePath;
      }

      filePath = normalizeFilePath(filePath);
      if (!isAbsoluteFilePath(filePath)) {
        return {
          ok: false,
          name: "edit",
          error: "file_path must be an absolute path.",
        };
      }

      if (snippet.filePath !== filePath) {
        return {
          ok: false,
          name: "edit",
          error: "snippet_id does not belong to the provided file_path.",
        };
      }

      if (input.old_string === input.new_string) {
        return {
          ok: false,
          name: "edit",
          error: "new_string must differ from old_string.",
        };
      }

      if (!fs.existsSync(filePath)) {
        return {
          ok: false,
          name: "edit",
          error: `File not found: ${filePath}`,
        };
      }

      let stat: fs.Stats;
      try {
        stat = fs.statSync(filePath);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          ok: false,
          name: "edit",
          error: `Failed to stat file: ${message}`,
        };
      }

      if (stat.isDirectory()) {
        return {
          ok: false,
          name: "edit",
          error: "file_path points to a directory.",
        };
      }

      const fileState = getFileState(context.sessionId, filePath);
      if (!fileState) {
        return {
          ok: false,
          name: "edit",
          error: "Must read file before editing.",
        };
      }

      if (hasFileChangedSinceState(filePath, fileState)) {
        return {
          ok: false,
          name: "edit",
          error: "File has been modified since read. Read it again before editing.",
        };
      }

      try {
        const metadata = readTextFileWithMetadata(filePath);
        const raw = metadata.content;
        const oldString = input.old_string;
        const newString = input.new_string;
        const replaceAll = input.replace_all ?? false;
        const lineIndex = buildLineIndex(raw);
        const scope = buildSearchScope(filePath, raw, lineIndex, snippet);
        let matches: MatchOccurrence[] = [];
        let matchedVia:
          | "exact"
          | "empty_file"
          | "line_leading_tab_correction"
          | "loose_escape"
          | "llm_escape_correction" = "exact";
        let replacementOldString = oldString;
        let replacementNewString = newString;

        if (oldString === "") {
          if (raw !== "") {
            return {
              ok: false,
              name: "edit",
              error: "old_string must not be empty unless the file is empty.",
              metadata: {
                scope: formatScopeMetadata(scope),
              },
            };
          }
          matches = [
            {
              startOffset: 0,
              endOffset: 0,
              startLine: 1,
              endLine: 1,
            },
          ];
          matchedVia = "empty_file";
        } else {
          matches = findOccurrences(raw, oldString, scope);
        }

        if (matches.length === 0) {
          const tabStrippedOldString = stripReadResultLineTabs(oldString);
          if (tabStrippedOldString !== oldString) {
            const tabStrippedMatches = findOccurrences(raw, tabStrippedOldString, scope);
            if (tabStrippedMatches.length === 1) {
              matches = tabStrippedMatches;
              matchedVia = "line_leading_tab_correction";
              replacementOldString = tabStrippedOldString;
              replacementNewString = stripReadResultLineTabs(newString);
            }
          }
        }

        if (matches.length === 0) {
          const looseEscapeMatches = findLooseEscapeMatches(raw, oldString, scope);
          if (looseEscapeMatches.length === 1 && looseEscapeMatches[0]?.score === 1) {
            const correctedStrings = await correctEscapedStringsWithLLM(
              raw.slice(scope.startOffset, scope.endOffset),
              oldString,
              newString,
              looseEscapeMatches[0].text,
              context
            );

            if (correctedStrings) {
              const correctedMatches = findOccurrences(raw, correctedStrings.oldString, scope);
              if (correctedMatches.length > 0) {
                matches = correctedMatches;
                matchedVia = "llm_escape_correction";
                replacementOldString = correctedStrings.oldString;
                replacementNewString = correctedStrings.newString;
              }
            }

            if (matches.length === 0) {
              matches = [looseEscapeMatches[0]];
              matchedVia = "loose_escape";
            }
          }
        }

        if (matches.length === 0) {
          if (snippet && hasSnippetOutdatedFileVersion(context.sessionId, snippet)) {
            return {
              ok: false,
              name: "edit",
              error: OUTDATED_SNIPPET_NOT_FOUND_ERROR,
              metadata: {
                scope: formatScopeMetadata(scope),
              },
            };
          }

          const closestMatch = findClosestMatch(raw, oldString, scope, lineIndex);
          return {
            ok: false,
            name: "edit",
            error: "old_string not found in file.",
            metadata: closestMatch
              ? {
                  scope: formatScopeMetadata(scope),
                  closest_match: buildClosestMatchMetadata(context.sessionId, filePath, closestMatch),
                }
              : {
                  scope: formatScopeMetadata(scope),
                },
          };
        }

        if (!replaceAll && matches.length > 1) {
          return {
            ok: false,
            name: "edit",
            error: "old_string is not unique; use snippet_id, replace_all, or provide more context.",
            metadata: {
              match_count: matches.length,
              scope: formatScopeMetadata(scope),
              candidates: buildCandidateMetadata(context.sessionId, filePath, raw, matches),
            },
          };
        }

        const expectedOccurrences = input.expected_occurrences ?? null;
        const replaceAllGuardError = validateReplaceAllGuard({
          replaceAll,
          matchCount: matches.length,
          oldString: replacementOldString,
          expectedOccurrences,
        });
        if (replaceAllGuardError) {
          return {
            ok: false,
            name: "edit",
            error: replaceAllGuardError,
            metadata: {
              match_count: matches.length,
              scope: formatScopeMetadata(scope),
              candidates: buildCandidateMetadata(context.sessionId, filePath, raw, matches),
            },
          };
        }

        const updated = applyReplacement(raw, replacementOldString, replacementNewString, matches, replaceAll);
        const diffPreview = buildDiffPreview(filePath, raw, updated);
        context.onBeforeFileMutation?.(filePath);
        writeTextFile(filePath, updated, metadata.encoding, metadata.lineEndings);
        context.onAfterFileMutation?.(filePath);
        const freshMetadata = readTextFileWithMetadata(filePath);
        recordFileState(
          context.sessionId,
          {
            filePath,
            content: freshMetadata.content,
            timestamp: freshMetadata.timestamp,
            encoding: freshMetadata.encoding,
            lineEndings: freshMetadata.lineEndings,
          },
          { incrementVersion: true }
        );
        const replacedCount = replaceAll ? matches.length : 1;
        return {
          ok: true,
          name: "edit",
          output: `Replaced ${replacedCount} occurrence(s) in ${filePath}.`,
          metadata: {
            file_path: filePath,
            replaced_count: replacedCount,
            matched_via: matchedVia,
            cache_refreshed: true,
            read_scope_type: snippet.scopeType,
            encoding: freshMetadata.encoding,
            line_endings: freshMetadata.lineEndings,
            diff_preview: diffPreview,
            scope: formatScopeMetadata(scope),
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          ok: false,
          name: "edit",
          error: message,
        };
      }
    },
    {
      preprocess: (rawInput) => {
        const nextInput = { ...rawInput };
        if (typeof nextInput.file_path === "string") {
          nextInput.file_path = normalizeFilePath(nextInput.file_path);
        }
        if (typeof nextInput.snippet_id === "string") {
          nextInput.snippet_id = nextInput.snippet_id.trim();
        }
        return { ok: true, input: nextInput };
      },
    }
  );
}

function buildLineIndex(raw: string): LineIndex {
  const lines = raw.split(/\r?\n/);
  const lineStarts = new Array<number>(lines.length + 2).fill(raw.length);
  let cursor = 0;

  for (let index = 0; index < lines.length; index += 1) {
    lineStarts[index + 1] = cursor;
    cursor += lines[index].length;
    if (index < lines.length - 1) {
      if (raw.slice(cursor, cursor + 2) === "\r\n") {
        cursor += 2;
      } else if (raw[cursor] === "\n") {
        cursor += 1;
      }
    }
  }

  lineStarts[lines.length + 1] = raw.length;
  return { lines, lineStarts };
}

function buildSearchScope(
  filePath: string,
  raw: string,
  lineIndex: LineIndex,
  snippet: { startLine: number; endLine: number; id: string } | null
): SearchScope {
  if (!snippet) {
    return {
      filePath,
      startOffset: 0,
      endOffset: raw.length,
      startLine: 1,
      endLine: lineIndex.lines.length,
      snippetId: null,
    };
  }

  const safeStartLine = clamp(snippet.startLine, 1, lineIndex.lines.length);
  const safeEndLine = clamp(snippet.endLine, safeStartLine, lineIndex.lines.length);
  return {
    filePath,
    startOffset: lineIndex.lineStarts[safeStartLine],
    endOffset: lineIndex.lineStarts[safeEndLine + 1],
    startLine: safeStartLine,
    endLine: safeEndLine,
    snippetId: snippet.id,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function findOccurrences(raw: string, needle: string, scope: SearchScope): MatchOccurrence[] {
  if (!raw || !needle) {
    return [];
  }

  const scopeText = raw.slice(scope.startOffset, scope.endOffset);
  const matches: MatchOccurrence[] = [];
  let searchIndex = 0;

  while (true) {
    const found = scopeText.indexOf(needle, searchIndex);
    if (found === -1) {
      break;
    }
    const startOffset = scope.startOffset + found;
    const endOffset = startOffset + needle.length;
    matches.push({
      startOffset,
      endOffset,
      startLine: offsetToLine(raw, startOffset),
      endLine: offsetToLine(raw, Math.max(startOffset, endOffset - 1)),
    });
    searchIndex = found + needle.length;
  }

  return matches;
}

function findLooseEscapeMatches(raw: string, needle: string, scope: SearchScope): LooseEscapeMatch[] {
  if (!raw || !needle) {
    return [];
  }

  const scopeText = raw.slice(scope.startOffset, scope.endOffset);
  const looseEscapeRegex = buildLooseEscapeRegex(needle);
  if (!looseEscapeRegex) {
    return [];
  }

  const normalizedNeedle = normalizeLooseText(needle);
  const matches: LooseEscapeMatch[] = [];
  for (const match of scopeText.matchAll(looseEscapeRegex)) {
    if (typeof match.index !== "number") {
      continue;
    }

    const text = match[0];
    const startOffset = scope.startOffset + match.index;
    const endOffset = startOffset + text.length;
    matches.push({
      text,
      score: similarityScore(normalizedNeedle, normalizeLooseText(text)),
      startOffset,
      endOffset,
      startLine: offsetToLine(raw, startOffset),
      endLine: offsetToLine(raw, Math.max(startOffset, endOffset - 1)),
    });
  }

  return matches;
}

function offsetToLine(raw: string, offset: number): number {
  if (offset <= 0) {
    return 1;
  }
  let line = 1;
  for (let index = 0; index < raw.length && index < offset; index += 1) {
    if (raw[index] === "\n") {
      line += 1;
    }
  }
  return line;
}

function validateReplaceAllGuard(input: {
  replaceAll: boolean;
  matchCount: number;
  oldString: string;
  expectedOccurrences: number | null;
}): string | null {
  if (!input.replaceAll) {
    if (input.expectedOccurrences !== null && input.expectedOccurrences !== 1) {
      return "expected_occurrences can only be greater than 1 when replace_all is true.";
    }
    return null;
  }

  if (input.expectedOccurrences !== null && input.expectedOccurrences !== input.matchCount) {
    return `replace_all expected ${input.expectedOccurrences} occurrence(s), ` + `but found ${input.matchCount}.`;
  }

  const isShortFragment = input.oldString.trim().length < SHORT_REPLACE_ALL_LENGTH;
  const needsExplicitCount =
    input.expectedOccurrences === null &&
    (input.matchCount > REPLACE_ALL_MATCH_THRESHOLD || (isShortFragment && input.matchCount > 1));

  if (needsExplicitCount) {
    return (
      `replace_all would affect ${input.matchCount} occurrence(s); ` +
      "provide expected_occurrences to confirm this broader replacement."
    );
  }

  return null;
}

function applyReplacement(
  raw: string,
  oldString: string,
  newString: string,
  matches: MatchOccurrence[],
  replaceAll: boolean
): string {
  if (!replaceAll) {
    return raw.slice(0, matches[0].startOffset) + newString + raw.slice(matches[0].endOffset);
  }

  let result = "";
  let cursor = 0;
  for (const match of matches) {
    result += raw.slice(cursor, match.startOffset);
    result += newString;
    cursor = match.endOffset;
  }
  result += raw.slice(cursor);
  return result;
}

function stripReadResultLineTabs(value: string): string {
  return value.replaceAll("\n\t", "\n");
}

function buildCandidateMetadata(
  sessionId: string,
  filePath: string,
  raw: string,
  matches: MatchOccurrence[]
): Array<Record<string, unknown>> {
  return matches.slice(0, MAX_CANDIDATE_COUNT).map((match) => {
    const preview = buildPreview(raw, match.startLine, match.endLine);
    const snippet = createSnippet(sessionId, filePath, match.startLine, match.endLine, preview);
    return {
      snippet_id: snippet?.id ?? null,
      start_line: match.startLine,
      end_line: match.endLine,
      preview,
    };
  });
}

function buildClosestMatchMetadata(
  sessionId: string,
  filePath: string,
  closestMatch: ClosestMatch
): Record<string, unknown> {
  const preview = formatWithLineNumbers(closestMatch.text.split(/\r?\n/), closestMatch.startLine);
  const snippet = createSnippet(sessionId, filePath, closestMatch.startLine, closestMatch.endLine, preview);

  return {
    snippet_id: snippet?.id ?? null,
    start_line: closestMatch.startLine,
    end_line: closestMatch.endLine,
    similarity: Number(closestMatch.score.toFixed(3)),
    strategy: closestMatch.strategy,
    preview,
  };
}

function formatScopeMetadata(scope: SearchScope): Record<string, unknown> {
  return {
    file_path: scope.filePath,
    start_line: scope.startLine,
    end_line: scope.endLine,
    snippet_id: scope.snippetId,
  };
}

function buildPreview(raw: string, startLine: number, endLine: number): string {
  const lines = raw.split(/\r?\n/);
  const selected = lines.slice(startLine - 1, endLine);
  return formatWithLineNumbers(selected, startLine);
}

function formatWithLineNumbers(lines: string[], startLine: number): string {
  return lines.map((line, index) => `${String(startLine + index).padStart(6, " ")}\t${line}`).join("\n");
}

function findClosestMatch(
  raw: string,
  oldString: string,
  scope: SearchScope,
  lineIndex: LineIndex
): ClosestMatch | null {
  const looseEscapeMatches = findLooseEscapeMatches(raw, oldString, scope);
  if (looseEscapeMatches.length > 0) {
    let bestLooseMatch: ClosestMatch | null = null;
    for (const match of looseEscapeMatches) {
      const candidate: ClosestMatch = {
        text: match.text,
        startLine: match.startLine,
        endLine: match.endLine,
        score: match.score,
        strategy: "loose_escape",
      };
      if (!bestLooseMatch || candidate.score > bestLooseMatch.score) {
        bestLooseMatch = candidate;
      }
    }

    if (bestLooseMatch && bestLooseMatch.score >= MIN_FUZZY_SCORE) {
      return expandClosestMatch(raw, lineIndex, scope, bestLooseMatch);
    }
  }

  const targetLineCount = Math.max(1, oldString.split(/\r?\n/).length);
  const windowSizes = Array.from(new Set([Math.max(1, targetLineCount - 1), targetLineCount, targetLineCount + 1]));
  const normalizedTarget = normalizeLooseText(oldString);

  let bestMatch: ClosestMatch | null = null;
  for (let startLine = scope.startLine; startLine <= scope.endLine; startLine += 1) {
    for (const windowSize of windowSizes) {
      const endLine = startLine + windowSize - 1;
      if (endLine > scope.endLine) {
        continue;
      }

      const candidateText = sliceLines(raw, lineIndex, startLine, endLine);
      const score = similarityScore(normalizedTarget, normalizeLooseText(candidateText));
      if (score < MIN_FUZZY_SCORE) {
        continue;
      }

      const candidate: ClosestMatch = {
        text: candidateText,
        startLine,
        endLine,
        score,
        strategy: "fuzzy_window",
      };

      if (!bestMatch || candidate.score > bestMatch.score) {
        bestMatch = candidate;
      }
    }
  }

  return bestMatch ? expandClosestMatch(raw, lineIndex, scope, bestMatch) : null;
}

function expandClosestMatch(
  raw: string,
  lineIndex: LineIndex,
  scope: SearchScope,
  closestMatch: ClosestMatch
): ClosestMatch {
  const startLine = clamp(closestMatch.startLine - CLOSEST_MATCH_CONTEXT_LINES, scope.startLine, scope.endLine);
  const endLine = clamp(closestMatch.endLine + CLOSEST_MATCH_CONTEXT_LINES, startLine, scope.endLine);
  return {
    ...closestMatch,
    text: sliceLines(raw, lineIndex, startLine, endLine),
    startLine,
    endLine,
  };
}

function buildLooseEscapeRegex(source: string): RegExp | null {
  if (!source) {
    return null;
  }

  let pattern = "";
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\\") {
      let slashEnd = index;
      while (slashEnd < source.length && source[slashEnd] === "\\") {
        slashEnd += 1;
      }

      if (slashEnd < source.length) {
        pattern += "\\\\*";
        pattern += escapeRegExp(source[slashEnd]);
        index = slashEnd;
        continue;
      }

      pattern += escapeRegExp(source.slice(index, slashEnd));
      index = slashEnd - 1;
      continue;
    }

    pattern += escapeRegExp(source[index]);
  }

  return new RegExp(pattern, "g");
}

async function correctEscapedStringsWithLLM(
  snippetText: string,
  oldString: string,
  newString: string,
  matchedText: string,
  context: ToolExecutionContext
): Promise<CorrectedEditStrings | null> {
  const clientFactory = context.createOpenAIClient;
  if (!clientFactory) {
    return null;
  }

  const { client, model, baseURL, thinkingEnabled, reasoningEffort } = clientFactory();
  if (!client) {
    return null;
  }

  try {
    const response = await client.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content:
            "You correct file-edit strings when the only problem is escaping. " +
            "Return XML only using <response><corrected_old_string>...</corrected_old_string><corrected_new_string>...</corrected_new_string></response>. " +
            "Do not change semantics; only fix quoting or escaping so corrected_old_string matches the snippet exactly.",
        },
        {
          role: "user",
          content:
            "<request>\n" +
            `  <snippet_text><![CDATA[${snippetText}]]></snippet_text>\n` +
            `  <old_string><![CDATA[${oldString}]]></old_string>\n` +
            `  <new_string><![CDATA[${newString}]]></new_string>\n` +
            `  <matched_text><![CDATA[${matchedText}]]></matched_text>\n` +
            "</request>\n" +
            "<output_format>\n" +
            "  <response>\n" +
            "    <corrected_old_string><![CDATA[...]]></corrected_old_string>\n" +
            "    <corrected_new_string><![CDATA[...]]></corrected_new_string>\n" +
            "  </response>\n" +
            "</output_format>",
        },
      ],
      ...buildThinkingRequestOptions(thinkingEnabled, baseURL, reasoningEffort),
    });

    const content = response.choices?.[0]?.message?.content ?? "";
    const parsed = parseCorrectedEditStrings(content);
    if (!parsed) {
      return null;
    }

    const normalizedOld = normalizeLooseText(oldString);
    const normalizedNew = normalizeLooseText(newString);
    if (normalizeLooseText(parsed.oldString) !== normalizedOld) {
      return null;
    }
    if (normalizeLooseText(parsed.newString) !== normalizedNew) {
      return null;
    }
    if (parsed.oldString === parsed.newString) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function parseCorrectedEditStrings(content: string): CorrectedEditStrings | null {
  const trimmed = content.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = trimmed.replace(/```(?:xml)?\s*([\s\S]*?)```/i, "$1").trim();
  const oldMatch = normalized.match(
    /<corrected_old_string>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))<\/corrected_old_string>/i
  );
  const newMatch = normalized.match(
    /<corrected_new_string>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))<\/corrected_new_string>/i
  );

  const correctedOldString = oldMatch?.[1] ?? oldMatch?.[2];
  const correctedNewString = newMatch?.[1] ?? newMatch?.[2];
  if (typeof correctedOldString === "string" && typeof correctedNewString === "string") {
    return {
      oldString: correctedOldString,
      newString: correctedNewString,
    };
  }

  return null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeLooseText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/\\+(?=["'`\\])/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function similarityScore(left: string, right: string): number {
  if (left === right) {
    return 1;
  }
  if (!left || !right) {
    return 0;
  }

  const leftBigrams = toBigrams(left);
  const rightBigrams = toBigrams(right);
  if (leftBigrams.length === 0 || rightBigrams.length === 0) {
    return left === right ? 1 : 0;
  }

  const rightCounts = new Map<string, number>();
  for (const bigram of rightBigrams) {
    rightCounts.set(bigram, (rightCounts.get(bigram) ?? 0) + 1);
  }

  let overlap = 0;
  for (const bigram of leftBigrams) {
    const count = rightCounts.get(bigram) ?? 0;
    if (count > 0) {
      overlap += 1;
      rightCounts.set(bigram, count - 1);
    }
  }

  return (2 * overlap) / (leftBigrams.length + rightBigrams.length);
}

function toBigrams(value: string): string[] {
  if (value.length < 2) {
    return [value];
  }

  const result: string[] = [];
  for (let index = 0; index < value.length - 1; index += 1) {
    result.push(value.slice(index, index + 2));
  }
  return result;
}

function sliceLines(raw: string, lineIndex: LineIndex, startLine: number, endLine: number): string {
  const startOffset = lineIndex.lineStarts[startLine];
  const endOffset = lineIndex.lineStarts[endLine + 1];
  return raw.slice(startOffset, endOffset);
}
