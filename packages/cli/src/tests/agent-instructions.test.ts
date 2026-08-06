import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAgentInstructionsReport } from "../ui/core/agent-instructions";

test("buildAgentInstructionsReport highlights the loaded file (#262)", () => {
  const report = buildAgentInstructionsReport([
    { displayPath: "./.deepcode/AGENTS.md", absolutePath: "/p/.deepcode/AGENTS.md", exists: true, loaded: true },
    { displayPath: "./AGENTS.md", absolutePath: "/p/AGENTS.md", exists: true, loaded: false },
    { displayPath: "~/.deepcode/AGENTS.md", absolutePath: "/home/u/.deepcode/AGENTS.md", exists: false, loaded: false },
  ]);
  assert.match(report, /Agent instructions loaded from \.\/\.deepcode\/AGENTS\.md/);
  assert.match(report, /\.\/\.deepcode\/AGENTS\.md — loaded/);
  assert.match(report, /\.\/AGENTS\.md — present/);
  assert.match(report, /~\/\.deepcode\/AGENTS\.md — not found/);
});

test("buildAgentInstructionsReport handles the no-instructions case (#262)", () => {
  const report = buildAgentInstructionsReport([
    { displayPath: "./.deepcode/AGENTS.md", absolutePath: "/p/.deepcode/AGENTS.md", exists: false, loaded: false },
    { displayPath: "./AGENTS.md", absolutePath: "/p/AGENTS.md", exists: false, loaded: false },
    { displayPath: "~/.deepcode/AGENTS.md", absolutePath: "/home/u/.deepcode/AGENTS.md", exists: false, loaded: false },
  ]);
  assert.match(report, /No AGENTS\.md instruction file found/);
});
