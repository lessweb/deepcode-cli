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

test(
  "read tool extracts PDF text when pdftotext is available (#236)",
  { skip: process.platform === "win32" },
  async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "deepcode-read-"));
    tempDirs.push(workspace);

    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "deepcode-bin-"));
    tempDirs.push(binDir);
    const fakeBin = path.join(binDir, "pdftotext");
    fs.writeFileSync(fakeBin, '#!/bin/sh\nprintf "extracted pdf text from %s\\n" "$2"\n', { mode: 0o755 });

    const filePath = path.join(workspace, "sample.pdf");
    fs.writeFileSync(filePath, Buffer.from("%PDF-1.4 fake pdf bytes", "latin1"));

    const originalPath = process.env.PATH;
    process.env.PATH = `${binDir}${path.delimiter}${originalPath ?? ""}`;
    try {
      const result = await handleReadTool({ file_path: filePath }, createContext(workspace, "deepseek-v4-flash"));
      assert.equal(result.ok, true);
      assert.match(result.output ?? "", /extracted pdf text from/);
      assert.equal((result.metadata as { encoding?: string }).encoding, "text");
    } finally {
      if (originalPath === undefined) {
        delete process.env.PATH;
      } else {
        process.env.PATH = originalPath;
      }
    }
  }
);

test("read tool falls back to binary warning when pdftotext is unavailable (#236)", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "deepcode-read-"));
  tempDirs.push(workspace);

  const emptyBin = fs.mkdtempSync(path.join(os.tmpdir(), "deepcode-emptybin-"));
  tempDirs.push(emptyBin);

  const filePath = path.join(workspace, "sample.pdf");
  fs.writeFileSync(filePath, Buffer.from("%PDF-1.4 fake pdf bytes", "latin1"));

  const originalPath = process.env.PATH;
  process.env.PATH = emptyBin;
  try {
    const result = await handleReadTool({ file_path: filePath }, createContext(workspace, "deepseek-v4-flash"));
    assert.equal(result.ok, true);
    assert.equal(result.output, "WARNING: File is binary.");
    assert.equal((result.metadata as { encoding?: string }).encoding, "base64");
  } finally {
    if (originalPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = originalPath;
    }
  }
});
