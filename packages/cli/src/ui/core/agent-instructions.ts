export type AgentInstructionSource = {
  displayPath: string;
  absolutePath: string;
  exists: boolean;
  loaded: boolean;
};

/** Render a human-readable report of which AGENTS.md files exist and which one is loaded. (#262) */
export function buildAgentInstructionsReport(sources: AgentInstructionSource[]): string {
  const lines = sources.map((source) => {
    const status = source.exists ? (source.loaded ? "loaded" : "present") : "not found";
    return `${source.displayPath} — ${status}`;
  });
  const loaded = sources.find((source) => source.loaded);
  const header = loaded
    ? `Agent instructions loaded from ${loaded.displayPath}`
    : "No AGENTS.md instruction file found (default system prompt only)";
  return `${header}\n${lines.join("\n")}`;
}
