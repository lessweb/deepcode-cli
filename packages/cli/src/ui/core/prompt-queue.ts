/**
 * Presentation helpers for the supplemental prompt queue.
 *
 * The queue itself lives in `SessionManager` (`addSupplementaryPrompt`,
 * `cancelSupplementaryPrompt`, `listPendingSupplementaryPrompts`): each queued
 * prompt is appended to the conversation as a user message right before the next
 * LLM call of the running turn, so the model can revise its plan instead of
 * waiting for the turn to end.
 *
 * This module only formats what the CLI shows for the prompts that are still
 * waiting for that injection point.
 */

/**
 * Build the one-line label for a queued prompt. Whitespace is collapsed so
 * multi-line prompts stay on a single row, and prompts made of image
 * attachments only fall back to an image count.
 */
export function formatQueuedPromptPreview(text: string, imageCount = 0, maxLength = 60): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  const label = collapsed || (imageCount > 0 ? `[${imageCount} image${imageCount === 1 ? "" : "s"}]` : "");
  if (label.length <= maxLength) {
    return label;
  }
  return `${label.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

/** Footer hint describing how many prompts are still waiting for the next step. */
export function formatQueueHint(queuedCount: number): string {
  if (queuedCount <= 0) {
    return "";
  }
  return `${queuedCount} guidance queued · backspace to remove`;
}
