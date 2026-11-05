import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSlashCommands,
  filterSlashCommands,
  findExactSlashCommand,
  formatSlashCommandDescription,
  formatSlashCommandLabel,
  resolveSlashSubmission,
} from "../ui";
import type { SkillInfo } from "@vegamo/deepcode-core";

const skills: SkillInfo[] = [
  { name: "skill-writer", path: "~/.agents/skills/skill-writer/SKILL.md", description: "Write a SKILL.md" },
  { name: "code-review", path: "~/.agents/skills/code-review/SKILL.md", description: "Review code" },
];

test("buildSlashCommands prefixes skills before built-ins", () => {
  const items = buildSlashCommands(skills);
  assert.equal(items[0].kind, "skill");
  assert.equal(items[0].name, "skill-writer");
  const builtinNames = items.filter((i) => i.kind !== "skill").map((i) => i.name);
  assert.deepEqual(builtinNames, [
    "skills",
    "model",
    "permissions",
    "plan",
    "new",
    "init",
    "resume",
    "fork",
    "continue",
    "compact",
    "copy",
    "undo",
    "mcp",
    "raw",
    "exit",
  ]);
});

test("/copy is suggested, takes precedence over a skill and ignores trailing text", () => {
  const items = buildSlashCommands([{ name: "copy", path: "/skills/copy/SKILL.md", description: "A skill" }]);
  assert.ok(filterSlashCommands(items, "/cop").some((item) => item.kind === "copy"));
  assert.equal(findExactSlashCommand(items, "/copy")?.kind, "copy");
  const result = resolveSlashSubmission(items, "/copy extra text");
  assert.equal(result?.kind, "command");
  assert.equal(result?.kind === "command" ? result.item.kind : "", "copy");
});

test("filterSlashCommands matches partial prefixes", () => {
  const items = buildSlashCommands(skills);
  const matched = filterSlashCommands(items, "/skil").map((i) => i.name);
  assert.deepEqual(matched, ["skill-writer", "skills"]);
});

test("filterSlashCommands ranks /model before /commondao for /mo", () => {
  const items = buildSlashCommands([
    { name: "commondao", path: "/skills/commondao/SKILL.md", description: "CommonDAO guide" },
  ]);
  assert.deepEqual(
    filterSlashCommands(items, "/mo").map((item) => item.name),
    ["model", "commondao"]
  );
});

test("filterSlashCommands preserves order within match groups without mutating input", () => {
  const items = buildSlashCommands(
    ["commondao", "motion", "demo", "model-helper"].map((name) => ({
      name,
      path: `/skills/${name}/SKILL.md`,
      description: name,
    }))
  );
  const original = [...items];
  assert.deepEqual(
    filterSlashCommands(items, "/mo").map((item) => item.name),
    ["motion", "model-helper", "model", "commondao", "demo"]
  );
  assert.deepEqual(items, original);
});

test("filterSlashCommands matches and prioritizes prefixes case-insensitively", () => {
  const items = buildSlashCommands(
    ["ComMonDAO", "Motion"].map((name) => ({
      name,
      path: `/skills/${name}/SKILL.md`,
      description: name,
    }))
  );
  assert.deepEqual(
    filterSlashCommands(items, "/MO").map((item) => item.name),
    ["Motion", "model", "ComMonDAO"]
  );
});

test("filterSlashCommands returns all entries on bare slash", () => {
  const items = buildSlashCommands(skills);
  const matched = filterSlashCommands(items, "/");
  assert.deepEqual(matched, items);
});

test("filterSlashCommands returns nothing when no names match", () => {
  assert.deepEqual(filterSlashCommands(buildSlashCommands(skills), "/missing"), []);
});

test("filterSlashCommands returns nothing for non-slash tokens", () => {
  const items = buildSlashCommands(skills);
  assert.deepEqual(filterSlashCommands(items, "skill"), []);
});

test("findExactSlashCommand returns null when nothing matches", () => {
  const items = buildSlashCommands(skills);
  assert.equal(findExactSlashCommand(items, "/missing"), null);
});

test("findExactSlashCommand returns built-in /new", () => {
  const items = buildSlashCommands(skills);
  const item = findExactSlashCommand(items, "/new");
  assert.ok(item);
  assert.equal(item?.kind, "new");
});

test("findExactSlashCommand returns built-in /init", () => {
  const items = buildSlashCommands(skills);
  const item = findExactSlashCommand(items, "/init");
  assert.ok(item);
  assert.equal(item?.kind, "init");
  assert.equal(item?.description, "Initialize an AGENTS.md file with instructions for LLM");
});

test("findExactSlashCommand returns built-in /continue", () => {
  const items = buildSlashCommands(skills);
  const item = findExactSlashCommand(items, "/continue");
  assert.ok(item);
  assert.equal(item?.kind, "continue");
});

test("findExactSlashCommand returns built-in /undo", () => {
  const items = buildSlashCommands(skills);
  const item = findExactSlashCommand(items, "/undo");
  assert.ok(item);
  assert.equal(item?.kind, "undo");
});

test("/compact is suggested and the built-in takes precedence over a skill with the same name", () => {
  const items = buildSlashCommands([{ name: "compact", path: "/skills/compact/SKILL.md", description: "A skill" }]);
  assert.ok(filterSlashCommands(items, "/comp").some((item) => item.kind === "compact"));
  const command = findExactSlashCommand(items, "/compact");
  assert.equal(command?.kind, "compact");
  assert.equal(command?.description, "Compact the current conversation");
});

test("findExactSlashCommand returns built-in /skills", () => {
  const items = buildSlashCommands(skills);
  const item = findExactSlashCommand(items, "/skills");
  assert.ok(item);
  assert.equal(item?.kind, "skills");
});

test("findExactSlashCommand returns built-in /model", () => {
  const items = buildSlashCommands(skills);
  const item = findExactSlashCommand(items, "/model");
  assert.ok(item);
  assert.equal(item?.kind, "model");
});

test("findExactSlashCommand returns built-in /plan", () => {
  const items = buildSlashCommands(skills);
  const item = findExactSlashCommand(items, "/plan");
  assert.ok(item);
  assert.equal(item?.kind, "plan");
});

test("findExactSlashCommand returns built-in /raw", () => {
  const items = buildSlashCommands(skills);
  const item = findExactSlashCommand(items, "/raw");
  assert.ok(item);
  assert.equal(item?.kind, "raw");
});

test("findExactSlashCommand returns the matching skill", () => {
  const items = buildSlashCommands(skills);
  const item = findExactSlashCommand(items, "/code-review");
  assert.ok(item);
  assert.equal(item?.kind, "skill");
  assert.equal(item?.skill?.name, "code-review");
});

test("resolveSlashSubmission treats a bare command as a command", () => {
  const items = buildSlashCommands(skills);
  assert.deepEqual(resolveSlashSubmission(items, "/plan"), {
    kind: "command",
    item: items.find((item) => item.kind === "plan"),
  });
});

test("resolveSlashSubmission sends /plan arguments as a one-shot prompt", () => {
  const items = buildSlashCommands(skills);
  const result = resolveSlashSubmission(items, "/plan   重构权限模块，先梳理现状  ");
  assert.equal(result?.kind, "plan");
  assert.equal(result?.kind === "plan" ? result.text : "", "重构权限模块，先梳理现状");
});

test("resolveSlashSubmission keeps newlines inside a /plan prompt", () => {
  const items = buildSlashCommands(skills);
  const result = resolveSlashSubmission(items, "/plan\nline one\n  line two");
  assert.equal(result?.kind, "plan");
  assert.equal(result?.kind === "plan" ? result.text : "", "line one\n  line two");
});

test("resolveSlashSubmission applies a valid /raw argument", () => {
  const items = buildSlashCommands(skills);
  const result = resolveSlashSubmission(items, "/raw lite");
  assert.equal(result?.kind, "raw");
  assert.equal(result?.kind === "raw" ? result.mode : "", "lite");
});

test("resolveSlashSubmission rejects an unknown /raw argument", () => {
  const items = buildSlashCommands(skills);
  const result = resolveSlashSubmission(items, "/raw verbose");
  assert.equal(result?.kind, "argument-error");
  assert.equal(result?.kind === "argument-error" ? result.argument : "", "verbose");
});

test("resolveSlashSubmission keeps existing behavior for other commands", () => {
  const items = buildSlashCommands(skills);
  const result = resolveSlashSubmission(items, "/new keep this text");
  assert.equal(result?.kind, "command");
  assert.equal(result?.kind === "command" ? result.item.kind : "", "new");
});

test("resolveSlashSubmission does not block /compact arguments", () => {
  const items = buildSlashCommands(skills);
  const result = resolveSlashSubmission(items, "/compact extra text");
  assert.equal(result?.kind, "command");
  assert.equal(result?.kind === "command" ? result.item.kind : "", "compact");
});

test("resolveSlashSubmission leaves unknown slash text as a normal prompt", () => {
  const items = buildSlashCommands(skills);
  assert.equal(resolveSlashSubmission(items, "/planning is not a command"), null);
});

test("formatSlashCommandDescription keeps descriptions on one line", () => {
  assert.equal(formatSlashCommandDescription("Line one\n  line two"), "Line one line two");
});

test("formatSlashCommandLabel marks loaded skills", () => {
  const items = buildSlashCommands([
    { name: "loaded", path: "/skills/loaded/SKILL.md", description: "Loaded skill", isLoaded: true },
    { name: "fresh", path: "/skills/fresh/SKILL.md", description: "Fresh skill" },
  ]);

  assert.equal(formatSlashCommandLabel(items[0]), "/loaded ✓");
  assert.equal(formatSlashCommandLabel(items[1]), "/fresh");
});

test("permissions command supports completion and takes precedence over a same-name skill", () => {
  const items = buildSlashCommands([
    { name: "permissions", path: "/skills/permissions/SKILL.md", description: "skill" },
  ]);
  assert.ok(filterSlashCommands(items, "/perm").some((item) => item.kind === "permissions"));
  const submission = resolveSlashSubmission(items, "/permissions");
  assert.equal(submission?.kind, "command");
  assert.equal(submission?.item.kind, "permissions");
});
