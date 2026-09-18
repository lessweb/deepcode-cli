import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { ToolExecutionContext } from "../tools/executor";
import { handleReadTool } from "../tools/read-handler";
import { handleWriteTool } from "../tools/write-handler";
import { platformLineEnding } from "../common/file-utils";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

function createTempWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "deepcode-line-endings-"));
  tempDirs.push(dir);
  return dir;
}

function createContext(sessionId: string, projectRoot: string): ToolExecutionContext {
  return {
    sessionId,
    projectRoot,
    toolCall: {
      id: "test-tool-call",
      type: "function",
      function: {
        name: "write",
        arguments: "{}",
      },
    },
  };
}

test("platformLineEnding reports CRLF only on Windows-style platforms", () => {
  assert.equal(platformLineEnding("\r\n"), "CRLF");
  assert.equal(platformLineEnding("\n"), "LF");
});

test("a newly created file uses the platform-native line ending", async () => {
  // Models emit LF-only text. A created file has no existing EOL to preserve, so it
  // should follow the platform: CRLF on Windows, matching what native tooling writes.
  const workspace = createTempWorkspace();
  const filePath = path.join(workspace, "created.txt");

  await handleWriteTool({ file_path: filePath, content: "one\ntwo" }, createContext("create-eol", workspace));

  const expected = platformLineEnding() === "CRLF" ? "one\r\ntwo" : "one\ntwo";
  assert.equal(fs.readFileSync(filePath, "utf8"), expected);
});

test("an existing CRLF file keeps its line endings when rewritten with LF content", async () => {
  const workspace = createTempWorkspace();
  const filePath = path.join(workspace, "existing.txt");
  fs.writeFileSync(filePath, "one\r\ntwo\r\n", "utf8");
  const context = createContext("keep-eol", workspace);

  await handleReadTool({ file_path: filePath }, context);
  await handleWriteTool({ file_path: filePath, content: "one\ntwo\n" }, context);

  assert.equal(fs.readFileSync(filePath, "utf8"), "one\r\ntwo\r\n");
});
