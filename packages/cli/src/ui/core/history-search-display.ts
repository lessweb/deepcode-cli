import stringWidth from "string-width";

export function historySearchFooter(query: string, width: number): { prefix: string; query: string; column: number } {
  const prefix = "reverse-i-search: ".slice(0, Math.max(0, width - 1));
  const available = Math.max(0, width - stringWidth(prefix) - 1);
  const characters = Array.from(query.replace(/\n/g, "↵").replace(/\t/g, "⇥"));
  let display = "";
  let size = 0;
  for (let index = characters.length - 1; index >= 0; index--) {
    const next = stringWidth(characters[index]);
    if (size + next > available) break;
    display = characters[index] + display;
    size += next;
  }
  return { prefix, query: display, column: stringWidth(prefix) + size };
}

/** Map lowercase offsets back to source offsets (some Unicode letters change length when folded). */
export function historyMatchRange(text: string, query: string): { start: number; end: number } | null {
  if (!query) return null;
  const lower = text.toLowerCase();
  const index = lower.indexOf(query.toLowerCase());
  if (index < 0) return null;
  let source = 0;
  let folded = 0;
  let start = 0;
  const end = index + query.toLowerCase().length;
  for (const char of text) {
    const next = folded + char.toLowerCase().length;
    if (folded <= index && index < next) start = source;
    source += char.length;
    folded = next;
    if (folded >= end) return { start, end: source };
  }
  return null;
}
