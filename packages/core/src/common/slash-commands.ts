import type { SkillInfo } from "../session";

export type SlashCommandKind =
  | "skill"
  | "skills"
  | "model"
  | "experimental"
  | "permissions"
  | "plan"
  | "new"
  | "init"
  | "resume"
  | "fork"
  | "continue"
  | "compact"
  | "copy"
  | "undo"
  | "mcp"
  | "raw"
  | "exit";

export type SlashCommandItem = {
  kind: SlashCommandKind;
  name: string;
  label: string;
  description: string;
  skill?: SkillInfo;
  args?: string[];
};

export const BUILTIN_SLASH_COMMANDS: SlashCommandItem[] = [
  {
    kind: "skills",
    name: "skills",
    label: "/skills",
    description: "List available skills",
  },
  {
    kind: "model",
    name: "model",
    label: "/model",
    description: "Select model, thinking mode and effort control",
  },
  {
    kind: "experimental",
    name: "experimental",
    label: "/experimental",
    description: "Configure experimental features",
  },
  {
    kind: "permissions",
    name: "permissions",
    label: "/permissions",
    description: "Configure tool permissions",
  },
  {
    kind: "plan",
    name: "plan",
    label: "/plan",
    description: "Switch the input to Plan Mode",
  },
  {
    kind: "new",
    name: "new",
    label: "/new",
    description: "Start a fresh conversation",
  },
  {
    kind: "init",
    name: "init",
    label: "/init",
    description: "Initialize an AGENTS.md file with instructions for LLM",
  },
  {
    kind: "resume",
    name: "resume",
    label: "/resume",
    description: "Pick a previous conversation to continue",
  },
  {
    kind: "fork",
    name: "fork",
    label: "/fork",
    description: "Fork the current conversation",
  },
  {
    kind: "continue",
    name: "continue",
    label: "/continue",
    description: "Continue the active conversation or pick one to resume",
  },
  {
    kind: "compact",
    name: "compact",
    label: "/compact",
    description: "Compact the current conversation",
  },
  {
    kind: "copy",
    name: "copy",
    label: "/copy",
    description: "Copy the last assistant message",
  },
  {
    kind: "undo",
    name: "undo",
    label: "/undo",
    description: "Restore code and/or conversation to a previous point",
  },
  {
    kind: "mcp",
    name: "mcp",
    label: "/mcp",
    description: "Show MCP server status and available tools",
  },
  {
    kind: "raw",
    name: "raw",
    label: "/raw",
    args: ["lite", "normal", "raw-scrollback"],
    description: "Toggle display mode for viewing or collapsing reasoning content",
  },
  {
    kind: "exit",
    name: "exit",
    label: "/exit",
    description: "Quit Deep Code CLI",
  },
];

export function buildSlashCommands(skills: SkillInfo[]): SlashCommandItem[] {
  const skillItems: SlashCommandItem[] = skills.map((skill) => ({
    kind: "skill",
    name: skill.name,
    label: `/${skill.name}`,
    description: skill.description || "(no description)",
    skill,
  }));
  return [...skillItems, ...BUILTIN_SLASH_COMMANDS];
}

export function filterSlashCommands(items: SlashCommandItem[], token: string): SlashCommandItem[] {
  if (!token.startsWith("/")) {
    return [];
  }
  const query = token.slice(1).toLowerCase();
  if (!query) {
    return items;
  }
  const prefixMatches: SlashCommandItem[] = [];
  const otherMatches: SlashCommandItem[] = [];
  for (const item of items) {
    const name = item.name.toLowerCase();
    if (name.startsWith(query)) {
      prefixMatches.push(item);
    } else if (name.includes(query)) {
      otherMatches.push(item);
    }
  }
  return [...prefixMatches, ...otherMatches];
}

export function findExactSlashCommand(items: SlashCommandItem[], token: string): SlashCommandItem | null {
  if (!token.startsWith("/")) {
    return null;
  }
  const query = token.slice(1);
  const matches = items.filter((item) => item.name === query);
  return matches.find((item) => item.kind !== "skill") ?? matches[0] ?? null;
}

export type SlashSubmission =
  | { kind: "command"; item: SlashCommandItem }
  | { kind: "plan"; item: SlashCommandItem; text: string }
  | { kind: "raw"; item: SlashCommandItem; mode: string }
  | { kind: "argument-error"; item: SlashCommandItem; argument: string };

/**
 * Classify a submitted slash input without touching UI state. A command alone
 * runs as before; `/plan <text>` is a one-shot plan-mode prompt; `/raw <mode>`
 * selects that mode and reports an unknown mode. Other commands keep their
 * existing behavior and ignore trailing text.
 */
export function resolveSlashSubmission(items: SlashCommandItem[], text: string): SlashSubmission | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) {
    return null;
  }
  const match = /^(\S+)([\s\S]*)$/.exec(trimmed);
  if (!match) {
    return null;
  }
  const item = findExactSlashCommand(items, match[1]);
  if (!item) {
    return null;
  }
  const rest = match[2].trim();
  if (!rest) {
    return { kind: "command", item };
  }
  if (item.kind === "plan") {
    return { kind: "plan", item, text: rest };
  }
  if (item.kind === "raw") {
    if (item.args?.includes(rest)) {
      return { kind: "raw", item, mode: rest };
    }
    return { kind: "argument-error", item, argument: rest };
  }
  // Other commands keep their existing behavior and ignore trailing text.
  return { kind: "command", item };
}

export function formatSlashCommandDescription(description: string): string {
  return (description || "(no description)").trim().replace(/\s+/g, " ");
}

export function formatSlashCommandLabel(item: SlashCommandItem): string {
  return item.kind === "skill" && item.skill?.isLoaded ? `${item.label} ✓` : item.label;
}

export function getSlashToken(text: string): string | null {
  return text.startsWith("/") ? text : null;
}
