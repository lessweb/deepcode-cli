import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { test } from "node:test";
import React from "react";
import { Models } from "openai/resources/models";
import { SessionManager, resolveCurrentSettings } from "@vegamo/deepcode-core";
import AppContainer from "../ui/views/AppContainer";
import { terminal } from "./terminal-helper";

for (const hasProject of [true, false]) {
  test(`TUI uses custom settings while preserving save scope (project exists: ${hasProject})`, async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cli-settings-file-"));
    const project = path.join(root, "project");
    const projectFile = path.join(project, ".deepcode/settings.json");
    const userFile = path.join(root, ".deepcode/settings.json");
    const settingsFile = path.join(root, "custom.json");
    fs.mkdirSync(path.dirname(projectFile), { recursive: true });
    fs.mkdirSync(path.dirname(userFile), { recursive: true });
    fs.writeFileSync(userFile, "{}");
    if (hasProject) fs.writeFileSync(projectFile, "{}");
    const custom = JSON.stringify({
      model: "deepseek-v4-pro",
      env: { API_KEY: "test-key", BASE_URL: "https://custom.invalid" },
      permissions: { defaultMode: "askAll" },
      statusline: { enabled: false },
    });
    fs.writeFileSync(settingsFile, custom);
    const env = process.env;
    process.env = Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith("DEEPCODE_")));
    t.mock.method(os, "homedir", () => root);
    syncBuiltinESMExports();
    t.mock.method(Models.prototype, "list", async () => ({ data: [] }));
    t.mock.method(SessionManager.prototype, "initMcpServers", async () => {});
    t.mock.method(SessionManager.prototype, "listSkills", async () => []);
    t.mock.method(SessionManager.prototype, "listSessions", () => []);
    const element = (key: number) =>
      React.createElement(AppContainer, {
        key,
        projectRoot: project,
        settingsFile,
        version: "test",
        initialPrompt: undefined,
        resumeSessionId: undefined,
        forkSessionId: undefined,
        onRestart() {},
      });
    const h = await terminal(t, element(0), 120);
    t.after(() => {
      t.mock.restoreAll();
      syncBuiltinESMExports();
      process.env = env;
      fs.rmSync(root, { recursive: true, force: true });
    });
    assert.match(h.frame(), /deepseek-v4-pro/);
    await h.send("/model");
    await h.send("\r");
    assert.doesNotMatch(h.frame(), /Remember this choice|All Projects|This Project/);
    await h.send("\u001b[A"); // Select the preceding model (deepseek-flash).
    await h.send("\r");
    assert.match(h.frame(), hasProject ? /All Projects +\[This Project\]/ : /\[All Projects\] +This Project/);
    await h.send("\r");
    const targetFile = hasProject ? projectFile : userFile;
    assert.equal(JSON.parse(fs.readFileSync(targetFile, "utf8")).model, "deepseek-flash");
    assert.equal(resolveCurrentSettings(project, settingsFile).model, "deepseek-v4-pro");
    await h.send("/permissions");
    await h.send("\r");
    assert.match(h.frame(), hasProject ? /All Projects +\[This Project\]/ : /\[All Projects\] +This Project/);
    await h.send("\r"); // Edit defaultMode.
    await h.send("\u001b[A"); // askAll.
    await h.send("\r");
    await h.send("\u001b[A"); // Save.
    await h.send("\r");
    assert.equal(JSON.parse(fs.readFileSync(targetFile, "utf8")).permissions.defaultMode, "askAll");
    assert.equal(fs.readFileSync(settingsFile, "utf8"), custom);
    h.rerender(element(1));
    await h.send("");
    assert.match(h.frame(), /deepseek-v4-pro/);
  });
}

test("CLI rejects invalid explicit files before startup but help and version do not read them", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cli-settings-errors-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "settings.json");
  const cli = fileURLToPath(new URL("../cli.tsx", import.meta.url));
  const config = fileURLToPath(new URL("../../tsconfig.json", import.meta.url));
  const tsx = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
  const run = (...args: string[]) =>
    spawnSync(process.execPath, ["--import", tsx, cli, ...args], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, TSX_TSCONFIG_PATH: config },
      timeout: 15_000,
    });
  for (const raw of [undefined, '{"secret":"do-not-print",broken}', "[]"]) {
    if (raw !== undefined) fs.writeFileSync(file, raw);
    for (const mode of [[], ["-x", "-p", "hello"]]) {
      const result = run("-s", "settings.json", ...mode);
      assert.equal(result.status, 1, result.stderr);
      assert.ok(result.stderr.includes(file), result.stderr);
      assert.doesNotMatch(result.stderr, /do-not-print/);
      assert.equal(result.stdout, "");
    }
  }
  for (const flag of ["--help", "--version"]) {
    const result = run("--settings", "missing.json", flag);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    if (flag === "--help") assert.match(result.stdout, /-s, --settings +Path to a settings JSON file/);
  }
});
