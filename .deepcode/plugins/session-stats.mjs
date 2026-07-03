function formatTokens(n) {
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return String(n);
}

export default function sessionStatsProvider({ session }) {
  if (!session || !session.activeSessionId) {
    return "no session";
  }
  const parts = [];
  parts.push(`msgs:${session.messageCount}`);
  if (session.requestCount > 0) {
    parts.push(`reqs:${session.requestCount}`);
  }
  if (session.activeTokens > 0 && session.maxContextTokens > 0) {
    const pct = Math.round((session.activeTokens / session.maxContextTokens) * 100);
    parts.push(`ctx:${formatTokens(session.activeTokens)}/${formatTokens(session.maxContextTokens)} ${pct}%`);
  } else if (session.totalTokens > 0) {
    parts.push(`tokens:${formatTokens(session.totalTokens)}`);
  }
  return parts.join(" ");
}
