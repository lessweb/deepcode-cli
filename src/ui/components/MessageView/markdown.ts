import chalk from "chalk";
import { getCurrentThemedChalk } from "../../theme";
import type { ThemedChalk } from "../../theme";

/**
 * A rendered piece of markdown.  Consumers should use `wrap="truncate-end"` for
 * `table` segments and the default wrap mode for `text` segments so that Ink
 * never breaks box-drawing lines at cell boundary spaces.
 */
export type MarkdownSegment =
  | { kind: "text"; body: string }
  | { kind: "table"; body: string }
  | { kind: "code"; body: string; lang: string };

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Render markdown to a single string (backward-compatible). */
export function renderMarkdown(text: string, maxWidth?: number): string {
  return renderMarkdownSegments(text, maxWidth)
    .map((s) => s.body)
    .reduce((out, body) => {
      if (!out) return body;
      if (!body) return out;
      return out.endsWith("\n") || body.startsWith("\n") ? out + body : `${out}\n${body}`;
    }, "");
}

/** Render markdown, returning typed segments so the caller can choose the
    right `<Text wrap>` per segment. */
export function renderMarkdownSegments(text: string, maxWidth?: number): MarkdownSegment[] {
  if (!text) return [];

  const segments: MarkdownSegment[] = [];
  const fenceSegments = splitByFences(text);

  const tc = getCurrentThemedChalk();
  for (const seg of fenceSegments) {
    if (seg.kind === "code") {
      const langTag = seg.lang ? tc.dim(`[${seg.lang}]`) + "\n" : "";
      segments.push({ kind: "code", body: langTag + tc.code(seg.body), lang: seg.lang });
      continue;
    }
    const blocks = splitTableBlocks(seg.body);
    for (const b of blocks) {
      if (b.kind === "table") {
        segments.push({ kind: "table", body: renderTableBorder(b.rows, maxWidth, tc) });
      } else {
        const body = b.body
          .split("\n")
          .map((line) => renderInlineLine(line))
          .join("\n");
        if (body) segments.push({ kind: "text", body });
      }
    }
  }

  return segments;
}

// ---------------------------------------------------------------------------
// Code fences
// ---------------------------------------------------------------------------

type FenceSegment = { kind: "text"; body: string } | { kind: "code"; lang: string; body: string };

function splitByFences(text: string): FenceSegment[] {
  const segments: FenceSegment[] = [];
  const lines = text.split(/\r?\n/);
  let buffer: string[] = [];
  let inFence = false;
  let fenceLang = "";
  let fenceBody: string[] = [];

  const flushText = () => {
    if (buffer.length > 0) {
      segments.push({ kind: "text", body: buffer.join("\n") });
      buffer = [];
    }
  };

  for (const line of lines) {
    const m = /^\s*```(\w*)\s*$/.exec(line);
    if (m) {
      if (!inFence) {
        flushText();
        inFence = true;
        fenceLang = m[1] ?? "";
        fenceBody = [];
      } else {
        segments.push({ kind: "code", lang: fenceLang, body: fenceBody.join("\n") });
        inFence = false;
      }
      continue;
    }
    (inFence ? fenceBody : buffer).push(line);
  }

  if (inFence) {
    segments.push({ kind: "code", lang: fenceLang, body: fenceBody.join("\n") });
  } else {
    flushText();
  }

  return segments;
}

// ---------------------------------------------------------------------------
// Table parsing
// ---------------------------------------------------------------------------

type TableBlock = { kind: "text"; body: string } | { kind: "table"; rows: string[][] };

function splitTableBlocks(text: string): TableBlock[] {
  const lines = text.split(/\r?\n/);
  const blocks: TableBlock[] = [];
  let buffer: string[] = [];
  let tableRows: string[][] = [];
  let inTable = false;

  const flushText = () => {
    if (buffer.length > 0) {
      blocks.push({ kind: "text", body: buffer.join("\n") });
      buffer = [];
    }
  };
  const flushTable = () => {
    if (tableRows.length >= 2) {
      blocks.push({ kind: "table", rows: tableRows });
    } else if (tableRows.length > 0) {
      buffer.push(...tableRows.map((r) => r.join(" | ")));
    }
    tableRows = [];
  };

  const sepRe = /^\|?\s*:?[-]{3,}:?\s*(\|\s*:?[-]{3,}:?\s*)*\|?\s*$/;
  const parseRow = (row: string) => {
    let body = row.trim();
    if (body.startsWith("|")) body = body.slice(1);
    if (body.endsWith("|")) body = body.slice(0, -1);
    return body.split("|").map((s) => s.trim());
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const nextTrimmed = (lines[i + 1] ?? "").trim();

    // skip separator line
    if (inTable && sepRe.test(trimmed) && tableRows.length === 1) continue;

    const isRow = /^\|.+\|$/.test(trimmed);
    const isHeader = isRow && i + 1 < lines.length && sepRe.test(nextTrimmed);

    if (isHeader && !inTable) {
      flushText();
      inTable = true;
      tableRows = [parseRow(trimmed)];
      continue;
    }

    if (isRow && inTable) {
      tableRows.push(parseRow(trimmed));
      continue;
    }

    if (inTable && !isRow) {
      flushTable();
      inTable = false;
    }
    buffer.push(line);
  }

  return inTable ? [...blocks, ...flushTableResult(tableRows)] : [...blocks, ...flushTextOnly(buffer, tableRows)];
}

function flushTableResult(rows: string[][]): TableBlock[] {
  if (rows.length >= 2) return [{ kind: "table", rows }];
  if (rows.length > 0) return [{ kind: "text", body: rows.map((r) => r.join(" | ")).join("\n") }];
  return [];
}

function flushTextOnly(buffer: string[], tableRows: string[][]): TableBlock[] {
  const result: TableBlock[] = [];
  if (buffer.length > 0) result.push({ kind: "text", body: buffer.join("\n") });
  if (tableRows.length >= 2) result.push({ kind: "table", rows: tableRows });
  else if (tableRows.length > 0) result.push({ kind: "text", body: tableRows.map((r) => r.join(" | ")).join("\n") });
  return result;
}

// ---------------------------------------------------------------------------
// Terminal visual width (CJK / emoji = 2 cols, ASCII = 1)
// ---------------------------------------------------------------------------

function visualWidth(text: string): number {
  let w = 0;
  for (const ch of text) {
    if (ch.length >= 2) {
      w += 2;
      continue;
    }
    const code = ch.codePointAt(0) ?? ch.charCodeAt(0);
    w += isWideChar(code) ? 2 : 1;
  }
  return w;
}

function isWideChar(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) || // Hangul Jamo
    (code >= 0x2329 && code <= 0x232a) || // Misc technical
    (code >= 0x2e80 && code <= 0xa4cf) || // CJK Radicals, Kangxi, CJK all
    (code >= 0xac00 && code <= 0xd7af) || // Hangul Syllables
    (code >= 0xf900 && code <= 0xfaff) || // CJK Compat
    (code >= 0xfe10 && code <= 0xfe6f) || // CJK Compat Forms
    (code >= 0xff00 && code <= 0xffe6) || // Fullwidth
    (code >= 0x20000 && code <= 0x3fffd) || // CJK Ext B+
    (code >= 0x1f300 && code <= 0x1faff) || // Emoji & pictographs
    (code >= 0x2600 && code <= 0x27bf) || // Misc Symbols
    (code >= 0x2300 && code <= 0x23ff) || // Misc Technical
    (code >= 0x2b00 && code <= 0x2bff) || // Misc Symbols & Arrows
    (code >= 0x1f000 && code <= 0x1f02f) // Mahjong & Domino
  );
}

// ---------------------------------------------------------------------------
// Table rendering
// ---------------------------------------------------------------------------

function renderTableBorder(rows: string[][], maxWidth?: number, tc?: ThemedChalk): string {
  if (rows.length === 0) return "";

  const colCount = rows[0].length;
  const normalizedRows = rows.map((row) =>
    Array.from({ length: colCount }, (_, i) => {
      return row[i] ?? "";
    })
  );
  const calcW = (cs: number[]) => cs.reduce((a, b) => a + b + 2, 0) + cs.length + 1;

  // Natural width per column, measured as terminal cells rather than UTF-16 units.
  const natural: number[] = Array.from({ length: colCount }, (_, i) => {
    const texts = normalizedRows.map((r) => r[i] ?? "");
    const maxLine = Math.max(4, ...texts.map((t) => visualWidth(t)));
    return maxLine;
  });

  // Keep minimums small so long CJK text or unbroken tokens can wrap by character.
  const minWidths: number[] = Array.from({ length: colCount }, (_, i) => {
    const headerWidth = visualWidth(normalizedRows[0]?.[i] ?? "");
    const labelColumn = natural[i] <= 12;
    const minReadable = labelColumn ? natural[i] : Math.max(4, Math.min(headerWidth, 12));
    return Math.min(natural[i], minReadable);
  });

  let colWidths: number[];
  const totalNatural = calcW(natural);
  const totalMin = calcW(minWidths);

  const effectiveMax = maxWidth ?? 120; // default to a generous terminal width

  if (totalNatural <= effectiveMax) {
    // Content fits comfortably — use natural widths and grow to fill available space
    colWidths = [...natural];
    const slack = effectiveMax - totalNatural;
    if (slack > 0) {
      // Distribute slack proportionally to content columns (skip tiny label columns)
      const isLabel = colWidths.map((w) => w <= 8);
      const candidates = colWidths.map((w, i) => (isLabel[i] ? 0 : w));
      const totalWeight = candidates.reduce((a, b) => a + b, 0);
      if (totalWeight > 0) {
        for (let ci = 0; ci < colCount; ci++) {
          if (candidates[ci] > 0) {
            colWidths[ci] += Math.floor((slack * candidates[ci]) / totalWeight);
          }
        }
      }
    }
  } else if (totalMin >= effectiveMax) {
    colWidths = [...minWidths];
    while (calcW(colWidths) > effectiveMax && colWidths.some((w) => w > 1)) {
      const widest = colWidths.reduce((maxIdx, width, idx) => (width > colWidths[maxIdx] ? idx : maxIdx), 0);
      colWidths[widest]--;
    }
  } else {
    // Need to compress — start from mins, share remaining budget proportionally
    const budget = effectiveMax - totalMin;
    const deficits = natural.map((n, i) => Math.max(0, n - minWidths[i]));
    const totalDeficit = deficits.reduce((a, b) => a + b, 0);
    colWidths = [...minWidths];
    if (totalDeficit > 0) {
      for (let ci = 0; ci < colCount; ci++) {
        colWidths[ci] += Math.floor((budget * deficits[ci]) / totalDeficit);
      }
    }
    // Distribute any leftover due to flooring
    let used = calcW(colWidths);
    const deficitByIdx = colWidths.map((w, i) => ({ i, gap: natural[i] - w }));
    deficitByIdx.sort((a, b) => b.gap - a.gap);
    for (const { i } of deficitByIdx) {
      if (used >= effectiveMax) break;
      if (colWidths[i] < natural[i]) {
        colWidths[i]++;
        used = calcW(colWidths);
      }
    }
  }

  // Word-wrap a single cell
  const wrapCell = (text: string, width: number): string[] => {
    if (!text) return [""];
    const lines: string[] = [];
    let cur = "";
    const flush = () => {
      if (cur.trim()) lines.push(cur.replace(/\s+$/, ""));
      cur = "";
    };

    for (const ch of text) {
      const cw = visualWidth(ch);
      if (visualWidth(cur) + cw > width) {
        const lastSpace = cur.lastIndexOf(" ");
        if (lastSpace > width / 3) {
          const carry = cur.slice(lastSpace + 1);
          cur = cur.slice(0, lastSpace);
          flush();
          cur = carry + ch;
        } else {
          flush();
          cur = ch;
        }
      } else {
        cur += ch;
      }
    }
    if (cur.trim()) lines.push(cur.replace(/\s+$/, ""));
    return lines.length > 0 ? lines : [""];
  };

  const wrapped = normalizedRows.map((r) => r.map((c, ci) => wrapCell(c, colWidths[ci])));
  const heights = wrapped.map((wr) => Math.max(1, ...wr.map((lines) => lines.length)));

  const pad = (s: string, w: number) => s + " ".repeat(Math.max(0, w - visualWidth(s)));

  const b = tc?.tableBorder ?? ((s: string) => s);
  const top = b("┌") + colWidths.map((w) => b("─".repeat(w + 2))).join(b("┬")) + b("┐");
  const hdr = b("├") + colWidths.map((w) => b("─".repeat(w + 2))).join(b("┼")) + b("┤");
  const sep = b("├") + colWidths.map((w) => b("─".repeat(w + 2))).join(b("┼")) + b("┤");
  const bot = b("└") + colWidths.map((w) => b("─".repeat(w + 2))).join(b("┴")) + b("┘");

  const out: string[] = [top];

  for (let ri = 0; ri < wrapped.length; ri++) {
    const h = heights[ri];
    for (let li = 0; li < h; li++) {
      const line = wrapped[ri].map((cellLines, ci) => " " + pad(cellLines[li] ?? "", colWidths[ci]) + " ");
      out.push(b("│") + line.join(b("│")) + b("│"));
    }
    if (ri === 0 && rows.length > 1) out.push(hdr);
    else if (ri < rows.length - 1) out.push(sep);
  }

  out.push(bot);
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// Inline formatting (headings, lists, quotes, bold/italic/code)
// ---------------------------------------------------------------------------

function renderInlineLine(line: string): string {
  const tc = getCurrentThemedChalk();
  const headingMatch = /^(\s*)(#{1,6})\s+(.*)$/.exec(line);
  if (headingMatch) {
    const [, lead, hashes, content] = headingMatch;
    const styled = hashes.length <= 2 ? tc.heading1(content) : tc.heading3(content);
    return `${lead}${tc.dim(hashes)} ${styled}`;
  }

  const listMatch = /^(\s*)([-*+])\s+(.*)$/.exec(line);
  if (listMatch) {
    const [, lead, bullet, content] = listMatch;
    return `${lead}${tc.listBullet(bullet)} ${renderInlineSpans(content)}`;
  }

  const numListMatch = /^(\s*)(\d+\.)\s+(.*)$/.exec(line);
  if (numListMatch) {
    const [, lead, marker, content] = numListMatch;
    return `${lead}${tc.listBullet(marker)} ${renderInlineSpans(content)}`;
  }

  const quoteMatch = /^(\s*)>\s?(.*)$/.exec(line);
  if (quoteMatch) {
    const [, lead, content] = quoteMatch;
    return `${lead}${tc.quote("│ ")}${chalk.italic(renderInlineSpans(content))}`;
  }

  return renderInlineSpans(line);
}

function renderInlineSpans(text: string): string {
  if (!text) return text;
  const tc = getCurrentThemedChalk();

  const parts: string[] = [];
  const codeRe = /`([^`]+)`/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = codeRe.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(renderEmphasisSpans(text.slice(lastIndex, match.index)));
    }
    parts.push(chalk.cyan(match[1] ?? ""));
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(renderEmphasisSpans(text.slice(lastIndex)));
  }

  return parts.join("");
}

function renderEmphasisSpans(text: string): string {
  let result = text;
  result = result.replace(/`([^`]+)`/g, (_, inner) => tc.inlineCode(inner));
  result = result.replace(/\*\*([^*]+)\*\*/g, (_, inner) => tc.bold(inner));
  result = result.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, (_, inner) => tc.italic(inner));
  result = result.replace(/_([^_\n]+)_/g, (_, inner) => tc.italic(inner));
  result = result.replace(/\*\*([^*]+)\*\*/g, (_, inner) => chalk.bold(inner));
  result = result.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, (_, inner) => chalk.italic(inner));
  result = result.replace(/(?<![\p{L}\p{N}_])_([^_\n]+)_(?![\p{L}\p{N}_])/gu, (_, inner) => chalk.italic(inner));
  return result;
}
