import { getDiffDetails, getDiffFilePath } from "@vegamo/deepcode-core";

/** Adds display data for older sessions without changing their persisted messages. */
export function prepareToolDiffContent(role: string, content: string | null): string | null {
  if (role !== "tool" || !content) return content;
  try {
    const payload = JSON.parse(content);
    if (!payload || payload.ok === false || !["edit", "write"].includes(String(payload.name).toLowerCase())) {
      return content;
    }
    const details = getDiffDetails(payload.metadata);
    if (!details) return content;
    return JSON.stringify({
      ...payload,
      metadata: { ...payload.metadata, file_path: getDiffFilePath(payload.metadata), diff_details: details },
    });
  } catch {
    return content;
  }
}
