// Fit a single-line preview to a pixel budget using the caller's actual font metrics.
window.fitThinkingPreview = function (text, availableWidth, measure) {
  if (!text || availableWidth <= 0) return "";
  if (measure(`[${text}]`) <= availableWidth) return `[${text}]`;

  const parts = Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text));
  let low = 0;
  let high = parts.length;
  let result = "";
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = `[...${text.slice(parts[middle].index)}]`;
    if (measure(candidate) <= availableWidth) {
      result = candidate;
      high = middle;
    } else {
      low = middle + 1;
    }
  }
  return result;
};
