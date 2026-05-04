import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSlashCommands,
  filterSlashCommands,
  findExactSlashCommand,
  formatSlashCommandDescription,
  formatSlashCommandLabel
} from "../ui";
import type { SkillInfo } from "../session";

const skills: SkillInfo[] = [
  { name: "skill-writer", path: "~/.agents/skills/skill-writer/SKILL.md", description: "Write a SKILL.md" },
  { name: "code-review", path: "~/.agents/skills/code-review/SKILL.md", description: "Review code" }
];

test("buildSlashCommands prefixes skills before built-ins", () => {
  const items = buildSlashCommands(skills);
  assert.equal(items[0].kind, "skill");
  assert.equal(items[0].name, "skill-writer");
  const builtinNames = items.filter((i) => i.kind !== "skill").map((i) => i.name);
  assert.deepEqual(builtinNames, ["skills", "new", "resume", "exit"]);
});

test("filterSlashCommands matches partial prefixes", () => {
  const items = buildSlashCommands(skills);
  const matched = filterSlashCommands(items, "/skil").map((i) => i.name);
  assert.deepEqual(matched, ["skill-writer", "skills"]);
});

test("filterSlashCommands returns all entries on bare slash", () => {
  const items = buildSlashCommands(skills);
  const matched = filterSlashCommands(items, "/");
  assert.equal(matched.length, items.length);
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

test("findExactSlashCommand returns built-in /skills", () => {
  const items = buildSlashCommands(skills);
  const item = findExactSlashCommand(items, "/skills");
  assert.ok(item);
  assert.equal(item?.kind, "skills");
});

test("findExactSlashCommand returns the matching skill", () => {
  const items = buildSlashCommands(skills);
  const item = findExactSlashCommand(items, "/code-review");
  assert.ok(item);
  assert.equal(item?.kind, "skill");
  assert.equal(item?.skill?.name, "code-review");
});

test("formatSlashCommandDescription keeps descriptions on one line", () => {
  assert.equal(formatSlashCommandDescription("Line one\n  line two"), "Line one line two");
});

test("formatSlashCommandLabel marks loaded skills", () => {
  const items = buildSlashCommands([
    { name: "loaded", path: "/skills/loaded/SKILL.md", description: "Loaded skill", isLoaded: true },
    { name: "fresh", path: "/skills/fresh/SKILL.md", description: "Fresh skill" }
  ]);

  assert.equal(formatSlashCommandLabel(items[0]), "/loaded ✓");
  assert.equal(formatSlashCommandLabel(items[1]), "/fresh");
});
