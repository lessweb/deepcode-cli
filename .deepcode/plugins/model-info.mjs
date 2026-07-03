export default function modelInfoProvider({ session }) {
  if (!session) return "";
  const parts = [];
  if (session.model) {
    parts.push(session.model);
  }
  if (session.thinkingEnabled && session.reasoningEffort) {
    parts.push(`thinking:${session.reasoningEffort}`);
  } else if (session.thinkingEnabled) {
    parts.push("thinking");
  }
  return parts.join(" ");
}
