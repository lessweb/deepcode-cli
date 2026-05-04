import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWelcomeTips, formatHomeRelativePath } from "../ui";

test("formatHomeRelativePath returns tilde for the home directory", () => {
  assert.equal(formatHomeRelativePath("/Users/example", "/Users/example"), "~");
});

test("formatHomeRelativePath shortens paths inside the home directory", () => {
  assert.equal(formatHomeRelativePath("/Users/example/dev/project", "/Users/example"), "~/dev/project");
});

test("formatHomeRelativePath keeps paths outside the home directory absolute", () => {
  assert.equal(formatHomeRelativePath("/tmp/project", "/Users/example"), "/tmp/project");
});

test("buildWelcomeTips includes built-in slash commands and loaded skills", () => {
  const tips = buildWelcomeTips([
    { name: "loaded", path: "/skills/loaded/SKILL.md", description: "Loaded skill", isLoaded: true },
    { name: "fresh", path: "/skills/fresh/SKILL.md", description: "Fresh skill" }
  ]);

  const labels = tips.map((tip) => tip.label);
  assert.ok(labels.includes("/new"));
  assert.ok(labels.includes("/loaded"));
  assert.equal(labels.includes("/fresh"), false);
});
