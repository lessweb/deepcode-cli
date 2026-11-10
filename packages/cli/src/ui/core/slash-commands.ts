export * from "@vegamo/deepcode-core/common/slash-commands";

import type { SlashCommandKind } from "@vegamo/deepcode-core/common/slash-commands";

export function isBusyCommandAllowed(kind: SlashCommandKind): boolean {
  return ["copy", "model", "experimental", "permissions", "raw", "skills", "mcp", "undo"].includes(kind);
}
