import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { AgentRegistry } from "../agents/agent-registry";

const tempDirs: string[] = [];
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;

/** Set homedir in a cross-platform way (HOME on Unix, USERPROFILE on Windows). */
function setHomeDir(dir: string): void {
  process.env.HOME = dir;
  if (process.platform === "win32") {
    process.env.USERPROFILE = dir;
  }
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }
  if (originalUserProfile === undefined) {
    delete process.env.USERPROFILE;
  } else {
    process.env.USERPROFILE = originalUserProfile;
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
 * Generates a valid AGENT.md content string with all fields populated.
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
// Property 1: Agent discovery respects priority ordering and deduplication
// =============================================================================
// **Validates: Requirements 1.1, 1.2, 1.3**
//
// For any set of agent directories across scan roots where multiple roots
// contain agents with the same name, listAgents() returns exactly one entry
// per unique agent name from the highest-priority scan root.

describe("Property 1: Agent discovery respects priority ordering and deduplication", () => {
  test("higher-priority scan root wins when same agent name exists in multiple roots", () => {
    const projectRoot = createTempDir("deepcode-agent-priority-");
    const home = createTempDir("deepcode-agent-priority-home-");
    setHomeDir(home);

    // Priority order: project .deepcode/agents > home ~/.deepcode/agents
    const highPriority = path.join(projectRoot, ".deepcode", "agents");
    const lowPriority = path.join(home, ".deepcode", "agents");

    // Create agent "test-agent" in both roots with different descriptions
    createAgentMd(
      highPriority,
      "test-agent",
      makeAgentMd({
        name: "test-agent",
        description: "From high priority root",
        body: "# High Priority",
      })
    );
    createAgentMd(
      lowPriority,
      "test-agent",
      makeAgentMd({
        name: "test-agent",
        description: "From low priority root",
        body: "# Low Priority",
      })
    );

    const registry = new AgentRegistry(projectRoot);
    registry.scan();
    const agents = registry.listAgents();

    // Exactly one entry per unique agent name
    const testAgents = agents.filter((a) => a.name === "test-agent");
    assert.equal(testAgents.length, 1);

    // The entry is from the highest-priority root
    assert.equal(testAgents[0]!.description, "From high priority root");
    assert.equal(testAgents[0]!.sourceRoot, "./.deepcode/agents");
  });

  test("deduplication uses frontmatter name field, not directory name", () => {
    const projectRoot = createTempDir("deepcode-agent-dedup-name-");

    const highPriority = path.join(projectRoot, ".deepcode", "agents");
    const lowPriority = path.join(projectRoot, ".agents", "agents");

    // Different directory names, same frontmatter name
    createAgentMd(
      highPriority,
      "dir-a",
      makeAgentMd({
        name: "shared-name",
        description: "High priority version",
      })
    );
    createAgentMd(
      lowPriority,
      "dir-b",
      makeAgentMd({
        name: "shared-name",
        description: "Low priority version",
      })
    );

    const registry = new AgentRegistry(projectRoot);
    registry.scan();
    const agents = registry.listAgents();

    const shared = agents.filter((a) => a.name === "shared-name");
    assert.equal(shared.length, 1);
    assert.equal(shared[0]!.description, "High priority version");
  });

  test("unique agents from multiple roots are all included", () => {
    const projectRoot = createTempDir("deepcode-agent-multi-roots-");

    const root1 = path.join(projectRoot, ".deepcode", "agents");
    const root2 = path.join(projectRoot, ".agents", "agents");

    createAgentMd(
      root1,
      "agent-alpha",
      makeAgentMd({
        name: "agent-alpha",
        description: "Alpha agent",
      })
    );
    createAgentMd(
      root2,
      "agent-beta",
      makeAgentMd({
        name: "agent-beta",
        description: "Beta agent",
      })
    );

    const registry = new AgentRegistry(projectRoot);
    registry.scan();
    const agents = registry.listAgents();
    const names = agents.map((a) => a.name);

    assert.equal(names.includes("agent-alpha"), true);
    assert.equal(names.includes("agent-beta"), true);
    assert.equal(agents.length, 2);
  });

  test("non-existent scan roots are skipped without error", () => {
    const projectRoot = createTempDir("deepcode-agent-missing-roots-");
    // No directories created — all scan roots are missing

    const registry = new AgentRegistry(projectRoot);
    registry.scan();
    const agents = registry.listAgents();

    assert.equal(agents.length, 0);
  });

  test("directories without AGENT.md are skipped", () => {
    const projectRoot = createTempDir("deepcode-agent-no-manifest-");
    const root = path.join(projectRoot, ".deepcode", "agents");

    // Create directory without AGENT.md
    fs.mkdirSync(path.join(root, "no-manifest"), { recursive: true });
    // Create valid one for comparison
    createAgentMd(root, "valid-agent", makeAgentMd({ name: "valid-agent" }));

    const registry = new AgentRegistry(projectRoot);
    registry.scan();
    const agents = registry.listAgents();

    assert.equal(agents.length, 1);
    assert.equal(agents[0]!.name, "valid-agent");
  });

  test("invalid YAML frontmatter is skipped silently", () => {
    const projectRoot = createTempDir("deepcode-agent-invalid-yaml-");
    const root = path.join(projectRoot, ".deepcode", "agents");

    // Invalid YAML - unclosed bracket
    createAgentMd(root, "bad-agent", "---\nname: [unclosed\n---\n# Bad Agent\n");
    // Valid agent for comparison
    createAgentMd(root, "good-agent", makeAgentMd({ name: "good-agent" }));

    const registry = new AgentRegistry(projectRoot);
    registry.scan();
    const agents = registry.listAgents();

    const names = agents.map((a) => a.name);
    assert.equal(names.includes("bad-agent"), false);
    assert.equal(names.includes("good-agent"), true);
  });

  test("multiple agents with unique names across many roots are all discovered", () => {
    const projectRoot = createTempDir("deepcode-agent-many-");

    const root1 = path.join(projectRoot, ".deepcode", "agents");
    const root2 = path.join(projectRoot, ".agents", "agents");

    // Create several agents across roots
    const agentNames = ["analyzer", "formatter", "deployer", "reviewer"];
    for (let i = 0; i < agentNames.length; i++) {
      const root = i % 2 === 0 ? root1 : root2;
      createAgentMd(
        root,
        agentNames[i]!,
        makeAgentMd({
          name: agentNames[i],
          description: `${agentNames[i]} description`,
        })
      );
    }

    const registry = new AgentRegistry(projectRoot);
    registry.scan();
    const agents = registry.listAgents();
    const names = agents.map((a) => a.name).sort();

    assert.deepEqual(names, [...agentNames].sort());
  });

  test("scan clears previous state before re-scanning", () => {
    const projectRoot = createTempDir("deepcode-agent-rescan-");
    const root = path.join(projectRoot, ".deepcode", "agents");

    createAgentMd(root, "first-agent", makeAgentMd({ name: "first-agent" }));

    const registry = new AgentRegistry(projectRoot);
    registry.scan();
    assert.equal(registry.listAgents().length, 1);

    // Remove the agent and add a different one
    fs.rmSync(path.join(root, "first-agent"), { recursive: true });
    createAgentMd(root, "second-agent", makeAgentMd({ name: "second-agent" }));

    registry.scan();
    const agents = registry.listAgents();
    assert.equal(agents.length, 1);
    assert.equal(agents[0]!.name, "second-agent");
  });
});

// =============================================================================
// Property 2: Manifest parsing extracts all fields and body content
// =============================================================================
// **Validates: Requirements 2.1, 2.2, 2.5**
//
// For any valid AGENT.md file containing YAML frontmatter and a markdown body,
// parsing produces an AgentManifest with correct name (frontmatter or directory),
// instructions (body), description, model, skills (or defaults).

describe("Property 2: Manifest parsing extracts all fields and body content", () => {
  test("all frontmatter fields are correctly extracted", () => {
    const projectRoot = createTempDir("deepcode-agent-parse-all-");
    const root = path.join(projectRoot, ".deepcode", "agents");

    createAgentMd(
      root,
      "full-agent",
      makeAgentMd({
        name: "full-agent",
        description: "A fully configured agent",
        model: "claude-sonnet",
        skills: ["testing", "deployment"],
        body: "# Full Agent\n\nYou handle everything.",
      })
    );

    const registry = new AgentRegistry(projectRoot);
    registry.scan();
    const agent = registry.getAgent("full-agent");

    assert.ok(agent);
    assert.equal(agent.name, "full-agent");
    assert.equal(agent.description, "A fully configured agent");
    assert.equal(agent.model, "claude-sonnet");
    assert.deepEqual(agent.skills, ["testing", "deployment"]);
    assert.equal(agent.instructions, "# Full Agent\n\nYou handle everything.");
    assert.equal(agent.sourceRoot, "./.deepcode/agents");
  });

  test("name defaults to directory name when frontmatter name is missing", () => {
    const projectRoot = createTempDir("deepcode-agent-parse-no-name-");
    const root = path.join(projectRoot, ".deepcode", "agents");

    createAgentMd(
      root,
      "my-dir-name",
      makeAgentMd({
        description: "No name field",
        body: "# Instructions",
      })
    );

    const registry = new AgentRegistry(projectRoot);
    registry.scan();
    const agent = registry.getAgent("my-dir-name");

    assert.ok(agent);
    assert.equal(agent.name, "my-dir-name");
  });

  test("description defaults to empty string when missing", () => {
    const projectRoot = createTempDir("deepcode-agent-parse-no-desc-");
    const root = path.join(projectRoot, ".deepcode", "agents");

    createAgentMd(
      root,
      "no-desc-agent",
      makeAgentMd({
        name: "no-desc-agent",
        body: "# No description",
      })
    );

    const registry = new AgentRegistry(projectRoot);
    registry.scan();
    const agent = registry.getAgent("no-desc-agent");

    assert.ok(agent);
    assert.equal(agent.description, "");
  });

  test("model defaults to 'default' when missing", () => {
    const projectRoot = createTempDir("deepcode-agent-parse-no-model-");
    const root = path.join(projectRoot, ".deepcode", "agents");

    createAgentMd(
      root,
      "no-model-agent",
      makeAgentMd({
        name: "no-model-agent",
        body: "# No model",
      })
    );

    const registry = new AgentRegistry(projectRoot);
    registry.scan();
    const agent = registry.getAgent("no-model-agent");

    assert.ok(agent);
    assert.equal(agent.model, "default");
  });

  test("skills defaults to empty array when missing", () => {
    const projectRoot = createTempDir("deepcode-agent-parse-no-skills-");
    const root = path.join(projectRoot, ".deepcode", "agents");

    createAgentMd(
      root,
      "no-skills-agent",
      makeAgentMd({
        name: "no-skills-agent",
        body: "# No skills",
      })
    );

    const registry = new AgentRegistry(projectRoot);
    registry.scan();
    const agent = registry.getAgent("no-skills-agent");

    assert.ok(agent);
    assert.deepEqual(agent.skills, []);
  });

  test("markdown body (instructions) is extracted correctly with trimming", () => {
    const projectRoot = createTempDir("deepcode-agent-parse-body-");
    const root = path.join(projectRoot, ".deepcode", "agents");

    const body =
      "# Complex Agent\n\nYou do many things.\n\n## Section 1\n\nDetails here.\n\n## Section 2\n\nMore details.";
    createAgentMd(
      root,
      "body-agent",
      makeAgentMd({
        name: "body-agent",
        body,
      })
    );

    const registry = new AgentRegistry(projectRoot);
    registry.scan();
    const agent = registry.getAgent("body-agent");

    assert.ok(agent);
    assert.equal(agent.instructions, body);
  });

  test("sourcePath points to the actual AGENT.md file", () => {
    const projectRoot = createTempDir("deepcode-agent-parse-path-");
    const root = path.join(projectRoot, ".deepcode", "agents");

    const manifestPath = createAgentMd(
      root,
      "path-agent",
      makeAgentMd({
        name: "path-agent",
      })
    );

    const registry = new AgentRegistry(projectRoot);
    registry.scan();
    const agent = registry.getAgent("path-agent");

    assert.ok(agent);
    assert.equal(agent.sourcePath, manifestPath);
  });

  test("skills array filters out non-string values", () => {
    const projectRoot = createTempDir("deepcode-agent-parse-bad-skills-");
    const root = path.join(projectRoot, ".deepcode", "agents");

    // Manually write YAML with mixed types in skills
    const content = `---
name: mixed-skills-agent
skills:
  - valid-skill
  - 123
  - another-skill
  - true
---

# Mixed Skills Agent
`;
    createAgentMd(root, "mixed-skills-agent", content);

    const registry = new AgentRegistry(projectRoot);
    registry.scan();
    const agent = registry.getAgent("mixed-skills-agent");

    assert.ok(agent);
    // Only string values should be included
    assert.deepEqual(agent.skills, ["valid-skill", "another-skill"]);
  });

  test("empty frontmatter uses all defaults with directory name", () => {
    const projectRoot = createTempDir("deepcode-agent-parse-empty-fm-");
    const root = path.join(projectRoot, ".deepcode", "agents");

    createAgentMd(root, "empty-fm-agent", "---\n---\n\n# Empty Frontmatter Agent\n\nInstructions here.");

    const registry = new AgentRegistry(projectRoot);
    registry.scan();
    const agent = registry.getAgent("empty-fm-agent");

    assert.ok(agent);
    assert.equal(agent.name, "empty-fm-agent");
    assert.equal(agent.description, "");
    assert.equal(agent.model, "default");
    assert.deepEqual(agent.skills, []);
    assert.equal(agent.instructions, "# Empty Frontmatter Agent\n\nInstructions here.");
  });

  test("hasAgents returns true when agents exist, false otherwise", () => {
    const projectRoot = createTempDir("deepcode-agent-has-agents-");
    const root = path.join(projectRoot, ".deepcode", "agents");

    const registry = new AgentRegistry(projectRoot);
    registry.scan();
    assert.equal(registry.hasAgents(), false);

    createAgentMd(root, "some-agent", makeAgentMd({ name: "some-agent" }));
    registry.scan();
    assert.equal(registry.hasAgents(), true);
  });

  test("getAgent returns undefined for non-existent agent", () => {
    const projectRoot = createTempDir("deepcode-agent-get-missing-");
    const root = path.join(projectRoot, ".deepcode", "agents");

    createAgentMd(root, "existing-agent", makeAgentMd({ name: "existing-agent" }));

    const registry = new AgentRegistry(projectRoot);
    registry.scan();

    assert.equal(registry.getAgent("non-existent"), undefined);
    assert.ok(registry.getAgent("existing-agent"));
  });
});

// =============================================================================
// Plain markdown AGENT.md fallback parsing (no YAML frontmatter)
// =============================================================================
// Real-world AGENT.md files sometimes express metadata using plain markdown
// conventions (H1 heading, blockquote description, bold-label lines) instead
// of YAML frontmatter. gray-matter's matter() only recognizes frontmatter
// blocks that start the document with "---", so these files must fall back
// to a plain-text metadata scan.

describe("Plain markdown AGENT.md fallback parsing (no YAML frontmatter)", () => {
  test("extracts name, description, model, and instructions from blockquote-style metadata", () => {
    const projectRoot = createTempDir("deepcode-agent-plain-blockquote-");
    const root = path.join(projectRoot, ".deepcode", "agents");

    const content = `# deploy-assistant

> 根据代码分支自动识别 Web 或 CRN 工程类型，调用对应工具（captain mcp / npx mcd-cli）发布测试环境，拒绝生产环境发布。

**Model**: deepseek

---

你是一个专注于测试环境发布的智能助手。
根据代码分支自动识别工程类型并发布。
`;

    createAgentMd(root, "deploy-assistant", content);

    const registry = new AgentRegistry(projectRoot);
    registry.scan();
    const agent = registry.getAgent("deploy-assistant");

    assert.ok(agent);
    assert.equal(agent.name, "deploy-assistant");
    assert.equal(
      agent.description,
      "根据代码分支自动识别 Web 或 CRN 工程类型，调用对应工具（captain mcp / npx mcd-cli）发布测试环境，拒绝生产环境发布。"
    );
    assert.equal(agent.model, "deepseek");
    assert.equal(agent.instructions, "你是一个专注于测试环境发布的智能助手。\n根据代码分支自动识别工程类型并发布。");
  });

  test("extracts description and skills from bullet-style bold-label lines", () => {
    const projectRoot = createTempDir("deepcode-agent-plain-bullets-");
    const root = path.join(projectRoot, ".deepcode", "agents");

    const content = `# bullet-agent

- **Description**: A bullet-style described agent.
- **Model**: claude
- **Skills**: a, b, c

---

You are a bullet-style agent.
`;

    createAgentMd(root, "bullet-agent", content);

    const registry = new AgentRegistry(projectRoot);
    registry.scan();
    const agent = registry.getAgent("bullet-agent");

    assert.ok(agent);
    assert.equal(agent.name, "bullet-agent");
    assert.equal(agent.description, "A bullet-style described agent.");
    assert.equal(agent.model, "claude");
    assert.deepEqual(agent.skills, ["a", "b", "c"]);
    assert.equal(agent.instructions, "You are a bullet-style agent.");
  });

  test("falls back to full trimmed raw content when no separator follows metadata", () => {
    const projectRoot = createTempDir("deepcode-agent-plain-no-sep-");
    const root = path.join(projectRoot, ".deepcode", "agents");

    const content = `# no-separator-agent

> This agent has no separator line.

**Model**: gpt-4

You are a helpful agent without a separator.
`;

    createAgentMd(root, "no-separator-agent", content);

    const registry = new AgentRegistry(projectRoot);
    registry.scan();
    const agent = registry.getAgent("no-separator-agent");

    assert.ok(agent);
    assert.equal(agent.name, "no-separator-agent");
    assert.equal(agent.description, "This agent has no separator line.");
    assert.equal(agent.model, "gpt-4");
    assert.equal(agent.instructions, content.trim());
  });

  test("regression: YAML frontmatter AGENT.md files still parse exactly as before", () => {
    const projectRoot = createTempDir("deepcode-agent-plain-regression-");
    const root = path.join(projectRoot, ".deepcode", "agents");

    createAgentMd(
      root,
      "frontmatter-agent",
      makeAgentMd({
        name: "frontmatter-agent",
        description: "A frontmatter-described agent",
        model: "claude-sonnet",
        skills: ["testing"],
        body: "# Frontmatter Agent\n\nYou use YAML frontmatter.",
      })
    );

    const registry = new AgentRegistry(projectRoot);
    registry.scan();
    const agent = registry.getAgent("frontmatter-agent");

    assert.ok(agent);
    assert.equal(agent.name, "frontmatter-agent");
    assert.equal(agent.description, "A frontmatter-described agent");
    assert.equal(agent.model, "claude-sonnet");
    assert.deepEqual(agent.skills, ["testing"]);
    assert.equal(agent.instructions, "# Frontmatter Agent\n\nYou use YAML frontmatter.");
  });
});
