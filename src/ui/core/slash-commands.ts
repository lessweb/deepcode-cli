import { t } from "../../common/i18n";
import type { SkillInfo } from "../../session";

export type SlashCommandKind =
  | "skill"
  | "skills"
  | "model"
  | "new"
  | "init"
  | "resume"
  | "continue"
  | "undo"
  | "mcp"
  | "config"
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
    description: t("ui.slashCommands.skillsDesc"),
  },
  {
    kind: "model",
    name: "model",
    label: "/model",
    description: t("ui.slashCommands.modelDesc"),
  },
  {
    kind: "new",
    name: "new",
    label: "/new",
    description: t("ui.slashCommands.newDesc"),
  },
  {
    kind: "init",
    name: "init",
    label: "/init",
    description: t("ui.slashCommands.initDesc"),
  },
  {
    kind: "resume",
    name: "resume",
    label: "/resume",
    description: t("ui.slashCommands.resumeDesc"),
  },
  {
    kind: "continue",
    name: "continue",
    label: "/continue",
    description: "Continue the active conversation or pick one to resume",
  },
  {
    kind: "undo",
    name: "undo",
    label: "/undo",
    description: t("ui.slashCommands.undoDesc"),
  },
  {
    kind: "mcp",
    name: "mcp",
    label: "/mcp",
    description: t("ui.slashCommands.mcpDesc"),
  },
  {
    kind: "raw",
    name: "raw",
    label: "/raw",
    args: ["lite", "normal", "raw-scrollback"],
    description: t("ui.slashCommands.rawDesc"),
  },
  {
    kind: "exit",
    name: "exit",
    label: "/exit",
    description: t("ui.slashCommands.exitDesc"),
  },
  {
    kind: "config",
    name: "config",
    label: "/config",
    description: t("ui.slashCommands.configDesc"),
  },
];

export function buildSlashCommands(skills: SkillInfo[]): SlashCommandItem[] {
  const skillItems: SlashCommandItem[] = skills.map((skill) => ({
    kind: "skill",
    name: skill.name,
    label: `/${skill.name}`,
    description: skill.description || t("ui.slashCommands.noDescription"),
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
  return items.filter((item) => item.name.toLowerCase().includes(query));
}

export function findExactSlashCommand(items: SlashCommandItem[], token: string): SlashCommandItem | null {
  if (!token.startsWith("/")) {
    return null;
  }
  const query = token.slice(1);
  const matches = items.filter((item) => item.name === query);
  return matches.find((item) => item.kind !== "skill") ?? matches[0] ?? null;
}

export function formatSlashCommandDescription(description: string): string {
  return (description || t("ui.slashCommands.noDescription")).trim().replace(/\s+/g, " ");
}

export function formatSlashCommandLabel(item: SlashCommandItem): string {
  return item.kind === "skill" && item.skill?.isLoaded ? `${item.label} ✓` : item.label;
}
