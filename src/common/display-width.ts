/**
 * Returns the visual display width of a string in a terminal.
 *
 * CJK characters (Chinese, Japanese, Korean) typically occupy 2 columns,
 * while ASCII characters and most symbols occupy 1 column.
 * Emoji surrogate pairs are also counted as 2.
 */
export function displayWidth(value: string): number {
  let width = 0;
  for (const char of value) {
    const code = char.codePointAt(0)!;
    if (code > 0xffff) {
      // Surrogate pair (emoji etc.) — typically 2 wide
      width += 2;
    } else if (
      (code >= 0x1100 && code <= 0x115f) || // Hangul Jamo
      (code >= 0x2e80 && code <= 0xa4cf) || // CJK Radicals, Kangxi, Ideographs
      (code >= 0xa960 && code <= 0xa97f) || // Hangul Jamo Extended-A
      (code >= 0xac00 && code <= 0xd7a3) || // Hangul Syllables
      (code >= 0xf900 && code <= 0xfaff) || // CJK Compatibility Ideographs
      (code >= 0xfe30 && code <= 0xfe6f) || // CJK Compatibility Forms
      (code >= 0xff01 && code <= 0xff60) || // Fullwidth Forms
      (code >= 0xffe0 && code <= 0xffe6) // Fullwidth Signs
    ) {
      width += 2;
    } else {
      width += 1;
    }
  }
  return width;
}

/**
 * Truncate a string to roughly `maxCols` visual display columns.
 *
 * Uses `displayWidth()` so CJK text is counted correctly (2 cols per char).
 * Avoids splitting surrogate pairs (emoji) by checking character boundaries.
 * Appends "…" when truncated.
 */
export function truncateDisplay(value: string, maxCols: number): string {
  let cols = 0;
  for (let i = 0; i < value.length; i++) {
    const charWidth = displayWidth(value[i]);
    if (cols + charWidth > maxCols) {
      return value.slice(0, i) + "…";
    }
    cols += charWidth;
  }
  return value;
}
