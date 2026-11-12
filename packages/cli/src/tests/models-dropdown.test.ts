import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import React, { useState } from "react";
import { Text } from "ink";
import stringWidth from "string-width";
import type { ModelConfigSelection, SettingsTarget } from "@vegamo/deepcode-core";
import { getThinkingOptionIndex, MODEL_COMMAND_MODELS, MODEL_COMMAND_THINKING_OPTIONS } from "../ui";
import ModelsDropdown from "../ui/components/ModelsDropdown";
import { terminal } from "./terminal-helper";

const LEFT = "\u001b[D";
const RIGHT = "\u001b[C";
const DOWN = "\u001b[B";
const ENTER = "\r";
const ESC = "\u001b";
const current: ModelConfigSelection = { model: "deepseek-flash", thinkingEnabled: true, reasoningEffort: "high" };

async function editor(t: TestContext, hasProjectSettings = false, width = 80) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "models-dropdown-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const projectFile = path.join(root, ".deepcode", "settings.json");
  if (hasProjectSettings) {
    fs.mkdirSync(path.dirname(projectFile), { recursive: true });
    fs.writeFileSync(projectFile, "{}");
  }
  const saves: { selection: ModelConfigSelection; target: SettingsTarget }[] = [];
  function Probe({ opened = true }: { opened?: boolean }) {
    const [open, setOpen] = useState(opened);
    return React.createElement(ModelsDropdown, {
      open,
      projectRoot: root,
      modelConfig: current,
      width,
      onClose: () => setOpen(false),
      onModelConfigChange: (selection, target) => {
        saves.push({ selection, target });
        return "saved";
      },
    });
  }
  const h = await terminal(t, React.createElement(Probe), width);
  return { ...h, saves, projectFile, Probe };
}

test("model dropdown offers supported DeepSeek models", () => {
  assert.deepEqual(MODEL_COMMAND_MODELS, [
    "deepseek-flash",
    "deepseek-v4-pro",
    "deepseek-v4-flash",
    "deepseek-v4-flash-vision-exp",
  ]);
});

test("model dropdown offers all reasoning effort levels", () => {
  assert.deepEqual(
    MODEL_COMMAND_THINKING_OPTIONS.map((option) => option.reasoningEffort),
    ["max", "high", "low", undefined]
  );
  assert.equal(getThinkingOptionIndex({ thinkingEnabled: true, reasoningEffort: "low" }), 2);
});

test("model scope selector is only active on thinking confirmation and retains the thinking cursor", async (t) => {
  const inkRequire = createRequire(createRequire(import.meta.url).resolve("ink"));
  const { default: chalk } = await import(pathToFileURL(inkRequire.resolve("chalk")).href);
  const level = chalk.level;
  chalk.level = 1;
  t.after(() => {
    chalk.level = level;
  });
  const h = await editor(t, true);
  assert.doesNotMatch(h.frame(), /Remember this choice|All Projects|This Project/);
  await h.send(DOWN);
  await h.send(LEFT); // Scope cannot change while hidden.
  assert.match(h.frame(), /> ○ deepseek-v4-pro/);
  assert.deepEqual(h.saves, []);
  await h.send(ENTER);
  assert.match(h.frame(), /Select Thinking Mode/);
  assert.match(h.frame(), /All Projects +\[This Project\]/);
  assert.match(h.rawFrame(), /\u001b\[90mRemember this choice for {2}\(←→ to switch\)/);
  assert.ok(h.frame().indexOf("Remember this choice") < h.frame().indexOf("Space/Enter apply"));
  await h.send(DOWN);
  await h.send(LEFT);
  assert.match(h.frame(), /\[All Projects\] +This Project/);
  assert.match(h.frame(), /> ○ Thinking mode \[low\]/);
  await h.send(RIGHT);
  assert.match(h.frame(), /All Projects +\[This Project\]/);
  assert.match(h.frame(), /> ○ Thinking mode \[low\]/);
  await h.send(LEFT);
  await h.send(LEFT);
  assert.match(h.frame(), /\[All Projects\]/);
  assert.deepEqual(h.saves, []);
  await h.send(ENTER);
  assert.deepEqual(h.saves, [
    { selection: { model: "deepseek-v4-pro", thinkingEnabled: true, reasoningEffort: "low" }, target: "user" },
  ]);
});

test("missing project settings default to all projects and cancellation saves nothing", async (t) => {
  const h = await editor(t, false, 36);
  assert.doesNotMatch(h.frame(), /Remember this choice|All Projects|This Project/);
  await h.send(RIGHT); // Scope cannot change while hidden.
  await h.send(ENTER);
  assert.match(h.frame(), /\[All Projects\] +This Project/);
  // The shared scope control must fit inside the narrow dialog.
  const scopeLines = h
    .frame()
    .split("\n")
    .filter((line) => /Remember|switch|Projects/.test(line));
  assert.ok(scopeLines.every((line) => stringWidth(line) <= 36));
  await h.send(RIGHT);
  assert.match(h.frame(), /All Projects +\[This Project\]/);
  await h.send(ESC);
  assert.deepEqual(h.saves, []);
  assert.equal(fs.existsSync(h.projectFile), false);
});

test("reopening recomputes the default destination and thinking cancellation does not save", async (t) => {
  const h = await editor(t);
  await h.send(ENTER);
  await h.send(RIGHT);
  await h.send(ESC);
  assert.deepEqual(h.saves, []);
  h.rerender(React.createElement(Text, null, "closed"));
  await h.send("");
  fs.mkdirSync(path.dirname(h.projectFile), { recursive: true });
  fs.writeFileSync(h.projectFile, "{}");
  h.rerender(React.createElement(h.Probe));
  await h.send("");
  assert.doesNotMatch(h.frame(), /Remember this choice|All Projects|This Project/);
  await h.send(ENTER);
  assert.match(h.frame(), /All Projects +\[This Project\]/);
  await h.send(ENTER);
  assert.deepEqual(h.saves, [{ selection: current, target: "project" }]);
});
