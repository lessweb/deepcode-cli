import type { AgentManifest } from "./agent-registry";

/**
 * Formats the discovered agent list for display in the CLI.
 * Used by the `/agents` command handler to show agent metadata.
 */
export function formatAgentsList(agents: AgentManifest[]): string {
  if (agents.length === 0) {
    return "No sub-agents discovered.\n\nTo add agents, create an AGENT.md file in:\n- .deepcode/agents/<name>/AGENT.md\n- .agents/<name>/AGENT.md";
  }

  const lines: string[] = ["## Available Sub-Agents\n"];
  for (const agent of agents) {
    lines.push(`### ${agent.name}`);
    if (agent.description) {
      lines.push(`- **Description**: ${agent.description}`);
    }
    lines.push(`- **Model**: ${agent.model}`);
    lines.push(`- **Source**: ${agent.sourceRoot}`);
    if (agent.skills.length > 0) {
      lines.push(`- **Skills**: ${agent.skills.join(", ")}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
