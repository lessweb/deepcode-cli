import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToString } from "ink";
import { getImagePasteShortcutLabel, isImagePasteShortcut } from "../utils/image-paste-shortcut";
import { dispatchTerminalInput, parseTerminalInput } from "../ui/hooks/useTerminalInput";
import { PromptInput } from "../ui/views/PromptInput";
import { buildWelcomeTips } from "../ui/views/WelcomeScreen";
import { stripTerminalControls } from "./terminal-output";

for (const platform of ["win32", "darwin", "linux"] as const) {
  const label = platform === "win32" ? "Alt+V" : "Ctrl+V";
  const otherLabel = platform === "win32" ? "Ctrl+V" : "Alt+V";

  test(`${platform}: only the image paste shortcut triggers image reading`, () => {
    for (const [raw, expected] of [
      ["\u001bv", platform === "win32"],
      ["\u001bV", platform === "win32"],
      ["\u0016", platform !== "win32"],
      ["v", false],
      ["V", false],
      ["\u001bx", false],
      ["\u0018", false],
      ["pasted text", false],
    ] as const) {
      const events: boolean[] = [];
      dispatchTerminalInput(raw, (input, key) => events.push(isImagePasteShortcut(input, key, platform)));
      assert.deepEqual(events, [expected], JSON.stringify(raw));
    }

    const shortcut = parseTerminalInput(platform === "win32" ? "\u001bv" : "\u0016");
    assert.equal(isImagePasteShortcut(shortcut.input, { ...shortcut.key, paste: true }, platform), false);
    assert.equal(isImagePasteShortcut("v", { ctrl: true, meta: true, paste: false }, platform), false);
    assert.equal(getImagePasteShortcutLabel(platform), label);
  });

  test(`${platform}: help, welcome tips and prompt footer show ${label}`, async (t) => {
    const descriptor = Object.getOwnPropertyDescriptor(process, "platform")!;
    Object.defineProperty(process, "platform", { value: platform });
    t.after(() => Object.defineProperty(process, "platform", descriptor));

    assert.equal(getImagePasteShortcutLabel(), label);
    const shortcut = parseTerminalInput(platform === "win32" ? "\u001bv" : "\u0016");
    assert.equal(isImagePasteShortcut(shortcut.input, shortcut.key), true);

    const tips = buildWelcomeTips([]);
    assert.equal(tips.find((tip) => tip.description === "Paste an image from the clipboard")?.label, label);

    const footer = stripTerminalControls(
      renderToString(
        React.createElement(PromptInput, {
          projectRoot: process.cwd(),
          screenWidth: 160,
          skills: [],
          modelConfig: { model: "test", thinkingEnabled: false, reasoningEffort: "high" },
          promptHistory: [],
          busy: false,
          disabled: true,
          planMode: false,
          onSubmit() {},
          onPromptDraftApplied() {},
          onModelConfigChange: () => "",
          onPermissionSettingsChange: () => "",
          onPlanModeChange() {},
          onInterrupt() {},
        }),
        { columns: 160 }
      )
    );
    assert.ok(footer.includes(`${label.toLowerCase()} image`), footer);
    assert.ok(!footer.includes(`${otherLabel.toLowerCase()} image`), footer);

    // Reload the module so its static help text uses the simulated platform.
    const moduleUrl = new URL(`../cli-args.ts?image-paste-platform=${platform}`, import.meta.url).href;
    const { parseArguments } = await import(moduleUrl);
    const output: string[] = [];
    t.mock.method(console, "log", (...args: unknown[]) => output.push(args.join(" ")));
    await parseArguments(["--help"]);
    const help = output.join("\n");
    assert.ok(help.includes(`${label.toLowerCase().padEnd(17)}Paste an image from the clipboard`), help);
    assert.ok(!help.includes(`${otherLabel.toLowerCase().padEnd(17)}Paste an image from the clipboard`), help);
  });
}
