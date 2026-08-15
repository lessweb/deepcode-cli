import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { ToolExecutionContext } from "../tools/executor";
import { handleReadTool } from "../tools/read-handler";

const tempDirs: string[] = [];

test.afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

function createContext(projectRoot: string, model: string): ToolExecutionContext {
  return {
    sessionId: "read-test",
    projectRoot,
    toolCall: {
      id: "tool-call-id",
      type: "function",
      function: {
        name: "read",
        arguments: "{}",
      },
    },
    createOpenAIClient: () => ({
      client: null,
      model,
      thinkingEnabled: false,
    }),
  };
}

function createPng(workspace: string): string {
  const filePath = path.join(workspace, "test.png");
  fs.writeFileSync(filePath, Buffer.from("fakepngdata", "utf8"));
  return filePath;
}

test("read tool does not attach image content for text-only models (#181)", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "deepcode-read-"));
  tempDirs.push(workspace);
  const filePath = createPng(workspace);

  const result = await handleReadTool({ file_path: filePath }, createContext(workspace, "deepseek-reasoner"));

  assert.equal(result.ok, true);
  assert.equal(result.followUpMessages, undefined);
  assert.match(result.output ?? "", /does not support images/);
});

test("read tool attaches image content for multimodal models (#181)", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "deepcode-read-"));
  tempDirs.push(workspace);
  const filePath = createPng(workspace);

  const result = await handleReadTool({ file_path: filePath }, createContext(workspace, "gpt-4o"));

  assert.equal(result.ok, true);
  assert.equal(result.output, "File loaded.");
  assert.ok(Array.isArray(result.followUpMessages));
  const contentParams = result.followUpMessages?.[0]?.contentParams as unknown[] | undefined;
  assert.ok(Array.isArray(contentParams));
  assert.equal((contentParams[0] as { type?: string }).type, "image_url");
});
