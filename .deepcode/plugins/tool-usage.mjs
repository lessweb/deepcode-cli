const TOOL_ORDER = ["bash", "edit", "read", "write", "AskUserQuestion", "UpdatePlan", "WebSearch"];

export default function toolUsageProvider({ session }) {
  if (!session || !session.activeSessionId) {
    return "";
  }
  const usage = session.toolUsage;
  if (!usage || Object.keys(usage).length === 0) {
    return "";
  }
  // Sort: preferred order first, then by count desc
  const sorted = Object.entries(usage).sort((a, b) => {
    const ai = TOOL_ORDER.indexOf(a[0]);
    const bi = TOOL_ORDER.indexOf(b[0]);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return b[1] - a[1];
  });

  const shortNames = sorted.slice(0, 6);
  return shortNames.map(([name, count]) => `${name}×${count}`).join(" ");
}
