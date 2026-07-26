import { test } from "node:test";
import assert from "node:assert/strict";
import { CodeIndex } from "../common/code-index";
import type { CodeEntity } from "../common/code-index";
import { ConversationMemory } from "../common/conversation-memory";
import { ContextManager } from "../common/context-manager";

const sessionId = "context-test-session";

// ---- CodeIndex Tests ----

test("CodeIndex extracts TypeScript functions", () => {
  const code = `
export async function handleRecallTool(
  args: Record<string, unknown>,
  context: ToolExecutionContext
): Promise<ToolExecutionResult> {
  return executeValidatedTool("Recall", recallSchema, args, context, async (input) => {
`;

  const index = new CodeIndex();
  index.extractFromToolOutput(code, "src/tools/recall-handler.ts", 1, sessionId);

  const entities = index.getByFile(sessionId, "src/tools/recall-handler.ts");
  const functions = entities.filter((e) => e.type === "function");
  assert.ok(functions.length >= 1, "should find at least one function");
  assert.equal(functions[0]!.name, "handleRecallTool");
});

test("CodeIndex extracts classes and interfaces", () => {
  const code = `
export class CodeIndex {
  extractFromToolOutput() {}
  search() {}
}

export type CodeEntity = {
  type: CodeEntityType;
  name: string;
};

export interface SearchOptions {
  filePath?: string;
  limit?: number;
}
`;

  const index = new CodeIndex();
  index.extractFromToolOutput(code, "src/code-index.ts", 1, sessionId);

  const entities = index.getByFile(sessionId, "src/code-index.ts");
  const classes = entities.filter((e) => e.type === "class");
  const types = entities.filter((e) => e.type === "type");
  const interfaces = entities.filter((e) => e.type === "interface");

  assert.equal(classes.length, 1);
  assert.equal(classes[0]!.name, "CodeIndex");
  assert.equal(types.length, 1);
  assert.equal(types[0]!.name, "CodeEntity");
  assert.equal(interfaces.length, 1);
  assert.equal(interfaces[0]!.name, "SearchOptions");
});

test("CodeIndex extracts Python classes and functions", () => {
  const code = `
class UserService:
    def __init__(self, db: Database) -> None:
        self.db = db

    async def create_user(self, name: str, email: str) -> User:
        pass
`;

  const index = new CodeIndex();
  index.extractFromToolOutput(code, "src/services.py", 1, sessionId);

  const entities = index.getByFile(sessionId, "src/services.py");
  const classes = entities.filter((e) => e.type === "class");
  const functions = entities.filter((e) => e.type === "function");

  assert.equal(classes.length, 1);
  assert.equal(classes[0]!.name, "UserService");
  assert.equal(functions[0]!.name, "__init__");
  assert.equal(functions[1]!.name, "create_user");
});

test("CodeIndex search returns ranked results", () => {
  const index = new CodeIndex();
  index.extractFromToolOutput("function handleRecallTool() {}", "src/a.ts", 1, sessionId);
  index.extractFromToolOutput("function handleRecallTool() {}", "src/a.ts", 1, sessionId); // duplicate
  index.extractFromToolOutput("class RecallHandler {}", "src/b.ts", 1, sessionId);

  const results = index.search(sessionId, "recall");
  assert.ok(results.length >= 2);
  // Most relevant should be the function with matching name
  assert.equal(results[0]!.name, "handleRecallTool");
});

test("CodeIndex search filters by filePath", () => {
  const index = new CodeIndex();
  index.extractFromToolOutput("function foo() {}", "src/a.ts", 1, sessionId);
  index.extractFromToolOutput("function bar() {}", "src/b.ts", 1, sessionId);

  const results = index.search(sessionId, "foo", { filePath: "a.ts" });
  assert.equal(results.length, 1);
  assert.equal(results[0]!.name, "foo");
});

test("CodeIndex excludes reserved keywords", () => {
  const code = `
if (true) return;
for (const x of items) break;
class ValidClass {}
`;

  const index = new CodeIndex();
  index.extractFromToolOutput(code, "src/test.ts", 1, sessionId);

  const entities = index.getByFile(sessionId, "src/test.ts");
  // Only ValidClass should be extracted (no if, for, return, break, const)
  assert.equal(entities.length, 1);
  assert.equal(entities[0]!.name, "ValidClass");
});

test("CodeIndex renderForInjection groups by file", () => {
  const index = new CodeIndex();
  index.extractFromToolOutput("class A {}", "src/a.ts", 1, sessionId);
  index.extractFromToolOutput("class B {}", "src/b.ts", 1, sessionId);

  const text = index.renderForInjection(sessionId, 200);
  assert.ok(text.includes("### src/a.ts"));
  assert.ok(text.includes("### src/b.ts"));
  assert.ok(text.includes("class `A`"));
  assert.ok(text.includes("class `B`"));
});

// ---- ConversationMemory Tests ----

test("ConversationMemory addFact and search", () => {
  const mem = new ConversationMemory();
  mem.addFact(sessionId, { category: "decision", summary: "Use regex-based extraction", turn: 1 });
  mem.addFact(sessionId, { category: "error_fix", summary: "Fixed null pointer in UserService", turn: 2 });

  const results = mem.search(sessionId, "regex");
  assert.equal(results.length, 1);
  assert.equal(results[0]!.summary, "Use regex-based extraction");
});

test("ConversationMemory category filter", () => {
  const mem = new ConversationMemory();
  mem.addFact(sessionId, { category: "error_fix", summary: "Fixed bug", turn: 1 });
  mem.addFact(sessionId, { category: "decision", summary: "Chose approach A", turn: 2 });

  const errors = mem.search(sessionId, "bug", { category: "error_fix" });
  assert.equal(errors.length, 1);
  assert.equal(errors[0]!.summary, "Fixed bug");
});

test("ConversationMemory getPending", () => {
  const mem = new ConversationMemory();
  mem.addFact(sessionId, { category: "pending", summary: "Write tests", turn: 1 });
  mem.addFact(sessionId, { category: "pending", summary: "Update docs", turn: 2 });
  mem.addFact(sessionId, { category: "decision", summary: "Use TypeScript", turn: 3 });

  const pending = mem.getPending(sessionId);
  assert.equal(pending.length, 2);
});

test("ConversationMemory renderForInjection", () => {
  const mem = new ConversationMemory();
  mem.addFact(sessionId, { category: "decision", summary: "Use regex extraction", turn: 1 });
  mem.addFact(sessionId, { category: "error_fix", summary: "Fixed type error", turn: 2 });
  mem.addFact(sessionId, { category: "pending", summary: "Add more tests", turn: 3 });

  const text = mem.renderForInjection(sessionId, 10);
  assert.ok(text.includes("## Key Decisions"));
  assert.ok(text.includes("## Errors & Fixes"));
  assert.ok(text.includes("## Pending"));
});

// ---- ContextManager Tests ----

test("ContextManager buildCompactionInjection returns structured markup", async () => {
  const manager = new ContextManager();

  // Simulate a read tool result
  const readMsg = {
    id: "msg-1",
    sessionId,
    role: "tool" as const,
    content: JSON.stringify({
      ok: true,
      name: "read",
      output: "class Foo { bar() {} }",
      metadata: { snippet: { filePath: "src/foo.ts", startLine: 1, endLine: 10 } },
    }),
    contentParams: null,
    messageParams: null,
    compacted: false,
    visible: true,
    createTime: new Date().toISOString(),
    updateTime: new Date().toISOString(),
  };
  manager.onToolMessage(sessionId, readMsg);

  // Add a decision
  manager.onAssistantMessage(
    sessionId,
    "I decided to use regex-based extraction for code entities. This approach is simpler and faster than tree-sitter."
  );

  const injection = await manager.buildCompactionInjection(sessionId);
  assert.ok(injection.includes("<context_index>"));
  assert.ok(injection.includes("## Code Index"));
  assert.ok(injection.includes("class `Foo`"));
  assert.ok(injection.includes("## Key Decisions"));
});

test("ContextManager recall searches code and facts", () => {
  const manager = new ContextManager();

  const readMsg = {
    id: "msg-1",
    sessionId,
    role: "tool" as const,
    content: JSON.stringify({
      ok: true,
      name: "read",
      output: "function createUser(name: string): User {}",
      metadata: { snippet: { filePath: "src/user.ts", startLine: 1, endLine: 10 } },
    }),
    contentParams: null,
    messageParams: null,
    compacted: false,
    visible: true,
    createTime: new Date().toISOString(),
    updateTime: new Date().toISOString(),
  };
  manager.onToolMessage(sessionId, readMsg);

  manager.onAssistantMessage(sessionId, "I decided to create a UserService class for all user operations.");

  const codeResults = manager.recall(sessionId, "createUser");
  assert.equal(codeResults.category, "code");
  assert.ok(codeResults.entries.length >= 1);
  assert.equal(codeResults.entries[0]!.name, "createUser");

  const factResults = manager.recall(sessionId, "UserService");
  assert.ok(factResults.entries.length >= 1);
});

test("ContextManager buildSoftCompactedToolResult preserves code blocks", () => {
  const manager = new ContextManager();
  const long = "x".repeat(1000) + "\n```\nconst x = 1;\n```\n" + "y".repeat(1000);

  const compacted = manager.buildSoftCompactedToolResult(long);
  assert.ok(compacted.includes("code block(s) preserved"));
  assert.ok(compacted.includes("const x = 1"));
  assert.ok(compacted.includes("truncated"));
});
