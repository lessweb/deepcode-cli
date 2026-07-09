import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { AgentRegistry } from "../agents/agent-registry";
import { createDelegateToAgentHandler } from "../agents/delegate-handler";
import type { DelegateHandlerOptions } from "../agents/delegate-handler";
import type { CreateOpenAIClient } from "../common/tool-types";
import type { ToolExecutor } from "../tools/executor";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function createTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

/**
 * Helper to create an AGENT.md file in a given scan root under a named subdirectory.
 */
function createAgentMd(scanRoot: string, dirName: string, content: string): string {
  const agentDir = path.join(scanRoot, dirName);
  fs.mkdirSync(agentDir, { recursive: true });
  const manifestPath = path.join(agentDir, "AGENT.md");
  fs.writeFileSync(manifestPath, content, "utf8");
  return manifestPath;
}

/**
 * Generates a valid AGENT.md content string.
 */
function makeAgentMd(opts: {
  name?: string;
  description?: string;
  model?: string;
  skills?: string[];
  body?: string;
}): string {
  const frontmatterParts: string[] = [];
  if (opts.name !== undefined) frontmatterParts.push(`name: ${opts.name}`);
  if (opts.description !== undefined) frontmatterParts.push(`description: "${opts.description}"`);
  if (opts.model !== undefined) frontmatterParts.push(`model: ${opts.model}`);
  if (opts.skills !== undefined) {
    frontmatterParts.push(`skills:`);
    for (const skill of opts.skills) {
      frontmatterParts.push(`  - ${skill}`);
    }
  }

  const frontmatter = frontmatterParts.length > 0 ? `---\n${frontmatterParts.join("\n")}\n---\n` : `---\n---\n`;

  return `${frontmatter}\n${opts.body ?? "# Default Instructions\n\nYou are a helpful agent."}`;
}

/**
 * Creates a mock CreateOpenAIClient that returns a simple text response without tool calls.
 */
function makeMockCreateOpenAIClient(responseText = "Sub-agent task completed."): CreateOpenAIClient {
  return () => ({
    client: {
      chat: {
        completions: {
          create: async () => ({
            choices: [
              {
                message: {
                  role: "assistant",
                  content: responseText,
                  tool_calls: undefined,
                },
                finish_reason: "stop",
              },
            ],
          }),
        },
      },
    } as unknown,
    model: "test-model",
    baseURL: undefined,
    thinkingEnabled: false,
    debugLogEnabled: false,
  });
}

/**
 * Creates a mock ToolExecutor.
 */
function makeMockToolExecutor(): ToolExecutor {
  return {
    executeToolCalls: async (_sessionId: string, toolCalls: unknown[]) => {
      const calls = toolCalls as Array<{ id: string; function: { name: string; arguments: string } }>;
      return calls.map((tc) => ({
        toolCallId: tc.id,
        content: JSON.stringify({ ok: true, name: tc.function.name, output: "done" }),
        result: { ok: true, name: tc.function.name, output: "done" },
      }));
    },
  } as unknown as ToolExecutor;
}

/**
 * Sets up a registry with multiple agents and returns the handler options.
 */
function setupHandlerWithAgents(agentConfigs: Array<{ name: string; description?: string; body?: string }>): {
  handler: ReturnType<typeof createDelegateToAgentHandler>;
  options: DelegateHandlerOptions;
} {
  const projectRoot = createTempDir("deepcode-delegate-handler-");
  const agentsRoot = path.join(projectRoot, ".deepcode", "agents");

  for (const config of agentConfigs) {
    createAgentMd(
      agentsRoot,
      config.name,
      makeAgentMd({
        name: config.name,
        description: config.description ?? `${config.name} agent`,
        body: config.body ?? `# ${config.name}\n\nYou are the ${config.name} agent.`,
      })
    );
  }

  const registry = new AgentRegistry(projectRoot);
  registry.scan();

  const options: DelegateHandlerOptions = {
    agentRegistry: registry,
    projectRoot,
    parentModel: "parent-model",
    createOpenAIClient: makeMockCreateOpenAIClient(),
    toolExecutor: makeMockToolExecutor(),
    globalSkillRoots: [],
  };

  const handler = createDelegateToAgentHandler(options);
  return { handler, options };
}

// =============================================================================
// Property 8: Agent name validation in DelegateToAgent handler
// =============================================================================
// **Validates: Requirements 4.4, 4.5**
//
// For any `agent_name` string passed to the DelegateToAgent handler:
// if it matches a discovered agent name, execution SHALL proceed to spawn
// a sub-agent session; if it does not match, the handler SHALL return an
// error whose message contains all available agent names.

describe("Property 8: Agent name validation in DelegateToAgent handler", () => {
  test("unknown agent_name returns error listing all available agents", async () => {
    const { handler } = setupHandlerWithAgents([
      { name: "alpha-agent", description: "Alpha" },
      { name: "beta-agent", description: "Beta" },
      { name: "gamma-agent", description: "Gamma" },
    ]);

    const result = await handler({ agent_name: "nonexistent-agent", task: "do something" });

    assert.equal(result.ok, false);
    assert.ok(result.error, "Should have an error message");
    // Error should mention the unknown agent name
    assert.ok(result.error!.includes("nonexistent-agent"), "Error should reference the unknown agent name");
    // Error should list all available agents
    assert.ok(result.error!.includes("alpha-agent"), "Error should list available agent: alpha-agent");
    assert.ok(result.error!.includes("beta-agent"), "Error should list available agent: beta-agent");
    assert.ok(result.error!.includes("gamma-agent"), "Error should list available agent: gamma-agent");
  });

  test("empty agent_name returns 'Missing required parameter' error", async () => {
    const { handler } = setupHandlerWithAgents([{ name: "test-agent" }]);

    const result = await handler({ agent_name: "", task: "do something" });

    assert.equal(result.ok, false);
    assert.ok(result.error, "Should have an error message");
    assert.ok(
      result.error!.includes("Missing required parameter"),
      `Error should indicate missing parameter, got: ${result.error}`
    );
  });

  test("missing agent_name field returns 'Missing required parameter' error", async () => {
    const { handler } = setupHandlerWithAgents([{ name: "test-agent" }]);

    const result = await handler({ task: "do something" });

    assert.equal(result.ok, false);
    assert.ok(result.error, "Should have an error message");
    assert.ok(
      result.error!.includes("Missing required parameter"),
      `Error should indicate missing parameter, got: ${result.error}`
    );
  });

  test("empty task returns 'Missing required parameter' error", async () => {
    const { handler } = setupHandlerWithAgents([{ name: "test-agent" }]);

    const result = await handler({ agent_name: "test-agent", task: "" });

    assert.equal(result.ok, false);
    assert.ok(result.error, "Should have an error message");
    assert.ok(
      result.error!.includes("Missing required parameter"),
      `Error should indicate missing parameter, got: ${result.error}`
    );
  });

  test("missing task field returns 'Missing required parameter' error", async () => {
    const { handler } = setupHandlerWithAgents([{ name: "test-agent" }]);

    const result = await handler({ agent_name: "test-agent" });

    assert.equal(result.ok, false);
    assert.ok(result.error, "Should have an error message");
    assert.ok(
      result.error!.includes("Missing required parameter"),
      `Error should indicate missing parameter, got: ${result.error}`
    );
  });

  test("valid agent_name + task proceeds and returns successful result", async () => {
    const projectRoot = createTempDir("deepcode-delegate-valid-");
    const agentsRoot = path.join(projectRoot, ".deepcode", "agents");

    createAgentMd(
      agentsRoot,
      "my-agent",
      makeAgentMd({
        name: "my-agent",
        description: "A test agent",
        body: "# My Agent\n\nYou help with testing.",
      })
    );

    const registry = new AgentRegistry(projectRoot);
    registry.scan();

    const options: DelegateHandlerOptions = {
      agentRegistry: registry,
      projectRoot,
      parentModel: "parent-model",
      createOpenAIClient: makeMockCreateOpenAIClient("Task completed successfully."),
      toolExecutor: makeMockToolExecutor(),
      globalSkillRoots: [],
    };

    const handler = createDelegateToAgentHandler(options);
    const result = await handler({ agent_name: "my-agent", task: "Write a unit test" });

    assert.equal(result.ok, true);
    assert.equal(result.output, "Task completed successfully.");
    assert.equal(result.error, undefined);
  });

  test("valid agent_name but sub-agent error returns ok=false with error", async () => {
    const projectRoot = createTempDir("deepcode-delegate-error-");
    const agentsRoot = path.join(projectRoot, ".deepcode", "agents");

    createAgentMd(
      agentsRoot,
      "failing-agent",
      makeAgentMd({
        name: "failing-agent",
        description: "An agent that fails",
        body: "# Failing Agent\n\nYou always fail.",
      })
    );

    const registry = new AgentRegistry(projectRoot);
    registry.scan();

    // Mock client that throws an error
    const failingClient: CreateOpenAIClient = () => ({
      client: {
        chat: {
          completions: {
            create: async () => {
              throw new Error("LLM service unavailable");
            },
          },
        },
      } as unknown,
      model: "test-model",
      baseURL: undefined,
      thinkingEnabled: false,
      debugLogEnabled: false,
    });

    const options: DelegateHandlerOptions = {
      agentRegistry: registry,
      projectRoot,
      parentModel: "parent-model",
      createOpenAIClient: failingClient,
      toolExecutor: makeMockToolExecutor(),
      globalSkillRoots: [],
    };

    const handler = createDelegateToAgentHandler(options);
    const result = await handler({ agent_name: "failing-agent", task: "Do something" });

    assert.equal(result.ok, false);
    assert.ok(result.error, "Should have an error message");
    assert.ok(
      result.error!.includes("LLM service unavailable") || result.error!.includes("failed"),
      `Error should describe the failure, got: ${result.error}`
    );
  });

  test("error for unknown agent includes ALL available agent names (property guarantee)", async () => {
    // Use many agents to ensure all are listed
    const agentNames = ["agent-a", "agent-b", "agent-c", "agent-d", "agent-e"];
    const { handler } = setupHandlerWithAgents(
      agentNames.map((name) => ({ name, description: `Description for ${name}` }))
    );

    const result = await handler({ agent_name: "unknown-xyz", task: "test task" });

    assert.equal(result.ok, false);
    assert.ok(result.error, "Should have an error message");

    // Verify EVERY agent name appears in the error
    for (const name of agentNames) {
      assert.ok(result.error!.includes(name), `Error should list available agent "${name}", got: ${result.error}`);
    }
  });

  test("non-string agent_name is treated as empty/missing", async () => {
    const { handler } = setupHandlerWithAgents([{ name: "test-agent" }]);

    // Pass non-string values for agent_name
    const result1 = await handler({ agent_name: 123, task: "do something" });
    assert.equal(result1.ok, false);
    assert.ok(result1.error!.includes("Missing required parameter"));

    const result2 = await handler({ agent_name: null, task: "do something" });
    assert.equal(result2.ok, false);
    assert.ok(result2.error!.includes("Missing required parameter"));

    const result3 = await handler({ agent_name: undefined, task: "do something" });
    assert.equal(result3.ok, false);
    assert.ok(result3.error!.includes("Missing required parameter"));
  });

  test("agent_name matching is exact (case-sensitive)", async () => {
    const { handler } = setupHandlerWithAgents([{ name: "MyAgent" }]);

    // Exact match succeeds
    const resultExact = await handler({ agent_name: "MyAgent", task: "test" });
    assert.equal(resultExact.ok, true);

    // Case mismatch fails
    const resultWrongCase = await handler({ agent_name: "myagent", task: "test" });
    assert.equal(resultWrongCase.ok, false);
    assert.ok(resultWrongCase.error!.includes("not found"));
    assert.ok(resultWrongCase.error!.includes("MyAgent"));
  });
});
