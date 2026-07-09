import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { formatAgentsList } from "../agents/format-agents";
import type { AgentManifest } from "../agents/agent-registry";

describe("formatAgentsList", () => {
  test("returns empty-state message when no agents are discovered", () => {
    const result = formatAgentsList([]);
    assert.ok(result.includes("No sub-agents discovered"));
    assert.ok(result.includes(".deepcode/agents"));
    assert.ok(result.includes(".agents"));
  });

  test("includes agent name, description, model, and sourceRoot for each agent", () => {
    const agents: AgentManifest[] = [
      {
        name: "deploy-assistant",
        description: "Auto-deploy to test environments",
        model: "deepseek",
        skills: [],
        instructions: "Deploy instructions...",
        sourcePath: "/project/.deepcode/agents/deploy-assistant/AGENT.md",
        sourceRoot: "./.deepcode/agents",
      },
      {
        name: "ut-agent",
        description: "Unit test generation",
        model: "claude",
        skills: ["testing-patterns"],
        instructions: "UT instructions...",
        sourcePath: "/project/.agents/ut-agent/AGENT.md",
        sourceRoot: "./.agents",
      },
    ];

    const result = formatAgentsList(agents);

    // Check header
    assert.ok(result.includes("Available Sub-Agents"));

    // Check first agent
    assert.ok(result.includes("### deploy-assistant"));
    assert.ok(result.includes("Auto-deploy to test environments"));
    assert.ok(result.includes("**Model**: deepseek"));
    assert.ok(result.includes("**Source**: ./.deepcode/agents"));

    // Check second agent
    assert.ok(result.includes("### ut-agent"));
    assert.ok(result.includes("Unit test generation"));
    assert.ok(result.includes("**Model**: claude"));
    assert.ok(result.includes("**Source**: ./.agents"));
    assert.ok(result.includes("**Skills**: testing-patterns"));
  });

  test("omits description line when description is empty", () => {
    const agents: AgentManifest[] = [
      {
        name: "simple-agent",
        description: "",
        model: "default",
        skills: [],
        instructions: "",
        sourcePath: "/path/AGENT.md",
        sourceRoot: "./.agents",
      },
    ];

    const result = formatAgentsList(agents);
    assert.ok(result.includes("### simple-agent"));
    assert.ok(result.includes("**Model**: default"));
    assert.ok(!result.includes("**Description**"));
  });

  test("omits skills line when skills array is empty", () => {
    const agents: AgentManifest[] = [
      {
        name: "no-skills-agent",
        description: "An agent without skills",
        model: "claude",
        skills: [],
        instructions: "",
        sourcePath: "/path/AGENT.md",
        sourceRoot: "./.deepcode/agents",
      },
    ];

    const result = formatAgentsList(agents);
    assert.ok(!result.includes("**Skills**"));
  });

  test("lists multiple skills separated by commas", () => {
    const agents: AgentManifest[] = [
      {
        name: "multi-skill",
        description: "Agent with skills",
        model: "claude",
        skills: ["skill-a", "skill-b", "skill-c"],
        instructions: "",
        sourcePath: "/path/AGENT.md",
        sourceRoot: "./.agents",
      },
    ];

    const result = formatAgentsList(agents);
    assert.ok(result.includes("**Skills**: skill-a, skill-b, skill-c"));
  });
});

describe("Property 11: Agent listing includes complete metadata", () => {
  /**
   * **Validates: Requirements 7.2**
   *
   * For any set of discovered agents, the `/agents` command output SHALL include
   * each agent's name, description, model preference, and source scan root path.
   */

  function makeAgent(overrides: Partial<AgentManifest> = {}): AgentManifest {
    return {
      name: overrides.name ?? "test-agent",
      description: overrides.description ?? "A test agent",
      model: overrides.model ?? "claude",
      skills: overrides.skills ?? [],
      instructions: overrides.instructions ?? "Do things",
      sourcePath: overrides.sourcePath ?? "/project/.agents/test-agent/AGENT.md",
      sourceRoot: overrides.sourceRoot ?? "./.agents",
    };
  }

  test("for any number of agents (1, 2, 5), output contains EVERY agent's name", () => {
    const agentCounts = [1, 2, 5];

    for (const count of agentCounts) {
      const agents: AgentManifest[] = Array.from({ length: count }, (_, i) =>
        makeAgent({ name: `agent-${i}`, description: `Description ${i}` })
      );

      const result = formatAgentsList(agents);

      for (const agent of agents) {
        assert.ok(
          result.includes(agent.name),
          `Output should include agent name "${agent.name}" when ${count} agents are present`
        );
      }
    }
  });

  test("for any agent with a non-empty description, output contains that description", () => {
    const descriptions = [
      "Auto-deploy to test environments",
      "Unit test generation specialist",
      "Code review and refactoring assistant",
      "A simple helper",
      "Multi-word description with special chars: @#$%",
    ];

    for (const desc of descriptions) {
      const agents = [makeAgent({ name: "desc-agent", description: desc })];
      const result = formatAgentsList(agents);

      assert.ok(result.includes(desc), `Output should include description "${desc}"`);
    }
  });

  test("for any agent, output contains the model preference", () => {
    const models = ["claude", "deepseek", "default", "gpt-4o", "claude-haiku"];

    for (const model of models) {
      const agents = [makeAgent({ name: "model-agent", model })];
      const result = formatAgentsList(agents);

      assert.ok(result.includes(model), `Output should include model preference "${model}"`);
    }
  });

  test("for any agent, output contains the source scan root path", () => {
    const sourceRoots = ["./.deepcode/agents", "./.agents", "~/.deepcode/agents", "~/.agents"];

    for (const sourceRoot of sourceRoots) {
      const agents = [makeAgent({ name: "source-agent", sourceRoot })];
      const result = formatAgentsList(agents);

      assert.ok(result.includes(sourceRoot), `Output should include source root path "${sourceRoot}"`);
    }
  });

  test("for agents with skills, the skills are listed in the output", () => {
    const skillSets = [["testing-patterns"], ["skill-a", "skill-b"], ["deploy", "lint", "format"]];

    for (const skills of skillSets) {
      const agents = [makeAgent({ name: "skilled-agent", skills })];
      const result = formatAgentsList(agents);

      for (const skill of skills) {
        assert.ok(
          result.includes(skill),
          `Output should include skill "${skill}" from skills list [${skills.join(", ")}]`
        );
      }
    }
  });

  test("combined: multiple agents each have all metadata fields present", () => {
    const agents: AgentManifest[] = [
      makeAgent({
        name: "deploy-bot",
        description: "Deploys services",
        model: "deepseek",
        skills: ["docker", "k8s"],
        sourceRoot: "./.deepcode/agents",
      }),
      makeAgent({
        name: "test-writer",
        description: "Writes unit tests",
        model: "claude",
        skills: ["jest-patterns"],
        sourceRoot: "./.agents",
      }),
      makeAgent({
        name: "reviewer",
        description: "Reviews code changes",
        model: "gpt-4o",
        skills: [],
        sourceRoot: "~/.deepcode/agents",
      }),
    ];

    const result = formatAgentsList(agents);

    for (const agent of agents) {
      assert.ok(result.includes(agent.name), `Missing name: ${agent.name}`);
      if (agent.description) {
        assert.ok(result.includes(agent.description), `Missing description for ${agent.name}`);
      }
      assert.ok(result.includes(agent.model), `Missing model for ${agent.name}`);
      assert.ok(result.includes(agent.sourceRoot), `Missing sourceRoot for ${agent.name}`);
      for (const skill of agent.skills) {
        assert.ok(result.includes(skill), `Missing skill "${skill}" for ${agent.name}`);
      }
    }
  });
});
