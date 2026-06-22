import { test } from "node:test";
import assert from "node:assert/strict";
import * as os from "os";
import * as path from "path";
import { buildWelcomeTips, formatHomeRelativePath } from "../ui";

test("formatHomeRelativePath returns tilde for the home directory", () => {
  const home = path.resolve("/Users/example");
  assert.equal(formatHomeRelativePath(home, home), "~");
});

test("formatHomeRelativePath shortens paths inside the home directory", () => {
  const home = path.resolve("/Users/example");
  const result = formatHomeRelativePath(path.resolve("/Users/example/dev/project"), home);
  assert.equal(result, `~${path.sep}dev${path.sep}project`);
});

test("formatHomeRelativePath keeps paths outside the home directory absolute", () => {
  const home = path.resolve("/Users/example");
  const other = path.resolve("/tmp/project");
  // The result should be the absolute path since it's outside home
  const result = formatHomeRelativePath(other, home);
  assert.equal(result, other);
});

test("buildWelcomeTips includes built-in slash commands and loaded skills", () => {
  const tips = buildWelcomeTips([
    { name: "loaded", path: "/skills/loaded/SKILL.md", description: "Loaded skill", isLoaded: true },
    { name: "fresh", path: "/skills/fresh/SKILL.md", description: "Fresh skill" },
  ]);

  const labels = tips.map((tip) => tip.label);
  assert.ok(labels.includes("/new"));
  assert.ok(labels.includes("/loaded"));
  assert.ok(labels.includes("Ctrl+R"));
  assert.equal(labels.includes("/fresh"), false);
});
