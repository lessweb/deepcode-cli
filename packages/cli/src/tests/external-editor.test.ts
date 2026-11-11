import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { syncBuiltinESMExports } from "node:module";
import { test, type TestContext } from "node:test";
import { editInExternalEditor } from "../ui/core/external-editor";

function mockVim(t: TestContext, action: (file: string, child: EventEmitter) => void) {
  const files: string[] = [];
  t.mock.method(childProcess, "spawn", (command: string, args: string[], options: unknown) => {
    assert.equal(command, "vim");
    assert.equal(args.length, 1);
    assert.deepEqual(options, { cwd: process.cwd(), stdio: "inherit", shell: false });
    const child = new EventEmitter();
    files.push(args[0]);
    queueMicrotask(() => {
      try {
        action(args[0], child);
      } catch (error) {
        child.emit("error", error);
      }
    });
    return child;
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    for (const file of files) assert.equal(fs.existsSync(path.dirname(file)), false);
  });
}

test("vim receives complete UTF-8 text and its saved contents are normalized", async (t) => {
  const seed = "中文 😀\n".repeat(1000);
  mockVim(t, (file, child) => {
    assert.equal(fs.readFileSync(file, "utf8"), seed);
    // Windows does not expose POSIX owner/group/other permission bits.
    if (process.platform !== "win32") assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    fs.writeFileSync(file, "edited 中文\r\nnext\r\n\r\n");
    child.emit("exit", 0, null);
  });
  assert.equal(await editInExternalEditor(seed, process.cwd()), "edited 中文\nnext\n");
});

test("unchanged files preserve trailing newlines and ignore editor environment configuration", async (t) => {
  for (const name of ["VISUAL", "EDITOR"]) {
    const previous = process.env[name];
    process.env[name] = "false";
    t.after(() => {
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    });
  }
  mockVim(t, (_file, child) => child.emit("exit", 0, null));
  assert.equal(await editInExternalEditor("draft\n\n", process.cwd()), "draft\n\n");
});

test("vim can save an empty prompt", async (t) => {
  mockVim(t, (file, child) => {
    fs.writeFileSync(file, "");
    child.emit("exit", 0, null);
  });
  assert.equal(await editInExternalEditor("draft", process.cwd()), "");
});

for (const failure of ["missing vim", "nonzero exit", "signal", "missing file"]) {
  test(`${failure} rejects and removes temporary files`, async (t) => {
    mockVim(t, (file, child) => {
      if (failure === "missing vim") child.emit("error", Object.assign(new Error("missing"), { code: "ENOENT" }));
      else if (failure === "nonzero exit") child.emit("exit", 1, null);
      else if (failure === "signal") child.emit("exit", null, "SIGTERM");
      else {
        fs.unlinkSync(file);
        child.emit("exit", 0, null);
      }
    });
    await assert.rejects(editInExternalEditor("draft", process.cwd()));
  });
}

test("temporary directory is removed even if writing the seed fails", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deepcode-editor-test-"));
  const promises = await import("node:fs/promises");
  t.mock.method(promises.default, "mkdtemp", async () => root);
  t.mock.method(promises.default, "writeFile", async () => {
    throw new Error("write failed");
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    fs.rmSync(root, { recursive: true, force: true });
  });
  await assert.rejects(editInExternalEditor("draft", process.cwd()), /write failed/);
  assert.equal(fs.existsSync(root), false);
});
