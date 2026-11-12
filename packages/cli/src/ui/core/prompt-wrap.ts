import ansiRegex from "ansi-regex";
import stringWidth from "string-width";
import wrapAnsi from "wrap-ansi";

const graphemes = new Intl.Segmenter();
const cjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

type Cell = { text: string; width: number; separate: boolean; space: boolean };

/** Preserve Latin words while allowing a line break between CJK graphemes. */
export function wrapPromptText(text: string, columns: number): string {
  const width = Math.max(1, columns);
  if (!cjk.test(text)) return wrapAnsi(text, width, { trim: false, hard: true });

  const wrapped = text
    .normalize()
    .replaceAll("\r\n", "\n")
    .split("\n")
    .map((line) => wrapCjkLine(line, width))
    .join("\n");

  // Close and reopen ANSI styles at inserted line breaks, without regrouping
  // the CJK characters into words. This also keeps inline cursor styling local.
  return wrapAnsi(wrapped, width, { trim: false, hard: true, wordWrap: false });
}

function wrapCjkLine(line: string, width: number): string {
  const cells: Cell[] = [];
  let pendingAnsi = "";
  let logicalColumn = 0;
  const appendText = (text: string) => {
    for (const { segment } of graphemes.segment(text)) {
      const value = segment === "\t" ? " ".repeat(8 - (logicalColumn % 8)) : segment;
      const parts = segment === "\t" ? Array.from(value) : [value];
      for (const part of parts) {
        const cellWidth = stringWidth(part);
        cells.push({
          text: pendingAnsi + part,
          width: cellWidth,
          separate: part === " " || cjk.test(part),
          space: part === " ",
        });
        pendingAnsi = "";
        logicalColumn += cellWidth;
      }
    }
  };

  let offset = 0;
  for (const match of line.matchAll(ansiRegex())) {
    appendText(line.slice(offset, match.index));
    pendingAnsi += match[0];
    offset = match.index + match[0].length;
  }
  appendText(line.slice(offset));

  const output: string[] = [];
  let column = 0;
  const newline = () => {
    output.push("\n");
    column = 0;
  };
  const appendWord = (word: Cell[]) => {
    const wordWidth = word.reduce((total, cell) => total + cell.width, 0);
    if (wordWidth <= width) {
      if (column > 0 && column + wordWidth > width) newline();
    } else {
      // Match wrap-ansi's handling of oversized Latin words: move the word
      // first only when doing so avoids an extra line break.
      const breaksHere = 1 + Math.floor((wordWidth - (width - column) - 1) / width);
      const breaksNext = Math.floor((wordWidth - 1) / width);
      if (column > 0 && breaksNext < breaksHere) newline();
    }
    for (const cell of word) {
      if (column > 0 && column + cell.width > width) newline();
      output.push(cell.text);
      column += cell.width;
    }
  };

  let word: Cell[] = [];
  for (const cell of cells) {
    if (!cell.separate) {
      word.push(cell);
      continue;
    }
    appendWord(word);
    word = [];
    if (cell.space) {
      if (column >= width) newline();
      output.push(cell.text);
      column += cell.width;
    } else {
      appendWord([cell]);
    }
  }
  appendWord(word);
  output.push(pendingAnsi);
  return output.join("");
}
