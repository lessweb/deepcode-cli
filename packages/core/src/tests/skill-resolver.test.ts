import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resolveAgentSkills } from "../agents/skill-resolver";
import type { AgentManifest } from "../agents/agent-registry";

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
 * Helper to create a SKILL.md file in a skills directory.
 */
function createSkillMd(
  skillsRoot: string,
  skillName: string,
  opts: { name?: string; description?: string; body?: string } = {}
): string {
  const skillDir = path.join(skillsRoot, skillName);
  fs.mkdirSync(skillDir, { recursive: true });
  const skillPath = path.join(skillDir, "SKILL.md");
  const frontmatter = [
    "---",
    `name: ${opts.name ?? skillName}`,
    `description: ${opts.description ?? `${skillName} skill`}`,
    "---",
  ].join("\n");
  const content = `${frontmatter}\n\n${opts.body ?? `# ${skillName}\n\nSkill instructions for ${skillName}.`}`;
  fs.writeFileSync(skillPath, content, "utf8");
  return skillPath;
}

/**
 * Helper to create a minimal AgentManifest pointing to a temp directory.
 */
function makeManifest(opts: { agentDir: string; skills?: string[] }): AgentManifest {
  const sourcePath = path.join(opts.agentDir, "AGENT.md");
  // Write a minimal AGENT.md so the directory structure is valid
  fs.mkdirSync(opts.agentDir, { recursive: true });
  fs.writeFileSync(sourcePath, "---\nname: test-agent\n---\n\n# Test Agent\n", "utf8");
  return {
    name: "test-agent",
    description: "A test agent",
    model: "default",
    skills: opts.skills ?? [],
    instructions: "# Test Agent",
    sourcePath,
    sourceRoot: "./.deepcode/agents",
  };
}

// =============================================================================
// Property 10: Skill resolution respects locality and deduplication
// =============================================================================
// **Validates: Requirements 6.1, 6.2, 6.3, 6.4**
//
// For any agent manifest with a `skills` field listing N skill names and a local
// `skills/` directory containing some of those skills, `resolveAgentSkills` SHALL:
// (a) prefer local skills over global skills with the same name
// (b) load only the skills listed in the `skills` field
// (c) when the `skills` field is absent/empty, load all skills found in the
//     local `skills/` directory

describe("Property 10: Skill resolution respects locality and deduplication", () => {
  test("(a) local skills take priority over same-named global skills", () => {
    const baseDir = createTempDir("skill-resolver-local-priority-");
    const agentDir = path.join(baseDir, "agent");
    const localSkillsDir = path.join(agentDir, "skills");
    const globalRoot = path.join(baseDir, "global-skills");

    // Create same skill in both local and global with different content
    createSkillMd(localSkillsDir, "shared-skill", {
      name: "shared-skill",
      description: "Local version",
      body: "# Local Shared Skill",
    });
    createSkillMd(globalRoot, "shared-skill", {
      name: "shared-skill",
      description: "Global version",
      body: "# Global Shared Skill",
    });

    const manifest = makeManifest({ agentDir, skills: ["shared-skill"] });
    const resolved = resolveAgentSkills({
      manifest,
      globalSkillRoots: [globalRoot],
    });

    assert.equal(resolved.length, 1);
    assert.equal(resolved[0]!.name, "shared-skill");
    // Content should come from local, not global
    assert.ok(resolved[0]!.content.includes("Local version"));
    assert.ok(resolved[0]!.path.includes(localSkillsDir));
  });

  test("(b) when manifest.skills lists specific names, only those are loaded", () => {
    const baseDir = createTempDir("skill-resolver-specific-");
    const agentDir = path.join(baseDir, "agent");
    const localSkillsDir = path.join(agentDir, "skills");

    // Create multiple skills locally
    createSkillMd(localSkillsDir, "skill-a", { name: "skill-a" });
    createSkillMd(localSkillsDir, "skill-b", { name: "skill-b" });
    createSkillMd(localSkillsDir, "skill-c", { name: "skill-c" });

    // Manifest only requests skill-a and skill-c
    const manifest = makeManifest({ agentDir, skills: ["skill-a", "skill-c"] });
    const resolved = resolveAgentSkills({
      manifest,
      globalSkillRoots: [],
    });

    const names = resolved.map((s) => s.name).sort();
    assert.deepEqual(names, ["skill-a", "skill-c"]);
    // skill-b should NOT be loaded
    assert.equal(
      resolved.find((s) => s.name === "skill-b"),
      undefined
    );
  });

  test("(c) when manifest.skills is empty, all local skills are loaded", () => {
    const baseDir = createTempDir("skill-resolver-all-local-");
    const agentDir = path.join(baseDir, "agent");
    const localSkillsDir = path.join(agentDir, "skills");

    // Create several skills locally
    createSkillMd(localSkillsDir, "alpha", { name: "alpha" });
    createSkillMd(localSkillsDir, "beta", { name: "beta" });
    createSkillMd(localSkillsDir, "gamma", { name: "gamma" });

    // Empty skills array = load all local
    const manifest = makeManifest({ agentDir, skills: [] });
    const resolved = resolveAgentSkills({
      manifest,
      globalSkillRoots: [],
    });

    const names = resolved.map((s) => s.name).sort();
    assert.deepEqual(names, ["alpha", "beta", "gamma"]);
  });

  test("skills not found anywhere log a warning but don't fail", () => {
    const baseDir = createTempDir("skill-resolver-missing-");
    const agentDir = path.join(baseDir, "agent");
    const localSkillsDir = path.join(agentDir, "skills");
    const globalRoot = path.join(baseDir, "global-skills");

    // Only create one skill locally
    createSkillMd(localSkillsDir, "existing-skill", { name: "existing-skill" });
    // Create empty global root
    fs.mkdirSync(globalRoot, { recursive: true });

    // Request a skill that doesn't exist anywhere
    const manifest = makeManifest({
      agentDir,
      skills: ["existing-skill", "nonexistent-skill"],
    });
    const resolved = resolveAgentSkills({
      manifest,
      globalSkillRoots: [globalRoot],
    });

    // Should still resolve the existing skill without throwing
    assert.equal(resolved.length, 1);
    assert.equal(resolved[0]!.name, "existing-skill");
  });

  test("global roots are searched when local skills are missing", () => {
    const baseDir = createTempDir("skill-resolver-global-fallback-");
    const agentDir = path.join(baseDir, "agent");
    const globalRoot1 = path.join(baseDir, "global-1");
    const globalRoot2 = path.join(baseDir, "global-2");

    // No local skills directory
    // Create skill only in global root
    createSkillMd(globalRoot1, "global-only-skill", {
      name: "global-only-skill",
      description: "From global root 1",
    });
    createSkillMd(globalRoot2, "another-global", {
      name: "another-global",
      description: "From global root 2",
    });

    const manifest = makeManifest({
      agentDir,
      skills: ["global-only-skill", "another-global"],
    });
    const resolved = resolveAgentSkills({
      manifest,
      globalSkillRoots: [globalRoot1, globalRoot2],
    });

    const names = resolved.map((s) => s.name).sort();
    assert.deepEqual(names, ["another-global", "global-only-skill"]);
    // Verify they come from global roots
    assert.ok(resolved.find((s) => s.name === "global-only-skill")!.path.includes(globalRoot1));
    assert.ok(resolved.find((s) => s.name === "another-global")!.path.includes(globalRoot2));
  });

  test("local skill wins deduplication even when skill exists in multiple global roots", () => {
    const baseDir = createTempDir("skill-resolver-dedup-multi-");
    const agentDir = path.join(baseDir, "agent");
    const localSkillsDir = path.join(agentDir, "skills");
    const globalRoot1 = path.join(baseDir, "global-1");
    const globalRoot2 = path.join(baseDir, "global-2");

    // Same skill in local, global-1, and global-2
    createSkillMd(localSkillsDir, "common-skill", {
      name: "common-skill",
      description: "Local version",
      body: "# Local",
    });
    createSkillMd(globalRoot1, "common-skill", {
      name: "common-skill",
      description: "Global-1 version",
      body: "# Global 1",
    });
    createSkillMd(globalRoot2, "common-skill", {
      name: "common-skill",
      description: "Global-2 version",
      body: "# Global 2",
    });

    const manifest = makeManifest({ agentDir, skills: ["common-skill"] });
    const resolved = resolveAgentSkills({
      manifest,
      globalSkillRoots: [globalRoot1, globalRoot2],
    });

    assert.equal(resolved.length, 1);
    assert.ok(resolved[0]!.content.includes("Local version"));
    assert.ok(resolved[0]!.path.includes(localSkillsDir));
  });

  test("first global root wins when skill not found locally", () => {
    const baseDir = createTempDir("skill-resolver-global-priority-");
    const agentDir = path.join(baseDir, "agent");
    const globalRoot1 = path.join(baseDir, "global-1");
    const globalRoot2 = path.join(baseDir, "global-2");

    // No local skills dir
    // Same skill in both global roots with different content
    createSkillMd(globalRoot1, "dup-skill", {
      name: "dup-skill",
      description: "From first global root",
    });
    createSkillMd(globalRoot2, "dup-skill", {
      name: "dup-skill",
      description: "From second global root",
    });

    const manifest = makeManifest({ agentDir, skills: ["dup-skill"] });
    const resolved = resolveAgentSkills({
      manifest,
      globalSkillRoots: [globalRoot1, globalRoot2],
    });

    assert.equal(resolved.length, 1);
    assert.ok(resolved[0]!.content.includes("From first global root"));
    assert.ok(resolved[0]!.path.includes(globalRoot1));
  });

  test("skill name is derived from frontmatter name field when present", () => {
    const baseDir = createTempDir("skill-resolver-frontmatter-name-");
    const agentDir = path.join(baseDir, "agent");
    const localSkillsDir = path.join(agentDir, "skills");

    // Directory name differs from frontmatter name
    createSkillMd(localSkillsDir, "dir-name-skill", {
      name: "actual-name",
      description: "Has frontmatter name",
    });

    // When skills field is empty, all local skills are loaded by directory scan
    const manifest = makeManifest({ agentDir, skills: [] });
    const resolved = resolveAgentSkills({
      manifest,
      globalSkillRoots: [],
    });

    // The resolved skill name comes from frontmatter
    assert.equal(resolved.length, 1);
    assert.equal(resolved[0]!.name, "actual-name");
  });

  test("empty local skills directory with empty skills field results in no skills", () => {
    const baseDir = createTempDir("skill-resolver-empty-");
    const agentDir = path.join(baseDir, "agent");
    const localSkillsDir = path.join(agentDir, "skills");
    fs.mkdirSync(localSkillsDir, { recursive: true });

    const manifest = makeManifest({ agentDir, skills: [] });
    const resolved = resolveAgentSkills({
      manifest,
      globalSkillRoots: [],
    });

    assert.equal(resolved.length, 0);
  });

  test("no local skills directory with empty skills field results in no skills", () => {
    const baseDir = createTempDir("skill-resolver-no-local-dir-");
    const agentDir = path.join(baseDir, "agent");
    // Don't create the skills/ subdirectory

    const manifest = makeManifest({ agentDir, skills: [] });
    const resolved = resolveAgentSkills({
      manifest,
      globalSkillRoots: [],
    });

    assert.equal(resolved.length, 0);
  });
});
