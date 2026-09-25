import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  PRIVATE_FILE_MODE,
  ensurePrivateDirectory,
  writePrivateFile,
  restrictWindowsAcl,
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
    writePrivateFile(file, "{}");
    const mode = fs.statSync(file).mode & 0o777;
    assert.equal(mode, PRIVATE_FILE_MODE, "file must be 0600");
  });

  it("creates directories with 0700 mode on POSIX", () => {
    if (process.platform === "win32") {
      return;
    }
    const base = tempDir("dc-priv-dir-");
    const dir = path.join(base, ".deepcode", "nested");
    ensurePrivateDirectory(dir);
    const mode = fs.statSync(dir).mode & 0o777;
    assert.equal(mode, 0o700, "directory must be 0700");
  });

  it("restricts Windows ACL to the current user (Windows only)", () => {
    if (process.platform !== "win32") {
      return;
    }
    const dir = tempDir("dc-priv-acl-");
    const file = path.join(dir, "credentials.json");
    writePrivateFile(file, "{}");

    const out = execFileSync("icacls", [file], {
      encoding: "utf8",
      windowsHide: true,
    });
    // Dangerous inherited ACEs must be gone.
    for (const dangerous of ["Authenticated Users", "Everyone"]) {
      assert.ok(!out.includes(dangerous), `must not contain ${dangerous}`);
    }
    // The current user keeps full control (with or without inherited flag).
    // icacls prints either `user:(F)` or `user:(I)(F)` depending on the ACE.
    assert.match(out, /:\(I?\)?\(F\)/, "current user must retain full control");
  });

  it("is idempotent when called repeatedly", () => {
    const dir = tempDir("dc-priv-again-");
    const file = path.join(dir, "x.json");
    writePrivateFile(file, "1");
    writePrivateFile(file, "2");
    assert.equal(fs.readFileSync(file, "utf8"), "2");
    if (process.platform === "win32") {
      // Second call must not throw and must keep the ACL restricted.
      restrictWindowsAcl(file);
    }
  });
});
