import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { formatDisplayPath } from "../ui/core/display-path";

test("display paths prefer project-relative, then home-relative, then absolute paths", () => {
  const home = path.resolve("/users/test");
  const root = path.join(home, "project");
  const cases = [
    [path.join(root, "src/file.ts"), path.join("src", "file.ts")],
    [path.join(home, "notes.txt"), "~/notes.txt"],
    [path.join(home, "project-other/file.ts"), "~/project-other/file.ts"],
    [path.resolve("/users/test-other/file.ts"), path.resolve("/users/test-other/file.ts")],
    [path.resolve("/external/file.ts"), path.resolve("/external/file.ts")],
    ["src/file.ts", path.join("src", "file.ts")],
    [path.join(root, "..hidden/file.ts"), path.join("..hidden", "file.ts")],
    ["", ""],
  ];
  for (const [input, expected] of cases) assert.equal(formatDisplayPath(input, root, home), expected);
});
