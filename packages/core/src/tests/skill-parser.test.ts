import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseSkillContent, skillPolicyToProfile, validateSkillName } from "../common/skill-parser";
import { checkFileSystemAccess, checkNetworkAccess } from "../common/permission-profile";

const context = {
  projectRoot: "/tmp/project",
  dataDir: "/tmp/data",
};

describe("SkillParser - basic frontmatter", () => {
  test("parses minimal SKILL.md", () => {
    const skill = parseSkillContent(
      `---
name: my-skill
description: A test skill
---
# Body content
    `,
      "fallback"
    );
    assert.equal(skill.name, "my-skill");
    assert.equal(skill.description, "A test skill");
  });

  test("uses fallback name when name missing", () => {
    const skill = parseSkillContent(
      `---
description: no name here
---
    `,
      "fallback-name"
    );
    assert.equal(skill.name, "fallback-name");
  });

  test("parses agent.dependencies as array", () => {
    const skill = parseSkillContent(
      `---
name: parent
agent:
  dependencies:
    - name: child-skill
      version: "1.0"
      source: ./skills/child
    - name: another-skill
---
    `,
      "fallback"
    );
    assert.equal(skill.agent?.dependencies?.length, 2);
    assert.equal(skill.agent?.dependencies?.[0].name, "child-skill");
    assert.equal(skill.agent?.dependencies?.[0].version, "1.0");
    assert.equal(skill.agent?.dependencies?.[1].name, "another-skill");
  });

  test("parses agent.dependencies as object", () => {
    const skill = parseSkillContent(
      `---
name: parent
agent:
  dependencies:
    tool-skill: ./tools
    helper-skill: ./helpers
---
    `,
      "fallback"
    );
    assert.equal(skill.agent?.dependencies?.length, 2);
    assert.equal(skill.agent?.dependencies?.[0].name, "tool-skill");
  });

  test("parses agent.interface", () => {
    const skill = parseSkillContent(
      `---
name: ui-demo
agent:
  interface:
    default_prompt: "帮我完成这个 UI 任务"
    brand_color: "#FF5500"
    screenshots:
      - ./screenshots/main.png
---
    `,
      "fallback"
    );
    assert.equal(skill.agent?.interface?.defaultPrompt, "帮我完成这个 UI 任务");
    assert.equal(skill.agent?.interface?.brandColor, "#FF5500");
    assert.equal(skill.agent?.interface?.screenshots?.length, 1);
  });

  test("parses agent.policy", () => {
    const skill = parseSkillContent(
      `---
name: secure-skill
agent:
  policy:
    requiredPermissions:
      - read-in-cwd
      - write-in-cwd
    allowNetwork: false
    allowGitWrite: false
    allowedPaths:
      - /tmp/work
    deniedPaths:
      - /etc
---
    `,
      "fallback"
    );
    const policy = skill.agent?.policy;
    assert.ok(policy !== undefined);
    assert.equal(policy.allowNetwork, false);
    assert.equal(policy.allowGitWrite, false);
    assert.ok(policy.allowedPaths?.includes("/tmp/work"));
    assert.ok(policy.deniedPaths?.includes("/etc"));
  });

  test("honors disable-model-invocation", () => {
    const skill = parseSkillContent(
      `---
name: tool-only
disable-model-invocation: true
---
    `,
      "fallback"
    );
    assert.equal(skill.disableModelInvocation, true);
  });
});

describe("SkillParser - validateSkillName", () => {
  test("valid names pass", () => {
    assert.equal(validateSkillName("my-skill"), null);
    assert.equal(validateSkillName("MySkill_1"), null);
    assert.equal(validateSkillName("a"), null);
  });

  test("empty name fails", () => {
    assert.ok(validateSkillName("") !== null);
    assert.ok(validateSkillName("   ") !== null);
  });

  test("name too long fails", () => {
    assert.ok(validateSkillName("a".repeat(100)) !== null);
  });

  test("invalid characters fail", () => {
    assert.ok(validateSkillName("my skill") !== null); // space
    assert.ok(validateSkillName("my.skill") !== null); // dot
    assert.ok(validateSkillName("my/skill") !== null); // slash
  });
});

describe("SkillParser - skillPolicyToProfile", () => {
  test("undefined policy returns DEFAULT_DEV", () => {
    const profile = skillPolicyToProfile(undefined, "/project");
    assert.equal(profile.mode, "managed");
  });

  test("restrictive policy produces restrictive profile", () => {
    const profile = skillPolicyToProfile(
      { allowNetwork: false, allowGitWrite: false, allowedPaths: ["/tmp/work"] },
      "/project"
    );
    assert.equal(checkNetworkAccess("api.openai.com", profile), false);
    // allowedPaths should be writable
    if (profile.mode === "managed") {
      const result = checkFileSystemAccess("/tmp/work/file.txt", profile, context);
      assert.equal(result.allowed, true);
      assert.equal(result.writeAccess, true);
    }
  });
});
