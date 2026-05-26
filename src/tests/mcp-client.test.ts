import { test } from "node:test";
import assert from "node:assert/strict";
import { createMcpSpawnSpec } from "../mcp/mcp-client";

test("createMcpSpawnSpec keeps non-Windows MCP launches shell-free", () => {
  assert.deepEqual(createMcpSpawnSpec("npx", ["-y", "@playwright/mcp@latest"], "darwin"), {
    command: "npx",
    args: ["-y", "@playwright/mcp@latest"],
    shell: false,
  });
});

test("createMcpSpawnSpec avoids Windows shell args for Node 24", () => {
  assert.deepEqual(createMcpSpawnSpec("npx", ["-y", "@playwright/mcp@latest"], "win32"), {
    command: '"npx" "-y" "@playwright/mcp@latest"',
    args: [],
    shell: true,
    windowsHide: true,
  });
});

test("createMcpSpawnSpec quotes Windows command paths and arguments", () => {
  const spec = createMcpSpawnSpec(
    String.raw`C:\Program Files\nodejs\node.exe`,
    [String.raw`C:\tmp\mcp server.cjs`, 'a "quoted" value'],
    "win32"
  );

  assert.equal(
    spec.command,
    String.raw`"C:\Program Files\nodejs\node.exe" "C:\tmp\mcp server.cjs" "a \"quoted\" value"`
  );
  assert.deepEqual(spec.args, []);
});
