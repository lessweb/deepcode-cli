/**
 * Server slash-command route metadata.
 *
 * Summary:
 * Maps supported DeepCode runtime slash commands to HTTP route metadata for the
 * local server. This module is intentionally independent from the CLI slash
 * command table so server behavior does not depend on terminal UI code.
 *
 * Exports:
 * - buildHeadlessCommandRoutes(): HeadlessCommandRoute[]
 * - findHeadlessCommandRoute(pathname: string): HeadlessCommandRoute | null
 */
export type HeadlessCommandRoute = {
  name: string;
  label: string;
  description: string;
  method: "GET" | "POST";
  path: string;
  aliases: string[];
  implemented: boolean;
};

type RuntimeCommand = {
  name: string;
  label: string;
  description: string;
};

const RUNTIME_COMMANDS: RuntimeCommand[] = [
  { name: "skills", label: "/skills", description: "List available skills" },
  { name: "model", label: "/model", description: "Select model, thinking mode and effort control" },
  { name: "new", label: "/new", description: "Start a fresh conversation" },
  { name: "init", label: "/init", description: "Initialize an AGENTS.md file with instructions for LLM" },
  { name: "resume", label: "/resume", description: "Pick a previous conversation to continue" },
  { name: "continue", label: "/continue", description: "Continue the active conversation or pick one to resume" },
  { name: "undo", label: "/undo", description: "Restore code and/or conversation to a previous point" },
  { name: "mcp", label: "/mcp", description: "Show MCP server status and available tools" },
  { name: "raw", label: "/raw", description: "CLI display mode command; no backend raw display state is exposed" },
  { name: "exit", label: "/exit", description: "Quit Deep Code server" },
];

const READ_ONLY_COMMANDS = new Set(["skills", "resume", "mcp", "model"]);
const IMPLEMENTED_COMMANDS = new Set(["skills", "new", "init", "resume", "continue", "undo", "mcp", "model", "exit"]);

function commandMethod(command: RuntimeCommand): "GET" | "POST" {
  return READ_ONLY_COMMANDS.has(command.name) ? "GET" : "POST";
}

function commandAliases(command: RuntimeCommand): string[] {
  if (command.name === "model") {
    return ["/model"];
  }
  return [`/${command.name}`, `/api/${command.name}`];
}

export function buildHeadlessCommandRoutes(): HeadlessCommandRoute[] {
  return RUNTIME_COMMANDS.map((command) => ({
    name: command.name,
    label: command.label,
    description: command.description,
    method: commandMethod(command),
    path: `/${command.name}`,
    aliases: commandAliases(command),
    implemented: IMPLEMENTED_COMMANDS.has(command.name),
  }));
}

export function findHeadlessCommandRoute(pathname: string): HeadlessCommandRoute | null {
  const normalized = pathname.replace(/\/+$/u, "") || "/";
  return buildHeadlessCommandRoutes().find((route) => route.aliases.includes(normalized)) ?? null;
}
