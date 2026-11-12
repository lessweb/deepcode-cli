import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import React, { useState } from "react";
import { Text } from "ink";
import type { ReasoningSummaryMode, SettingsTarget } from "@vegamo/deepcode-core";
import ExperimentalDropdown from "../ui/components/ExperimentalDropdown";
import { PromptInput } from "../ui/views/PromptInput";
import { terminal } from "./terminal-helper";

async function editor(t: TestContext, projectSettings = false, current: ReasoningSummaryMode = "off") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "experimental-dropdown-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  if (projectSettings) {
    fs.mkdirSync(path.join(root, ".deepcode"));
    fs.writeFileSync(path.join(root, ".deepcode", "settings.json"), "{}");
  }
  const saves: Array<{ selection: ReasoningSummaryMode; target: SettingsTarget }> = [];
  function Probe() {
    const [open, setOpen] = useState(true);
    if (!open) return React.createElement(Text, null, "closed");
    return React.createElement(ExperimentalDropdown, {
      open,
      projectRoot: root,
      reasoningSummary: current,
      width: 100,
      onClose: () => setOpen(false),
      onSave: (selection, target) => {
        saves.push({ selection, target });
        return "saved";
      },
    });
  }
  return { ...(await terminal(t, React.createElement(Probe), 100)), saves };
}

test("experimental menu selects the current value and switches save scope without moving the selection", async (t) => {
  const h = await editor(t, true);
  assert.match(h.frame(), /Reasoning summary/);
  assert.match(h.frame(), /Summarize the lengthy reasoning_content returned by the LLM\./);
  assert.doesNotMatch(h.frame(), /Remember this choice/);
  await h.send("\u001b[D");
  await h.send("\r");
  assert.match(h.frame(), /> ● off/);
  assert.match(h.frame(), /All Projects +\[This Project\]/);
  await h.send("\u001b[A");
  await h.send("\u001b[D");
  assert.match(h.frame(), /> ○ on/);
  assert.match(h.frame(), /\[All Projects\] +This Project/);
  await h.send("\u001b[C");
  assert.match(h.frame(), /> ○ on/);
  assert.deepEqual(h.saves, []);
  await h.send(" ");
  assert.deepEqual(h.saves, [{ selection: "on", target: "project" }]);
});

test("experimental menu defaults to user scope and cancels either step without saving", async (t) => {
  const h = await editor(t, false, "on");
  await h.send("\r");
  assert.match(h.frame(), /> ● on/);
  assert.match(h.frame(), /\[All Projects\] +This Project/);
  await h.send("\u001b");
  assert.deepEqual(h.saves, []);
  const first = await editor(t);
  await first.send("\t");
  assert.deepEqual(first.saves, []);
  assert.doesNotMatch(first.frame(), /Experimental Features/);
});

test("typing /experimental opens the menu and consumes keys without submitting a prompt", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "experimental-command-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const saves: ReasoningSummaryMode[] = [];
  const h = await terminal(
    t,
    React.createElement(PromptInput, {
      projectRoot: root,
      screenWidth: 100,
      skills: [],
      modelConfig: { model: "deepseek-flash", thinkingEnabled: true, reasoningEffort: "high" },
      reasoningSummary: "off",
      promptHistory: [],
      busy: false,
      planMode: false,
      onSubmit: () => {
        assert.fail("must not submit a prompt");
      },
      onPromptDraftApplied: () => {},
      onModelConfigChange: () => "",
      onPermissionSettingsChange: () => "",
      onReasoningSummaryChange: (selection) => {
        saves.push(selection);
        return "saved";
      },
      onInterrupt: () => {
        assert.fail("must not interrupt");
      },
      onPlanModeChange: () => {},
    }),
    100
  );
  await h.send("/experimental");
  await h.send("\r");
  assert.match(h.frame(), /Experimental Features/);
  await h.send("\r");
  assert.match(h.frame(), /> ● off/);
  await h.send("\u001b[A");
  await h.send("\r");
  assert.deepEqual(saves, ["on"]);
  assert.doesNotMatch(h.frame(), /Experimental Features/);
});
