export type DiffLine = {
  kind: "added" | "removed" | "context";
  content: string;
  lineNumber: number | null;
};

export type DiffDetails = {
  added: number;
  removed: number;
  lines: DiffLine[];
};

/** Reads previews saved by the original generator, whose hunk counts exclude context. */
export function parseLegacyDiffPreview(preview: string): DiffDetails {
  const lines: DiffLine[] = [];
  let added = 0;
  let removed = 0;
  let oldLine: number | null = null;
  let newLine: number | null = null;
  let beforeChanges = false;
  let hasHunk = false;

  for (const raw of preview.split("\n")) {
    const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(raw);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[3]);
      removed += Number(hunk[2] ?? 1);
      added += Number(hunk[4] ?? 1);
      beforeChanges = true;
      hasHunk = true;
      continue;
    }
    // File headers only occur before the first hunk. Code can itself start with -- or ++.
    if (!hasHunk && (raw.startsWith("--- ") || raw.startsWith("+++ "))) continue;
    if (!raw) continue;
    if (raw[0] === "+" || raw[0] === "-") {
      const isAdded = raw[0] === "+";
      lines.push({
        kind: isAdded ? "added" : "removed",
        content: raw.slice(1),
        lineNumber: isAdded ? newLine : oldLine,
      });
      if (isAdded && newLine !== null) newLine++;
      if (!isAdded && oldLine !== null) oldLine++;
      if (!hasHunk) {
        if (isAdded) added++;
        else removed++;
      }
      beforeChanges = false;
    } else if (raw[0] === " ") {
      // The generator emits one preceding context line without including it in the hunk.
      const lineNumber = newLine === null ? null : beforeChanges ? Math.max(1, newLine - 1) : newLine;
      lines.push({ kind: "context", content: raw.slice(1), lineNumber });
      if (!beforeChanges) {
        if (oldLine !== null) oldLine++;
        if (newLine !== null) newLine++;
      }
    } else {
      lines.push({ kind: "context", content: raw, lineNumber: null });
    }
  }
  return { added, removed, lines };
}

/** Accepts stored tool metadata, falling back to the legacy preview for older sessions. */
export function getDiffDetails(metadata: Record<string, unknown> | null): DiffDetails | null {
  const details = metadata?.diff_details as DiffDetails | undefined;
  if (
    details &&
    Number.isInteger(details.added) &&
    details.added >= 0 &&
    Number.isInteger(details.removed) &&
    details.removed >= 0 &&
    Array.isArray(details.lines) &&
    details.lines.every(
      (line) =>
        line &&
        ["added", "removed", "context"].includes(line.kind) &&
        typeof line.content === "string" &&
        (line.lineNumber === null || (Number.isInteger(line.lineNumber) && line.lineNumber > 0))
    )
  ) {
    return details;
  }
  return typeof metadata?.diff_preview === "string" && metadata.diff_preview.trim()
    ? parseLegacyDiffPreview(metadata.diff_preview)
    : null;
}

export function getDiffFilePath(metadata: Record<string, unknown> | null): string {
  if (typeof metadata?.file_path === "string" && metadata.file_path) return metadata.file_path;
  const preview = typeof metadata?.diff_preview === "string" ? metadata.diff_preview : "";
  return /^\+\+\+ b\/(.*)$/m.exec(preview)?.[1] ?? "";
}
