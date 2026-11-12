import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { ToolExecutionContext } from "../tools/executor";
import { handleReadTool } from "../tools/read-handler";
import { handleWriteTool } from "../tools/write-handler";
import { newFileLineEnding, platformLineEnding } from "../common/file-utils";

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

function createRepository(attributes: string): string {
  const workspace = createTempWorkspace();
  childProcess.execFileSync("git", ["init", "--quiet", workspace]);
  // Keep the fixture independent of the developer's global Git attributes.
  childProcess.execFileSync("git", ["config", "core.attributesFile", os.devNull], { cwd: workspace });
  fs.writeFileSync(path.join(workspace, ".gitattributes"), attributes);
  return workspace;
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

test("a new file without Git attributes uses the platform ending regardless of model content", async () => {
  const workspace = createTempWorkspace();
  fs.writeFileSync(path.join(workspace, ".editorconfig"), "root = true\n[*]\nend_of_line = crlf\n");

  for (const [index, content] of ["one\ntwo", "one\r\ntwo"].entries()) {
    const filePath = path.join(workspace, `created-${index}.txt`);
    const result = await handleWriteTool({ file_path: filePath, content }, createContext("create-eol", workspace));

    assert.equal(result.ok, true, result.error);
    assert.equal(fs.readFileSync(filePath, "utf8"), `one${os.EOL}two`);
    assert.equal(result.metadata?.bytes, Buffer.byteLength(`one${os.EOL}two`));
    assert.equal(result.metadata?.line_endings, os.EOL === "\r\n" ? "CRLF" : "LF");
  }
});

for (const eol of ["lf", "crlf"] as const) {
  test(`new files honor eol=${eol} over both platform defaults and model content`, async () => {
    const workspace = createRepository(`* text=auto eol=${eol}\n`);
    const filePath = path.join(workspace, "new directory", "你好 file.txt");
    // The handler must create missing parent directories before asking Git.
    const content = eol === "lf" ? "one\r\ntwo\r\n" : "one\ntwo\n";
    const result = await handleWriteTool({ file_path: filePath, content }, createContext(`create-${eol}`, workspace));
    const ending = eol === "lf" ? "\n" : "\r\n";
    const expected = `one${ending}two${ending}`;

    assert.equal(result.ok, true, result.error);
    assert.equal(fs.readFileSync(filePath, "utf8"), expected);
    assert.equal(result.metadata?.bytes, Buffer.byteLength(expected));
    assert.equal(result.metadata?.line_endings, eol.toUpperCase());
    for (const platformEol of ["\n", "\r\n"]) {
      assert.equal(newFileLineEnding(filePath, platformEol), eol.toUpperCase());
    }
  });

  test(`existing ${eol} files retain their encoding and endings despite conflicting attributes`, async () => {
    const workspace = createRepository(`* text eol=${eol === "lf" ? "crlf" : "lf"}\n`);
    for (const encoding of ["utf8", "utf16le"] as const) {
      const filePath = path.join(workspace, `existing-${encoding}.txt`);
      const ending = eol === "lf" ? "\n" : "\r\n";
      const bom = encoding === "utf16le" ? "\uFEFF" : "";
      fs.writeFileSync(filePath, `${bom}one${ending}two${ending}`, encoding);
      const context = createContext(`keep-${eol}-${encoding}`, workspace);
      const readResult = await handleReadTool({ file_path: filePath }, context);
      assert.equal(readResult.ok, true, readResult.error);
      const content = eol === "lf" ? `${bom}one\r\nchanged` : `${bom}one\nchanged`;
      const result = await handleWriteTool({ file_path: filePath, content }, context);

      assert.equal(result.ok, true, result.error);
      assert.deepEqual(fs.readFileSync(filePath), Buffer.from(`${bom}one${ending}changed`, encoding));
      assert.equal(result.metadata?.encoding, encoding);
      assert.equal(result.metadata?.line_endings, eol.toUpperCase());
    }
  });
}

test("nested attributes and later matching rules follow Git precedence", async () => {
  const workspace = createRepository("* text eol=lf\n*.cmd eol=crlf\n");
  const nested = path.join(workspace, "nested");
  fs.mkdirSync(nested);
  fs.writeFileSync(path.join(nested, ".gitattributes"), '* eol=crlf\n*.txt eol=lf\n"space name.txt" eol=crlf\n');

  for (const [relativePath, ending] of [
    ["root.txt", "\n"],
    ["root.cmd", "\r\n"],
    ["nested/file.ts", "\r\n"],
    ["nested/file.txt", "\n"],
    ["nested/space name.txt", "\r\n"],
  ]) {
    const filePath = path.join(workspace, relativePath);
    const result = await handleWriteTool(
      { file_path: filePath, content: "one\ntwo\n" },
      createContext("nested-attributes", workspace)
    );
    assert.equal(result.ok, true, result.error);
    assert.equal(fs.readFileSync(filePath, "utf8"), `one${ending}two${ending}`, relativePath);
  }
});

test("unspecified, unset, invalid, and binary attributes fall back to the platform", () => {
  const workspace = createRepository(
    [
      "*.txt text eol=crlf",
      "unspecified.txt !eol",
      "unset.txt -eol",
      "invalid.txt eol=native",
      "binary.txt binary",
      "no-text.txt -text",
      "auto.txt text=auto !eol",
    ].join("\n") + "\n"
  );
  childProcess.execFileSync("git", ["config", "core.eol", "crlf"], { cwd: workspace });

  for (const fileName of [
    "unmatched.ts",
    "unspecified.txt",
    "unset.txt",
    "invalid.txt",
    "binary.txt",
    "no-text.txt",
    "auto.txt",
  ]) {
    const filePath = path.join(workspace, fileName);
    assert.equal(newFileLineEnding(filePath, "\n"), "LF", fileName);
    assert.equal(newFileLineEnding(filePath, "\r\n"), "CRLF", fileName);
  }
});

test("Git lookup failures fall back without blocking file creation", async (t) => {
  const workspace = createTempWorkspace();
  t.mock.method(childProcess, "execFileSync", () => {
    throw Object.assign(new Error("spawnSync git ENOENT"), { code: "ENOENT" });
  });
  const filePath = path.join(workspace, "created.txt");
  assert.equal(newFileLineEnding(filePath, "\n"), "LF");
  assert.equal(newFileLineEnding(filePath, "\r\n"), "CRLF");
  const result = await handleWriteTool(
    { file_path: filePath, content: "one\ntwo\n" },
    createContext("no-git", workspace)
  );
  assert.equal(result.ok, true, result.error);
  assert.equal(fs.readFileSync(filePath, "utf8"), `one${os.EOL}two${os.EOL}`);
});

test("new files outside the session project use their own repository attributes", async () => {
  const projectRoot = createRepository("* text eol=lf\n");
  const targetRoot = createRepository("* text eol=crlf\n");
  const filePath = path.join(targetRoot, "outside.txt");
  const result = await handleWriteTool(
    { file_path: filePath, content: "one\ntwo\n" },
    createContext("outside-project", projectRoot)
  );
  assert.equal(result.ok, true, result.error);
  assert.equal(fs.readFileSync(filePath, "utf8"), "one\r\ntwo\r\n");
});
