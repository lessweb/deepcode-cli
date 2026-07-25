export type MemoryCategory = "decision" | "error_fix" | "user_feedback" | "milestone" | "pending";

export type MemoryFact = {
  id: string;
  category: MemoryCategory;
  summary: string;
  detail?: string;
  relatedFiles?: string[];
  relatedEntities?: string[];
  createdAt: string;
  turn: number;
};

type ScoredFact = { fact: MemoryFact; score: number };

const factsBySession = new Map<string, MemoryFact[]>();
let factIdCounter = 0;

function nextFactId(): string {
  factIdCounter += 1;
  return `fact_${factIdCounter}`;
}

export class ConversationMemory {
  addFact(sessionId: string, fact: Omit<MemoryFact, "id" | "createdAt">): MemoryFact {
    const entry: MemoryFact = {
      ...fact,
      id: nextFactId(),
      createdAt: new Date().toISOString(),
    };

    let sessionFacts = factsBySession.get(sessionId);
    if (!sessionFacts) {
      sessionFacts = [];
      factsBySession.set(sessionId, sessionFacts);
    }
    sessionFacts.push(entry);
    return entry;
  }

  search(sessionId: string, query: string, options: { category?: MemoryCategory; limit?: number } = {}): MemoryFact[] {
    const sessionFacts = factsBySession.get(sessionId);
    if (!sessionFacts || sessionFacts.length === 0) {
      return [];
    }

    const limit = options.limit ?? 5;
    const lowerQuery = query.toLowerCase();
    const scored: ScoredFact[] = [];

    for (const fact of sessionFacts) {
      if (options.category && fact.category !== options.category) {
        continue;
      }

      let score = 0;
      if (fact.summary.toLowerCase().includes(lowerQuery)) {
        score += 50;
      }
      if (fact.detail?.toLowerCase().includes(lowerQuery)) {
        score += 30;
      }
      if (fact.relatedFiles?.some((f) => f.toLowerCase().includes(lowerQuery))) {
        score += 20;
      }
      if (fact.relatedEntities?.some((e) => e.toLowerCase().includes(lowerQuery))) {
        score += 15;
      }

      if (score > 0) {
        scored.push({ fact, score });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((s) => s.fact);
  }

  getPending(sessionId: string): MemoryFact[] {
    const sessionFacts = factsBySession.get(sessionId);
    if (!sessionFacts) {
      return [];
    }
    return sessionFacts.filter((f) => f.category === "pending");
  }

  getRecentErrors(sessionId: string, count = 5): MemoryFact[] {
    const sessionFacts = factsBySession.get(sessionId);
    if (!sessionFacts) {
      return [];
    }
    return sessionFacts
      .filter((f) => f.category === "error_fix")
      .slice(-count)
      .reverse();
  }

  renderForInjection(sessionId: string, maxFacts = 10): string {
    const sessionFacts = factsBySession.get(sessionId);
    if (!sessionFacts || sessionFacts.length === 0) {
      return "";
    }

    const lines: string[] = [];

    // Group by category
    const decisions = sessionFacts.filter((f) => f.category === "decision");
    const errors = sessionFacts.filter((f) => f.category === "error_fix");
    const pending = sessionFacts.filter((f) => f.category === "pending");

    let count = 0;

    if (decisions.length > 0) {
      lines.push("## Key Decisions");
      for (const fact of decisions) {
        if (count >= maxFacts) {
          break;
        }
        lines.push(`- ${fact.summary}`);
        count += 1;
      }
    }

    if (errors.length > 0) {
      lines.push("\n## Errors & Fixes");
      for (const fact of errors.slice(-3)) {
        if (count >= maxFacts) {
          break;
        }
        lines.push(`- ${fact.summary}`);
        count += 1;
      }
    }

    if (pending.length > 0) {
      lines.push("\n## Pending");
      for (const fact of pending) {
        if (count >= maxFacts) {
          break;
        }
        lines.push(`- ${fact.summary}`);
        count += 1;
      }
    }

    return lines.join("\n");
  }

  clearSession(sessionId: string): void {
    factsBySession.delete(sessionId);
  }
}
