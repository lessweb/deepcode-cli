import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { getTools } from "../prompt";
import { AgentRegistry } from "../agents/agent-registry";

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

function createAgentMd(scanRoot: string, dirName: string, content: string): string {
  const agentDir = path.join(scanRoot, dirName);
  fs.mkdirSync(agentDir, { recursive: true });
  const manifestPath = path.join(agentDir, "AGENT.md");
  fs.writeFileSync(manifestPath, content, "utf8");
  return manifestPath;
}

function makeAgentMd(opts: {
  name?: string;
  description?: string;
  model?: string;
  skills?: string[];
  body?: string;
}): string {
  const frontmatterParts: string[] = [];
  if (opts.name !== undefined) frontmatterParts.push(`name: ${opts.name}`);
  if (opts.description !== undefined) frontmatterParts.push(`description: ${opts.description}`);
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

// =============================================================================
// Property 6: DelegateToAgent tool presence correlates with agent discovery
// =============================================================================
// **Validates: Requirements 4.1, 4.3**
//
// For any call to getTools() with an AgentRegistry argument, the returned tool
// list SHALL contain a DelegateToAgent tool definition if and only if
// agentRegistry.hasAgents() returns true.

describe("Property 6: DelegateToAgent tool presence correlates with agent discovery", () => {
  test("DelegateToAgent is present when registry has agents", () => {
    const projectRoot = createTempDir("deepcode-prompt-agents-present-");
    const root = path.join(projectRoot, ".deepcode", "agents");

    createAgentMd(
      root,
      "test-agent",
      makeAgentMd({
        name: "test-agent",
        description: "A test agent",
      })
    );

    const registry = new AgentRegistry(projectRoot);
    registry.scan();
    assert.equal(registry.hasAgents(), true);

    const tools = getTools({}, [], registry);
    const delegateTool = tools.find((t) => t.function.name === "DelegateToAgent");

    assert.ok(delegateTool, "DelegateToAgent tool should be present when agents exist");
  });

  test("DelegateToAgent is NOT present when no registry is provided", () => {
    const tools = getTools({}, []);
    const delegateTool = tools.find((t) => t.function.name === "DelegateToAgent");

    assert.equal(delegateTool, undefined, "DelegateToAgent should not be present without a registry");
  });

  test("DelegateToAgent is NOT present when registry has no agents", () => {
    const projectRoot = createTempDir("deepcode-prompt-agents-empty-");
    // No agent directories created — registry will be empty

    const registry = new AgentRegistry(projectRoot);
    registry.scan();
    assert.equal(registry.hasAgents(), false);

    const tools = getTools({}, [], registry);
    const delegateTool = tools.find((t) => t.function.name === "DelegateToAgent");

    assert.equal(delegateTool, undefined, "DelegateToAgent should not be present when registry is empty");
  });

  test("DelegateToAgent presence is consistent with hasAgents() for multiple agents", () => {
    const projectRoot = createTempDir("deepcode-prompt-agents-multi-");
    const root = path.join(projectRoot, ".deepcode", "agents");

    createAgentMd(root, "agent-a", makeAgentMd({ name: "agent-a", description: "Alpha" }));
    createAgentMd(root, "agent-b", makeAgentMd({ name: "agent-b", description: "Beta" }));
    createAgentMd(root, "agent-c", makeAgentMd({ name: "agent-c", description: "Gamma" }));

    const registry = new AgentRegistry(projectRoot);
    registry.scan();
    assert.equal(registry.hasAgents(), true);

    const tools = getTools({}, [], registry);
    const delegateTool = tools.find((t) => t.function.name === "DelegateToAgent");

    assert.ok(delegateTool, "DelegateToAgent tool should be present when multiple agents exist");
  });

  test("DelegateToAgent tool parameters include agent_name and task as required", () => {
    const projectRoot = createTempDir("deepcode-prompt-agents-params-");
    const root = path.join(projectRoot, ".deepcode", "agents");

    createAgentMd(
      root,
      "param-agent",
      makeAgentMd({
        name: "param-agent",
        description: "Parameter test",
      })
    );

    const registry = new AgentRegistry(projectRoot);
    registry.scan();

    const tools = getTools({}, [], registry);
    const delegateTool = tools.find((t) => t.function.name === "DelegateToAgent");

    assert.ok(delegateTool);
    const params = delegateTool.function.parameters;
    assert.equal(params.type, "object");
    assert.ok(params.properties.agent_name, "agent_name property should exist");
    assert.ok(params.properties.task, "task property should exist");
    assert.ok(params.required?.includes("agent_name"), "agent_name should be required");
    assert.ok(params.required?.includes("task"), "task should be required");
  });

  test("other built-in tools remain unaffected by agent registry presence", () => {
    const projectRoot = createTempDir("deepcode-prompt-agents-other-tools-");
    const root = path.join(projectRoot, ".deepcode", "agents");

    createAgentMd(root, "some-agent", makeAgentMd({ name: "some-agent" }));

    const registry = new AgentRegistry(projectRoot);
    registry.scan();

    const toolsWithAgents = getTools({}, [], registry);
    const toolsWithout = getTools({}, []);

    // All tools that exist without agents should still be present with agents
    const namesWithout = toolsWithout.map((t) => t.function.name);
    for (const name of namesWithout) {
      const found = toolsWithAgents.find((t) => t.function.name === name);
      assert.ok(found, `Tool "${name}" should still be present when agents exist`);
    }
  });
});

// =============================================================================
// Property 7: DelegateToAgent description contains all agent metadata
// =============================================================================
// **Validates: Requirements 4.3**
//
// For any non-empty set of discovered agents, the DelegateToAgent tool's
// description field SHALL contain the name and description of every
// discovered agent.

describe("Property 7: DelegateToAgent description contains all agent metadata", () => {
  test("description contains single agent name and description", () => {
    const projectRoot = createTempDir("deepcode-prompt-agents-desc-single-");
    const root = path.join(projectRoot, ".deepcode", "agents");

    createAgentMd(
      root,
      "code-reviewer",
      makeAgentMd({
        name: "code-reviewer",
        description: "Reviews code for quality and correctness",
      })
    );

    const registry = new AgentRegistry(projectRoot);
    registry.scan();

    const tools = getTools({}, [], registry);
    const delegateTool = tools.find((t) => t.function.name === "DelegateToAgent");

    assert.ok(delegateTool);
    const description = delegateTool.function.description;
    assert.ok(description.includes("code-reviewer"), "Description should contain agent name");
    assert.ok(
      description.includes("Reviews code for quality and correctness"),
      "Description should contain agent description"
    );
  });

  test("description contains ALL agent names and descriptions for multiple agents", () => {
    const projectRoot = createTempDir("deepcode-prompt-agents-desc-multi-");
    const root = path.join(projectRoot, ".deepcode", "agents");

    const agents = [
      { name: "test-writer", description: "Generates unit tests" },
      { name: "doc-generator", description: "Creates documentation" },
      { name: "refactorer", description: "Refactors code for clarity" },
    ];

    for (const agent of agents) {
      createAgentMd(root, agent.name, makeAgentMd(agent));
    }

    const registry = new AgentRegistry(projectRoot);
    registry.scan();

    const tools = getTools({}, [], registry);
    const delegateTool = tools.find((t) => t.function.name === "DelegateToAgent");

    assert.ok(delegateTool);
    const description = delegateTool.function.description;

    for (const agent of agents) {
      assert.ok(description.includes(agent.name), `Description should contain agent name "${agent.name}"`);
      assert.ok(
        description.includes(agent.description),
        `Description should contain description for "${agent.name}": "${agent.description}"`
      );
    }
  });

  test("description handles agents with empty descriptions gracefully", () => {
    const projectRoot = createTempDir("deepcode-prompt-agents-desc-empty-");
    const root = path.join(projectRoot, ".deepcode", "agents");

    createAgentMd(
      root,
      "no-desc-agent",
      makeAgentMd({
        name: "no-desc-agent",
        // No description — defaults to ""
      })
    );

    const registry = new AgentRegistry(projectRoot);
    registry.scan();

    const tools = getTools({}, [], registry);
    const delegateTool = tools.find((t) => t.function.name === "DelegateToAgent");

    assert.ok(delegateTool);
    const description = delegateTool.function.description;
    assert.ok(
      description.includes("no-desc-agent"),
      "Description should still contain the agent name even without a description"
    );
  });

  test("description includes agents from multiple scan roots", () => {
    const projectRoot = createTempDir("deepcode-prompt-agents-desc-roots-");
    const root1 = path.join(projectRoot, ".deepcode", "agents");
    const root2 = path.join(projectRoot, ".agents", "agents");

    createAgentMd(
      root1,
      "primary-agent",
      makeAgentMd({
        name: "primary-agent",
        description: "From primary root",
      })
    );
    createAgentMd(
      root2,
      "secondary-agent",
      makeAgentMd({
        name: "secondary-agent",
        description: "From secondary root",
      })
    );

    const registry = new AgentRegistry(projectRoot);
    registry.scan();

    const tools = getTools({}, [], registry);
    const delegateTool = tools.find((t) => t.function.name === "DelegateToAgent");

    assert.ok(delegateTool);
    const description = delegateTool.function.description;

    assert.ok(description.includes("primary-agent"), "Should include primary-agent");
    assert.ok(description.includes("From primary root"), "Should include primary-agent description");
    assert.ok(description.includes("secondary-agent"), "Should include secondary-agent");
    assert.ok(description.includes("From secondary root"), "Should include secondary-agent description");
  });

  test("description reflects agents with special characters in name/description", () => {
    const projectRoot = createTempDir("deepcode-prompt-agents-desc-special-");
    const root = path.join(projectRoot, ".deepcode", "agents");

    createAgentMd(
      root,
      "my-agent-2",
      makeAgentMd({
        name: "my-agent-2",
        description: "Handles tasks with numbers (v2.0) & symbols",
      })
    );

    const registry = new AgentRegistry(projectRoot);
    registry.scan();

    const tools = getTools({}, [], registry);
    const delegateTool = tools.find((t) => t.function.name === "DelegateToAgent");

    assert.ok(delegateTool);
    const description = delegateTool.function.description;
    assert.ok(description.includes("my-agent-2"));
    assert.ok(description.includes("Handles tasks with numbers (v2.0) & symbols"));
  });
});
