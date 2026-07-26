export type CodeEntityType = "function" | "class" | "interface" | "type" | "enum" | "import" | "const";

export type CodeEntity = {
  type: CodeEntityType;
  name: string;
  signature: string;
  filePath: string;
  lineNumber?: number;
  capturedAt: string;
  sessionTurn: number;
};

type ScoredEntity = { entity: CodeEntity; score: number };

// Extraction patterns ordered by specificity (classes before functions to avoid
// partial matches on "function" inside class bodies).
const ENTITY_PATTERNS: Array<{ type: CodeEntityType; regex: RegExp }> = [
  // export class Foo / class Foo
  {
    type: "class",
    regex:
      /(?:export\s+(?:abstract\s+)?)?class\s+(\w+)(?:\s+extends\s+[\w.]+(?:\s*<[^>]*>)?)?(?:\s+implements\s+[\w,\s]+)?\s*\{?/g,
  },
  // export interface Foo / interface Foo
  {
    type: "interface",
    regex: /(?:export\s+)?interface\s+(\w+)(?:\s+extends\s+[\w,\s]+)?\s*\{?/g,
  },
  // export type Foo = / type Foo =
  { type: "type", regex: /(?:export\s+)?type\s+(\w+)\s*=/g },
  // export enum Foo / enum Foo
  { type: "enum", regex: /(?:export\s+)?enum\s+(\w+)\s*\{?/g },
  // export async function / async function / function
  {
    type: "function",
    regex: /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)(?:\s*:\s*[^{]+)?/g,
  },
  // arrow const: export const foo = (...) => / const foo = (...) =>
  {
    type: "function",
    regex: /(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)(?:\s*:\s*[^=]+)?\s*=>/g,
  },
  // import { x } from 'y' / import x from 'y'
  {
    type: "import",
    regex: /import\s+(?:(?:\{[^}]*\}|[\w*]+)\s*(?:,\s*(?:\{[^}]*\}|\w+))?\s*from\s*)?['"]([^'"]+)['"]/g,
  },
  // const Foo = (class name is not a const)
  { type: "const", regex: /(?:export\s+)?const\s+(\w+)\s*[:=]/g },
  // Python: class Foo / def foo( (allow leading whitespace for indented methods)
  { type: "class", regex: /^\s*class\s+(\w+)\s*(?:\([^)]*\))?\s*:/gm },
  { type: "function", regex: /^\s*(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)(?:\s*->\s*\S+)?\s*:/gm },
];

const entitiesBySession = new Map<string, CodeEntity[]>();
const entityIdsBySession = new Map<string, Set<string>>();

function entityKey(entity: CodeEntity): string {
  return `${entity.filePath}:${entity.type}:${entity.name}`;
}

export class CodeIndex {
  extractFromToolOutput(output: string, filePath: string, sessionTurn: number, sessionId: string): void {
    if (!output || !filePath) {
      return;
    }

    const now = new Date().toISOString();

    let sessionEntities = entitiesBySession.get(sessionId);
    if (!sessionEntities) {
      sessionEntities = [];
      entitiesBySession.set(sessionId, sessionEntities);
    }

    let sessionEntityIds = entityIdsBySession.get(sessionId);
    if (!sessionEntityIds) {
      sessionEntityIds = new Set<string>();
      entityIdsBySession.set(sessionId, sessionEntityIds);
    }

    for (const { type, regex } of ENTITY_PATTERNS) {
      // Clone regex to reset lastIndex for each iteration
      const re = new RegExp(regex.source, regex.flags);
      let match: RegExpExecArray | null;

      while ((match = re.exec(output)) !== null) {
        const name = match[1];
        if (!name || isKeywordExcluded(name)) {
          continue;
        }

        // Find the line number
        const matchPos = match.index;
        const precedingLines = output.slice(0, matchPos).split("\n");
        const lineNumber = precedingLines.length;

        // Capture the full match line as signature
        const lineStart = output.lastIndexOf("\n", matchPos) + 1;
        const lineEnd = output.indexOf("\n", matchPos);
        const signature = (lineEnd === -1 ? output.slice(lineStart) : output.slice(lineStart, lineEnd)).trim();

        const entity: CodeEntity = {
          type,
          name,
          signature: signature.length > 200 ? signature.slice(0, 197) + "..." : signature,
          filePath,
          lineNumber,
          capturedAt: now,
          sessionTurn,
        };

        const key = entityKey(entity);
        if (sessionEntityIds.has(key)) {
          continue; // Deduplicate
        }

        sessionEntityIds.add(key);
        sessionEntities.push(entity);
      }
    }
  }

  search(
    sessionId: string,
    query: string,
    options: { filePath?: string; type?: CodeEntityType; limit?: number } = {}
  ): CodeEntity[] {
    const entities = entitiesBySession.get(sessionId);
    if (!entities || entities.length === 0) {
      return [];
    }

    const limit = options.limit ?? 5;
    const lowerQuery = query.toLowerCase();
    const scored: ScoredEntity[] = [];

    for (const entity of entities) {
      if (options.filePath && !entity.filePath.includes(options.filePath)) {
        continue;
      }
      if (options.type && entity.type !== options.type) {
        continue;
      }

      let score = 0;
      if (entity.name.toLowerCase() === lowerQuery) {
        score += 100;
      } else if (entity.name.toLowerCase().includes(lowerQuery)) {
        score += 50;
      }
      if (entity.signature.toLowerCase().includes(lowerQuery)) {
        score += 20;
      }
      if (entity.filePath.toLowerCase().includes(lowerQuery)) {
        score += 10;
      }

      if (score > 0) {
        scored.push({ entity, score });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((s) => s.entity);
  }

  getByFile(sessionId: string, filePath: string): CodeEntity[] {
    const entities = entitiesBySession.get(sessionId);
    if (!entities) {
      return [];
    }
    return entities.filter((e) => e.filePath === filePath);
  }

  renderForInjection(sessionId: string, maxTokens = 500): string {
    const entities = entitiesBySession.get(sessionId);
    if (!entities || entities.length === 0) {
      return "";
    }

    // Group by file
    const byFile = new Map<string, CodeEntity[]>();
    for (const entity of entities) {
      const list = byFile.get(entity.filePath) ?? [];
      list.push(entity);
      byFile.set(entity.filePath, list);
    }

    const lines: string[] = [];
    let estimatedTokens = 0;
    const tokenBudget = maxTokens;

    for (const [filePath, fileEntities] of byFile) {
      const header = `### ${filePath}`;
      const headerTokens = estimateTokens(header);
      if (estimatedTokens + headerTokens > tokenBudget) {
        break;
      }
      lines.push(header);
      estimatedTokens += headerTokens;

      for (const entity of fileEntities) {
        const line = `- ${entity.type} \`${entity.name}\``;
        const lineTokens = estimateTokens(line);
        if (estimatedTokens + lineTokens > tokenBudget) {
          lines.push("- ... (truncated)");
          return lines.join("\n");
        }
        lines.push(line);
        estimatedTokens += lineTokens;
      }
    }

    return lines.join("\n");
  }

  pruneFromTurn(sessionId: string, turn: number): void {
    const entities = entitiesBySession.get(sessionId);
    if (!entities) {
      return;
    }
    const kept = entities.filter((e) => e.sessionTurn <= turn);
    entitiesBySession.set(sessionId, kept);

    const ids = entityIdsBySession.get(sessionId);
    if (ids) {
      const keptIds = new Set<string>();
      for (const e of kept) {
        keptIds.add(entityKey(e));
      }
      entityIdsBySession.set(sessionId, keptIds);
    }
  }

  clearSession(sessionId: string): void {
    entitiesBySession.delete(sessionId);
    entityIdsBySession.delete(sessionId);
  }
}

function isKeywordExcluded(name: string): boolean {
  const excluded = new Set([
    "if",
    "for",
    "while",
    "do",
    "switch",
    "case",
    "try",
    "catch",
    "throw",
    "return",
    "break",
    "continue",
    "new",
    "delete",
    "typeof",
    "instanceof",
    "void",
    "this",
    "super",
    "true",
    "false",
    "null",
    "undefined",
    "import",
    "export",
    "default",
    "from",
    "as",
    "class",
    "function",
    "const",
    "let",
    "var",
    "async",
    "await",
    "yield",
    "static",
    "get",
    "set",
    "public",
    "private",
    "protected",
    "constructor",
    "extends",
    "implements",
    "interface",
    "type",
    "enum",
    "namespace",
    "module",
    "declare",
    "abstract",
    "readonly",
  ]);
  return excluded.has(name);
}

function estimateTokens(text: string): number {
  let tokens = 0;
  for (const char of text) {
    tokens += /[\u3400-\u9fff\uf900-\ufaff]/u.test(char) ? 0.6 : 0.3;
  }
  return Math.ceil(tokens);
}
