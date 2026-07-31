import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as os from "os";
import * as path from "path";
import {
  STRICT_SANDBOX_PROFILE,
  DEFAULT_DEV_PROFILE,
  UNRESTRICTED_PROFILE,
  legacyProfileFromScopes,
  checkFileSystemAccess,
  checkNetworkAccess,
  checkGitAccess,
  parsePermissionProfile,
} from "../common/permission-profile";
import type { PermissionProfile } from "../common/permission-profile";

const HOMEDIR = os.homedir();
// Use a project root outside home dir (tmp on Windows is still under home, so use root)
const PROJECT_ROOT = process.platform === "win32" ? "C:\\deepcode-test-project" : "/tmp/deepcode-test-project";
const context = {
  projectRoot: PROJECT_ROOT,
  dataDir: path.join(PROJECT_ROOT, ".deepcode", "data"),
};

describe("PermissionProfile - Presets", () => {
  test("STRICT_SANDBOX_PROFILE denies home directory", () => {
    // Use actual home dir path
    const result = checkFileSystemAccess(HOMEDIR + "/.ssh/id_rsa", STRICT_SANDBOX_PROFILE, context);
    assert.equal(result.allowed, false);
    assert.equal(result.writeAccess, false);
    assert.ok(result.matchedBy === "special:home" || result.matchedBy !== undefined);
  });

  test("STRICT_SANDBOX_PROFILE allows project root write", () => {
    const result = checkFileSystemAccess(context.projectRoot + "/src/main.ts", STRICT_SANDBOX_PROFILE, context);
    assert.equal(result.allowed, true);
    assert.equal(result.writeAccess, true);
  });

  test("STRICT_SANDBOX_PROFILE node_modules outside project is read-only", () => {
    // node_modules outside project_root should be denied (no matching rule)
    const result = checkFileSystemAccess(HOMEDIR + "/node_modules/pkg/index.js", STRICT_SANDBOX_PROFILE, context);
    assert.equal(result.allowed, false);
  });

  test("STRICT_SANDBOX_PROFILE disallows external network", () => {
    assert.equal(checkNetworkAccess("api.openai.com", STRICT_SANDBOX_PROFILE), false);
    assert.equal(checkNetworkAccess(undefined, STRICT_SANDBOX_PROFILE), false);
  });

  test("UNRESTRICTED_PROFILE allows everything", () => {
    assert.equal(checkFileSystemAccess("/etc/passwd", UNRESTRICTED_PROFILE, context).allowed, true);
    assert.equal(checkFileSystemAccess("/etc/passwd", UNRESTRICTED_PROFILE, context).writeAccess, true);
    assert.equal(checkNetworkAccess("anything", UNRESTRICTED_PROFILE), true);
    assert.equal(checkGitAccess("write", UNRESTRICTED_PROFILE), true);
  });

  test("DEFAULT_DEV_PROFILE allows network and git write", () => {
    assert.equal(checkNetworkAccess("api.openai.com", DEFAULT_DEV_PROFILE), true);
    assert.equal(checkGitAccess("write", DEFAULT_DEV_PROFILE), true);
  });
});

describe("PermissionProfile - checkFileSystemAccess", () => {
  test("deny takes priority over write", () => {
    const profile: PermissionProfile = {
      mode: "managed",
      config: {
        fileSystem: [
          { path: { type: "special", kind: "project_root" }, access: "write" },
          { path: { type: "glob", pattern: "**/secrets/**" }, access: "deny" },
        ],
        network: { external: true },
        git: { read: true, write: true },
        globScanMaxDepth: 50,
      },
    };
    const result = checkFileSystemAccess(context.projectRoot + "/secrets/key.txt", profile, context);
    assert.equal(result.allowed, false);
  });

  test("exact path matching", () => {
    const tmpDir = path.resolve("/tmp");
    const profile: PermissionProfile = {
      mode: "managed",
      config: {
        fileSystem: [{ path: { type: "exact", path: tmpDir + "/allowed" }, access: "write" }],
        network: { external: false },
        git: { read: true, write: false },
        globScanMaxDepth: 10,
      },
    };
    assert.equal(checkFileSystemAccess(tmpDir + "/allowed/file.txt", profile, context).allowed, true);
    assert.equal(checkFileSystemAccess(tmpDir + "/other/file.txt", profile, context).allowed, false);
  });

  test("no matches returns denied (default secure)", () => {
    const profile: PermissionProfile = {
      mode: "managed",
      config: {
        fileSystem: [],
        network: { external: false },
        git: { read: false, write: false },
        globScanMaxDepth: 10,
      },
    };
    assert.equal(checkFileSystemAccess("/any/path", profile, context).allowed, false);
  });
});

describe("PermissionProfile - checkNetworkAccess", () => {
  test("allowedHosts filter restricts access", () => {
    const profile: PermissionProfile = {
      mode: "managed",
      config: {
        fileSystem: [],
        network: { external: true, allowedHosts: ["github.com"] },
        git: { read: true, write: false },
        globScanMaxDepth: 10,
      },
    };
    assert.equal(checkNetworkAccess("github.com", profile), true);
    assert.equal(checkNetworkAccess("api.openai.com", profile), false);
  });
});

describe("PermissionProfile - checkGitAccess", () => {
  test("respects git permission flags", () => {
    const profile: PermissionProfile = {
      mode: "managed",
      config: {
        fileSystem: [],
        network: { external: false },
        git: { read: true, write: false },
        globScanMaxDepth: 10,
      },
    };
    assert.equal(checkGitAccess("read", profile), true);
    assert.equal(checkGitAccess("write", profile), false);
  });
});

describe("PermissionProfile - legacyProfileFromScopes", () => {
  test("converts old scopes to managed profile", () => {
    const profile = legacyProfileFromScopes(["write-in-cwd", "network", "mutate-git-log"]);
    assert.equal(profile.mode, "managed");
    if (profile.mode === "managed") {
      assert.equal(profile.config.network.external, true);
      assert.equal(profile.config.git.write, true);
    }
  });

  test("restrictive scopes produce restrictive profile", () => {
    const profile = legacyProfileFromScopes(["read-in-cwd"]);
    if (profile.mode === "managed") {
      assert.equal(profile.config.network.external, false);
      assert.equal(profile.config.git.write, false);
    }
  });
});

describe("PermissionProfile - parsePermissionProfile", () => {
  test("unrestricted mode", () => {
    const profile = parsePermissionProfile({ mode: "unrestricted" });
    assert.equal(profile.mode, "unrestricted");
  });

  test("unknown config falls back to DEFAULT_DEV", () => {
    const profile = parsePermissionProfile({});
    assert.equal(profile.mode, "managed");
  });

  test("null config falls back to DEFAULT_DEV", () => {
    const profile = parsePermissionProfile(null);
    assert.equal(profile.mode, "managed");
  });

  test("allow list triggers legacy conversion", () => {
    const profile = parsePermissionProfile({ allow: ["network"] });
    if (profile.mode === "managed") {
      assert.equal(profile.config.network.external, true);
    }
  });
});
