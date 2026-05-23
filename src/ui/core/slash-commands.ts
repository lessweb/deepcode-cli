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

const BUILTIN_SLASH_COMMAND_DEFS: Omit<SlashCommandItem, "description">[] = [
  { kind: "skills", name: "skills", label: "/skills" },
  { kind: "model", name: "model", label: "/model" },
  { kind: "new", name: "new", label: "/new" },
  { kind: "init", name: "init", label: "/init" },
  { kind: "resume", name: "resume", label: "/resume" },
  { kind: "continue", name: "continue", label: "/continue" },
  { kind: "undo", name: "undo", label: "/undo" },
  { kind: "mcp", name: "mcp", label: "/mcp" },
  { kind: "raw", name: "raw", label: "/raw", args: ["lite", "normal", "raw-scrollback"] },
  { kind: "exit", name: "exit", label: "/exit" },
  { kind: "config", name: "config", label: "/config" },
];

function getBuiltinDescription(kind: SlashCommandKind): string {
  switch (kind) {
    case "skills":
      return t("ui.slashCommands.skillsDesc");
    case "model":
      return t("ui.slashCommands.modelDesc");
    case "new":
      return t("ui.slashCommands.newDesc");
    case "init":
      return t("ui.slashCommands.initDesc");
    case "resume":
      return t("ui.slashCommands.resumeDesc");
    case "continue":
      return t("ui.slashCommands.continueDesc");
    case "undo":
      return t("ui.slashCommands.undoDesc");
    case "mcp":
      return t("ui.slashCommands.mcpDesc");
    case "raw":
      return t("ui.slashCommands.rawDesc");
    case "exit":
      return t("ui.slashCommands.exitDesc");
    case "config":
      return t("ui.slashCommands.configDesc");
    default:
      return t("ui.slashCommands.noDescription");
  }
}

export function getBuiltinSlashCommands(): SlashCommandItem[] {
  return BUILTIN_SLASH_COMMAND_DEFS.map((def) => ({
    ...def,
    description: getBuiltinDescription(def.kind),
  }));
}

/** Builtin slash command definitions (structural only, no translated descriptions).
 *  Use buildSlashCommands() for fully populated items with translated descriptions. */
export const BUILTIN_SLASH_COMMANDS: Pick<SlashCommandItem, "kind" | "name" | "label" | "args">[] =
  BUILTIN_SLASH_COMMAND_DEFS;

export function buildSlashCommands(skills: SkillInfo[]): SlashCommandItem[] {
  const skillItems: SlashCommandItem[] = skills.map((skill) => ({
    kind: "skill",
    name: skill.name,
    label: `/${skill.name}`,
    description: skill.description || t("ui.slashCommands.noDescription"),
    skill,
  }));
  const builtinItems: SlashCommandItem[] = BUILTIN_SLASH_COMMAND_DEFS.map((def) => ({
    ...def,
    description: getBuiltinDescription(def.kind),
  }));
  return [...skillItems, ...builtinItems];
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
