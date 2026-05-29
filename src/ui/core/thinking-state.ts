import type { SessionMessage } from "../../session";

/**
 * Returns the message id of the assistant "thinking" message that should stay
 * expanded — i.e. the most recent thinking message after the most recent
 * non-thinking assistant message. Mirrors the VS Code extension's bubble
 * collapse logic: at most one thinking bubble is open, and it is closed once a
 * regular assistant reply arrives.
 */
export function findExpandedThinkingId(messages: SessionMessage[]): string | null {
  let expanded: string | null = null;
  for (const message of messages) {
    if (message.role !== "assistant") {
      continue;
    }
    if (message.meta?.asThinking) {
      expanded = message.id;
    } else {
      expanded = null;
    }
  }
  return expanded;
}

/**
 * Returns whether a message's thinking block should be rendered collapsed.
 * A thinking message is collapsed when its id does not match the currently
 * expanded thinking id.
 */
export function isCollapsedThinking(message: SessionMessage, expandedId: string | null): boolean {
  if (message.role !== "assistant") {
    return false;
  }
  if (!message.meta?.asThinking) {
    return false;
  }
  return message.id !== expandedId;
}
