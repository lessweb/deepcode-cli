import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  PRIVATE_FILE_MODE,
  PRIVATE_DIRECTORY_MODE,
  ensurePrivateDirectory,
  windowsIdentity,
  writePrivateFile,
} from "../common/private-storage";

const tempDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("private-storage", () => {
  it("writes files with 0600 mode on POSIX", () => {
    if (process.platform === "win32") {
      return; // mode bits are ignored on Windows
    }
    const dir = tempDir("dc-priv-posix-");
    const file = path.join(dir, "secret.json");
    // The strict return value is part of the contract: true means the caller
    // has a private file, false must never masquerade as success.
    assert.equal(writePrivateFile(file, "{}"), true, "writePrivateFile must report success");
    const mode = fs.statSync(file).mode & 0o777;
    assert.equal(mode, PRIVATE_FILE_MODE, "file must be 0600");
  });

  it("creates directories with 0700 mode on POSIX", () => {
    if (process.platform === "win32") {
      return;
    }
    const base = tempDir("dc-priv-dir-");
    const dir = path.join(base, ".deepcode", "nested");
    assert.equal(ensurePrivateDirectory(dir), true, "ensurePrivateDirectory must report success");
    const mode = fs.statSync(dir).mode & 0o777;
    assert.equal(mode, PRIVATE_DIRECTORY_MODE, "directory must be 0700");
  });

  it("restricts the Windows ACL to the current user (Windows only)", (t) => {
    if (process.platform !== "win32") {
      return;
    }
    const dir = tempDir("dc-priv-acl-");
    const file = path.join(dir, "credentials.json");
    const applied = writePrivateFile(file, "{}");
    if (!applied) {
      // Say "not verified" out loud instead of passing vacuously: a file that
      // icacls could not touch must never look like a green ACL test.
      t.skip("icacls could not restrict the ACL in this environment");
      return;
    }

    const out = execFileSync("icacls", [file], {
      encoding: "utf8",
      windowsHide: true,
    });

    // 1. /inheritance:r really ran: not one inherited ACE may survive.  This is
    //    the assertion that catches a silent no-op, where the file keeps the
    //    permissive ACEs it inherited from its parent directory.
    assert.ok(!out.includes("(I)"), `inherited ACEs still apply:\n${out}`);

    // 2. The current user keeps full control.  icacls prints `DOMAIN\user:(F)`
    //    for an explicit ACE and `DOMAIN\user:(I)(F)` when it is inherited, so
    //    read the exact principal back instead of matching a loose pattern.
    const identity = windowsIdentity();
    assert.ok(identity, "windowsIdentity() must resolve the current user");
    assert.ok(out.includes(`${identity}:(F)`), `${identity} must keep (F):\n${out}`);

    // 3. No broad principal keeps access.  These are the English Windows names;
    //    a localized build passes this trivially, which assertion 1 covers.
    for (const broad of ["Authenticated Users", "Everyone"]) {
      assert.ok(!out.includes(broad), `must not grant ${broad}:\n${out}`);
    }
  });

  it("is idempotent when called repeatedly", () => {
    const dir = tempDir("dc-priv-again-");
    const file = path.join(dir, "x.json");
    const first = writePrivateFile(file, "1");
    const second = writePrivateFile(file, "2");
    assert.equal(fs.readFileSync(file, "utf8"), "2", "last write must win");
    assert.equal(second, first, "repeated writes must report the same outcome");
  });
});
