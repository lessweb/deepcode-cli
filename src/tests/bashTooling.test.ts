import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildInstallSpawn,
  buildBashToolInstallPlan,
  formatBashToolInstallResult,
  formatBashToolingStatus,
  type BashToolingStatus,
} from "../common/bash-tooling";

test("formatBashToolingStatus reports ready and missing tools", () => {
  assert.equal(formatBashToolingStatus(status([])), "rg+jq ready");
  assert.equal(formatBashToolingStatus(status(["rg"])), "missing rg (/install)");
  assert.equal(formatBashToolingStatus(status(["rg", "jq"])), "missing rg,jq (/install)");
});

test("buildBashToolInstallPlan uses winget on Windows", () => {
  const plan = buildBashToolInstallPlan(["rg", "jq"], {
    platform: "win32",
    hasCommand: (command) => command === "winget",
  });

  assert.equal(plan?.manager, "winget");
  assert.deepEqual(
    plan?.commands.map((command) => command.display),
    [
      "winget install -e --id BurntSushi.ripgrep.MSVC --accept-package-agreements --accept-source-agreements",
      "winget install -e --id jqlang.jq --accept-package-agreements --accept-source-agreements",
    ]
  );
});

test("buildBashToolInstallPlan uses one brew install for both tools", () => {
  const plan = buildBashToolInstallPlan(["rg", "jq"], {
    platform: "darwin",
    hasCommand: (command) => command === "brew",
  });

  assert.equal(plan?.manager, "brew");
  assert.deepEqual(
    plan?.commands.map((command) => command.display),
    ["brew install ripgrep jq"]
  );
});

test("buildBashToolInstallPlan uses sudo for apt-get when not root", () => {
  const plan = buildBashToolInstallPlan(["jq"], {
    platform: "linux",
    hasCommand: (command) => command === "apt-get" || command === "sudo",
    isRoot: false,
  });

  assert.equal(plan?.manager, "apt-get");
  assert.deepEqual(
    plan?.commands.map((command) => command.display),
    ["sudo apt-get update", "sudo apt-get install -y jq"]
  );
});

test("formatBashToolInstallResult includes fallback instructions without a package manager", () => {
  const result = formatBashToolInstallResult({
    before: status(["rg", "jq"]),
    after: status(["rg", "jq"]),
    plan: null,
    exitCode: null,
    signal: null,
  });

  assert.equal(result.includes("No supported package manager found"), true);
});

test("formatBashToolInstallResult separates PATH refresh from installer failure", () => {
  const result = formatBashToolInstallResult({
    before: status(["jq"]),
    after: status(["jq"]),
    plan: {
      manager: "winget",
      commands: [{ command: "winget", args: ["install", "jq"], display: "winget install jq" }],
    },
    exitCode: 0,
    signal: null,
  });

  assert.equal(result.includes("Bash still cannot find"), true);
  assert.equal(result.includes("Restart the terminal"), true);
});

test("buildInstallSpawn does not use a shell for native commands", () => {
  const result = buildInstallSpawn({ command: "winget", args: ["install", "jq"], display: "" }, "win32");

  assert.notEqual(result.command, "cmd.exe");
  assert.equal(result.command.endsWith("winget.exe") || result.command === "winget", true);
  assert.deepEqual(result.args, ["install", "jq"]);
});

test("buildInstallSpawn runs Windows cmd shims through cmd.exe without node shell option", () => {
  assert.deepEqual(
    buildInstallSpawn({ command: "C:\\Tools\\scoop.cmd", args: ["install", "ripgrep", "jq"], display: "" }, "win32"),
    {
      command: "cmd.exe",
      args: ["/d", "/s", "/c", '"C:\\Tools\\scoop.cmd" install ripgrep jq'],
    }
  );
});

function status(missing: Array<"rg" | "jq">): BashToolingStatus {
  return {
    tools: [
      { name: "rg", available: !missing.includes("rg") },
      { name: "jq", available: !missing.includes("jq") },
    ],
    missing,
  };
}
