import { afterEach, describe, it, type TestContext } from "node:test";
import assert from "node:assert/strict";
import childProcess from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  PRIVATE_FILE_MODE,
  PRIVATE_DIRECTORY_MODE,
  ensurePrivateDirectory,
  restrictWindowsAcl,
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

/**
 * Pretend to be Windows and record every execFileSync call.  The platform
 * property is patched so these regression tests run on every OS upstream CI
 * uses — the icacls ordering bug is Windows-only and would otherwise get zero
 * coverage off-Windows.  ``restore()`` puts platform/env back; the mock itself
 * is unwound by node:test at test end.
 */
function pretendWindows(
  t: TestContext,
  impl: (cmd: string, args: string[]) => string
): { calls: string[][]; restore: () => void } {
  const platformDesc = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { value: "win32", configurable: true });
  const prevDomain = process.env.USERDOMAIN;
  const prevUser = process.env.USERNAME;
  process.env.USERDOMAIN = "TESTDOM";
  process.env.USERNAME = "testuser";
  const calls: string[][] = [];
  t.mock.method(childProcess, "execFileSync", (cmd: string, args: string[] = []) => {
    calls.push([cmd, ...args]);
    return impl(cmd, args);
  });
  return {
    calls,
    restore: () => {
      if (platformDesc) {
        Object.defineProperty(process, "platform", platformDesc);
      }
      if (prevDomain === undefined) delete process.env.USERDOMAIN;
      else process.env.USERDOMAIN = prevDomain;
      if (prevUser === undefined) delete process.env.USERNAME;
      else process.env.USERNAME = prevUser;
    },
  };
}

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

    const out = childProcess.execFileSync("icacls", [file], {
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

  it("grants the user before stripping inheritance (fail-safe order)", (t) => {
    // Regression: when the strip ran first, a failed grant left the path with
    // no ACE at all and the next write threw EPERM (errno -4048).
    const { calls, restore } = pretendWindows(t, () => "");
    try {
      assert.equal(restrictWindowsAcl("C:\\state\\settings.json"), true, "clean run must report success");
    } finally {
      restore();
    }
    assert.deepEqual(
      calls.map((args) => args.slice(1)),
      [
        ["C:\\state\\settings.json", "/grant:r", "TESTDOM\\testuser:F"],
        ["C:\\state\\settings.json", "/inheritance:r"],
      ],
      "the grant must be issued before the inheritance strip"
    );
  });

  it("keeps the inherited ACEs when the grant fails (no lockout)", (t) => {
    const { calls, restore } = pretendWindows(t, (_cmd, args) => {
      if (args.includes("/grant:r")) {
        throw Object.assign(new Error("icacls: Access is denied."), { status: 5 });
      }
      return "";
    });
    try {
      assert.equal(restrictWindowsAcl("C:\\state\\settings.json"), false, "a failed grant must report failure");
    } finally {
      restore();
    }
    // Negative control: stripping after a failed grant is the lockout.  The
    // inherited ACEs must stay untouched so the path remains usable.
    assert.ok(
      calls.some((args) => args.includes("/grant:r")),
      "the grant must have been attempted"
    );
    assert.ok(
      calls.every((args) => !args.includes("/inheritance:r")),
      `inheritance must not be stripped after a failed grant: ${JSON.stringify(calls)}`
    );
  });

  it("directory grants are inheritable so children keep access", (t) => {
    // Root cause companion: /inheritance:r on a directory propagates to its
    // children, so the grant must already reach them ((OI)(CI)) or the state
    // files inside become unopenable.
    const { calls, restore } = pretendWindows(t, () => "");
    const dir = tempDir("dc-priv-dir-acl-");
    try {
      assert.equal(ensurePrivateDirectory(path.join(dir, "deep")), true, "directory must report success");
    } finally {
      restore();
    }
    assert.deepEqual(
      calls.map((args) => args.slice(1)),
      [
        [path.join(dir, "deep"), "/grant:r", "TESTDOM\\testuser:(OI)(CI)F"],
        [path.join(dir, "deep"), "/inheritance:r"],
      ],
      "directory grants must be inheritable and come first"
    );
  });
});
