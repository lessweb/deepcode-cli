/**
 * Property test: Slash command generation matches discovered agents
 *
 * **Validates: Requirements 3.1**
 *
 * Property statement: For any non-empty set of discovered agents,
 * `buildSlashCommands` SHALL produce exactly one slash command item
 * of kind "agent" for each discovered agent, with the command name
 * matching the agent's name.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSlashCommands } from "../ui";
import type { AgentManifest } from "@vegamo/deepcode-core";
import type { SkillInfo } from "@vegamo/deepcode-core";

// -- Test helpers --

function makeAgent(overrides: Partial<AgentManifest> = {}): AgentManifest {
  return {
    name: overrides.name ?? "test-agent",
    description: overrides.description ?? "A test agent",
    model: overrides.model ?? "claude",
    skills: overrides.skills ?? [],
    instructions: overrides.instructions ?? "# Test Agent",
    sourcePath: overrides.sourcePath ?? "/fake/path/AGENT.md",
    sourceRoot: overrides.sourceRoot ?? "./.deepcode/agents",
  };
}

const emptySkills: SkillInfo[] = [];

// -- Property tests --

test("Property 4: no agents produces no agent items", () => {
  const items = buildSlashCommands(emptySkills, []);
  const agentItems = items.filter((i) => i.kind === "agent");
  assert.equal(agentItems.length, 0);
});

test("Property 4: single agent produces exactly one agent item with matching name", () => {
  const agents: AgentManifest[] = [makeAgent({ name: "deploy-assistant", description: "Deploys to test environment" })];

  const items = buildSlashCommands(emptySkills, agents);
  const agentItems = items.filter((i) => i.kind === "agent");

  assert.equal(agentItems.length, 1);
  assert.equal(agentItems[0].name, "deploy-assistant");
  assert.equal(agentItems[0].kind, "agent");
});

test("Property 4: multiple agents produce one item each with correct names", () => {
  const agents: AgentManifest[] = [
    makeAgent({ name: "deploy-assistant", description: "Deploys to test environment" }),
    makeAgent({ name: "ut-agent", description: "Unit test generation" }),
    makeAgent({ name: "code-review", description: "Reviews code changes" }),
  ];

  const items = buildSlashCommands(emptySkills, agents);
  const agentItems = items.filter((i) => i.kind === "agent");

  assert.equal(agentItems.length, 3);
  assert.deepEqual(
    agentItems.map((i) => i.name),
    ["deploy-assistant", "ut-agent", "code-review"]
  );
});

test("Property 4: agent items appear before skill items and built-in items", () => {
  const skills: SkillInfo[] = [
    { name: "testing-skill", path: "/skills/testing-skill/SKILL.md", description: "A skill" },
  ];
  const agents: AgentManifest[] = [makeAgent({ name: "deploy-assistant", description: "Deploy agent" })];

  const items = buildSlashCommands(skills, agents);

  // Find positions
  const agentIndex = items.findIndex((i) => i.kind === "agent");
  const skillIndex = items.findIndex((i) => i.kind === "skill");
  const builtinIndex = items.findIndex((i) => i.kind !== "agent" && i.kind !== "skill");

  assert.ok(agentIndex < skillIndex, "Agent items should appear before skill items");
  assert.ok(agentIndex < builtinIndex, "Agent items should appear before built-in items");
});

test("Property 4: each agent item has kind 'agent' and label matching /<name>", () => {
  const agents: AgentManifest[] = [
    makeAgent({ name: "deploy-assistant", description: "Deploys to test environment" }),
    makeAgent({ name: "eaa", description: "Accessibility helper" }),
  ];

  const items = buildSlashCommands(emptySkills, agents);
  const agentItems = items.filter((i) => i.kind === "agent");

  for (const agent of agents) {
    const item = agentItems.find((i) => i.name === agent.name);
    assert.ok(item, `Expected to find item for agent "${agent.name}"`);
    assert.equal(item.kind, "agent");
    assert.equal(item.label, `/${agent.name}`);
    assert.equal(item.description, agent.description);
  }
});

test("Property 4: agent count matches exactly — no extra agent items", () => {
  const agents: AgentManifest[] = [
    makeAgent({ name: "agent-a", description: "First" }),
    makeAgent({ name: "agent-b", description: "Second" }),
    makeAgent({ name: "agent-c", description: "Third" }),
    makeAgent({ name: "agent-d", description: "Fourth" }),
    makeAgent({ name: "agent-e", description: "Fifth" }),
  ];

  const items = buildSlashCommands(emptySkills, agents);
  const agentItems = items.filter((i) => i.kind === "agent");

  assert.equal(agentItems.length, agents.length);
  for (const agent of agents) {
    const matching = agentItems.filter((i) => i.name === agent.name);
    assert.equal(matching.length, 1, `Expected exactly one item for agent "${agent.name}"`);
  }
});

test("Property 4: agent with empty description gets '(no description)'", () => {
  const agents: AgentManifest[] = [makeAgent({ name: "no-desc-agent", description: "" })];

  const items = buildSlashCommands(emptySkills, agents);
  const agentItems = items.filter((i) => i.kind === "agent");

  assert.equal(agentItems.length, 1);
  assert.equal(agentItems[0].description, "(no description)");
});
