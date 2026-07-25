import type { SessionMessage } from "../session";
import { CodeIndex } from "./code-index";
import type { MemoryCategory } from "./conversation-memory";
import { ConversationMemory } from "./conversation-memory";

const SOFT_COMPACT_MAX_LENGTH = 2000;

export type RecallResult = {
  category: "code" | "fact";
  entries: Array<{
    type?: string;
    name?: string;
    signature?: string;
    filePath?: string;
    summary?: string;
    detail?: string;
    category?: string;
  }>;
};

export class ContextManager {
  private codeIndex = new CodeIndex();
  private memory = new ConversationMemory();
  private turnCounters = new Map<string, number>();

  // ---- Lifecycle ----

  onToolMessage(sessionId: string, message: SessionMessage): void {
    const turn = this.nextTurn(sessionId);

    if (message.role !== "tool" || typeof message.content !== "string") {
      return;
    }

    const result = parseToolResult(message.content);
    if (!result) {
      return;
    }

    const toolName = result.name as string;

    if (toolName === "read") {
      const filePath = extractFilePath(result.metadata);
      if (filePath && result.output) {
        this.codeIndex.extractFromToolOutput(result.output, filePath, turn, sessionId);
      }
    } else if (toolName === "write" || toolName === "edit") {
      const filePath = extractFilePath(result.metadata);
      if (filePath) {
        const filePaths: string[] = [];
        if (typeof result.metadata?.file_path === "string") {
          filePaths.push(result.metadata.file_path);
        }
        this.memory.addFact(sessionId, {
          category: "milestone",
          summary: `${toolName} ${filePath}`,
          relatedFiles: filePaths,
          turn,
        });

        // For edit, try to extract from diff content (new_string)
        if (result.metadata?.diff_preview) {
          const diffPreview = String(result.metadata.diff_preview);
          this.codeIndex.extractFromToolOutput(diffPreview, filePath, turn, sessionId);
        }
      }
    } else if (toolName === "bash") {
      if (result.ok === false && result.error) {
        this.memory.addFact(sessionId, {
          category: "error_fix",
          summary: result.error.slice(0, 200),
          turn,
        });
      }
    }
  }

  onAssistantMessage(sessionId: string, content: string | null): void {
    if (!content) {
      return;
    }
    const turn = this.nextTurn(sessionId);

    // Detect decision markers
    const decisionPatterns = [
      /(?:I(?:'ll| will)|let(?:'s| us)) ([\w\s-]{20,120})[.!]/gi,
      /(?:decided|chose|opted) to ([\w\s-]{20,120})[.!]/gi,
    ];

    for (const pattern of decisionPatterns) {
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(content)) !== null) {
        const summary = match[1]?.trim();
        if (summary && summary.length >= 20) {
          this.memory.addFact(sessionId, {
            category: "decision",
            summary: summary.slice(0, 200),
            turn,
          });
        }
      }
    }

    // Detect fixed/resolved errors
    const fixPattern =
      /(?:fixed|resolved|solved)\s+(?:the\s+)?(?:issue|error|bug|problem)[:\s]*([\w\s-]{15,120})[.!]/gi;
    let fixMatch: RegExpExecArray | null;
    while ((fixMatch = fixPattern.exec(content)) !== null) {
      const summary = fixMatch[1]?.trim();
      if (summary) {
        this.memory.addFact(sessionId, {
          category: "error_fix",
          summary: `Fixed: ${summary.slice(0, 180)}`,
          turn,
        });
      }
    }
  }

  // ---- Compaction ----

  async buildCompactionInjection(sessionId: string): Promise<string> {
    const parts: string[] = [];

    const codeLines = this.codeIndex.renderForInjection(sessionId, 500);
    if (codeLines) {
      parts.push("## Code Index (entities observed in this session)");
      parts.push(codeLines);
    }

    const memoryLines = this.memory.renderForInjection(sessionId, 10);
    if (memoryLines) {
      parts.push(memoryLines);
    }

    if (parts.length === 0) {
      return "";
    }

    return `<context_index>\n${parts.join("\n\n")}\n</context_index>`;
  }

  // ---- Soft compaction (keep code blocks) ----

  buildSoftCompactedToolResult(rawOutput: string): string {
    if (!rawOutput || rawOutput.length <= SOFT_COMPACT_MAX_LENGTH) {
      return rawOutput;
    }

    // Keep the first part and extract code blocks
    const codeBlocks = extractCodeBlocks(rawOutput);
    const head = rawOutput.slice(0, Math.floor(SOFT_COMPACT_MAX_LENGTH * 0.6)).trim();
    const tail = rawOutput.slice(-Math.floor(SOFT_COMPACT_MAX_LENGTH * 0.2)).trim();

    const parts: string[] = [head];
    if (codeBlocks.length > 0) {
      parts.push(`\n// ... ${codeBlocks.length} code block(s) preserved ...\n`);
      for (const block of codeBlocks.slice(0, 3)) {
        parts.push(block.slice(0, 500));
      }
    }
    parts.push(`\n... (${rawOutput.length} chars total, truncated)\n`);
    parts.push(tail);

    return parts.join("\n");
  }

  // ---- Recall / Search ----

  recall(
    sessionId: string,
    query: string,
    options: { category?: string; filePath?: string; limit?: number } = {}
  ): RecallResult {
    const limit = options.limit ?? 5;

    if (options.category === "code" || !options.category || options.category === "all") {
      const codeEntities = this.codeIndex.search(sessionId, query, {
        filePath: options.filePath,
        type: undefined,
        limit,
      });
      if (codeEntities.length > 0) {
        return {
          category: "code",
          entries: codeEntities.map((e) => ({
            type: e.type,
            name: e.name,
            signature: e.signature,
            filePath: e.filePath,
          })),
        };
      }
    }

    if (options.category === "fact" || !options.category || options.category === "all") {
      const facts = this.memory.search(sessionId, query, {
        category: options.category as MemoryCategory | undefined,
        limit,
      });
      if (facts.length > 0) {
        return {
          category: "fact",
          entries: facts.map((f) => ({
            summary: f.summary,
            detail: f.detail,
            category: f.category,
          })),
        };
      }
    }

    return { category: options.category === "fact" ? "fact" : "code", entries: [] };
  }

  // ---- Query ----

  getMemory(): ConversationMemory {
    return this.memory;
  }

  getCodeIndex(): CodeIndex {
    return this.codeIndex;
  }

  clearSession(sessionId: string): void {
    this.codeIndex.clearSession(sessionId);
    this.memory.clearSession(sessionId);
    this.turnCounters.delete(sessionId);
  }

  // ---- Internal ----

  private nextTurn(sessionId: string): number {
    const current = this.turnCounters.get(sessionId) ?? 0;
    const next = current + 1;
    this.turnCounters.set(sessionId, next);
    return next;
  }
}

// ---- Helpers ----

type ParsedToolResult = {
  ok?: boolean;
  name?: string;
  output?: string;
  error?: string;
  metadata?: Record<string, unknown>;
} | null;

function parseToolResult(content: string): ParsedToolResult {
  try {
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as ParsedToolResult;
    }
  } catch {
    // Not JSON — skip
  }
  return null;
}

function extractFilePath(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") {
    return null;
  }
  const meta = metadata as Record<string, unknown>;

  // read tool: metadata.snippet.filePath
  const snippet = meta.snippet;
  if (snippet && typeof snippet === "object" && !Array.isArray(snippet)) {
    const filePath = (snippet as Record<string, unknown>).filePath;
    if (typeof filePath === "string") {
      return filePath;
    }
  }

  // write/edit tool: metadata.file_path
  if (typeof meta.file_path === "string") {
    return meta.file_path;
  }

  return null;
}

function extractCodeBlocks(text: string): string[] {
  const blocks: string[] = [];
  const re = /```[\s\S]*?```/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    blocks.push(match[0]);
  }
  return blocks;
}
