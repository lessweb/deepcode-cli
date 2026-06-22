import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ToolExecutor } from "../tools/executor";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("ToolExecutor accepts title-case built-in tool aliases", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "deepcode-tool-executor-"));
  tempDirs.push(workspace);
  const filePath = path.join(workspace, "sample.txt");
  fs.writeFileSync(filePath, "alpha\nbeta\n", "utf8");

  const executor = new ToolExecutor(workspace);
  const executions = await executor.executeToolCalls("alias-session", [
    {
      id: "call-read",
      type: "function",
      function: {
        name: "Read",
        arguments: JSON.stringify({ file_path: filePath }),
      },
    },
  ]);

  assert.equal(executions.length, 1);
  assert.equal(executions[0]?.result.ok, true);
  assert.equal(executions[0]?.result.name, "read");
  assert.match(executions[0]?.result.output ?? "", /alpha/);
});
