import assert from "node:assert/strict";
import os from "node:os";
import { test, type TestContext } from "node:test";
import React from "react";
import { renderToString } from "ink";
import { getImagePasteShortcutLabel, isImagePasteShortcut } from "../utils/image-paste-shortcut";
import { dispatchTerminalInput, parseTerminalInput } from "../ui/hooks/useTerminalInput";
import { PromptInput } from "../ui/views/PromptInput";
import { buildWelcomeTips } from "../ui/views/WelcomeScreen";
import { stripTerminalControls } from "./terminal-output";

const environments: {
  name: string;
  platform: NodeJS.Platform;
  release?: string;
  env?: NodeJS.ProcessEnv;
  label: string;
  ctrl: boolean;
  alt: boolean;
}[] = [
  { name: "win32", platform: "win32", label: "Alt+V", ctrl: false, alt: true },
  { name: "darwin", platform: "darwin", label: "Ctrl+V", ctrl: true, alt: false },
  { name: "linux", platform: "linux", label: "Ctrl+V", ctrl: true, alt: false },
  {
    name: "wsl-distro",
    platform: "linux",
    env: { WSL_DISTRO_NAME: "Ubuntu" },
    label: "Ctrl+V / Alt+V",
    ctrl: true,
    alt: true,
  },
  {
    name: "wsl-interop",
    platform: "linux",
    env: { WSL_INTEROP: "/run/WSL/123_interop" },
    label: "Ctrl+V / Alt+V",
    ctrl: true,
    alt: true,
  },
  {
    name: "wsl1-kernel",
    platform: "linux",
    release: "4.4.0-19041-Microsoft",
    label: "Ctrl+V / Alt+V",
    ctrl: true,
    alt: true,
  },
  {
    name: "wsl2-kernel",
    platform: "linux",
    release: "6.6.87.2-microsoft-standard-WSL2",
    label: "Ctrl+V / Alt+V",
    ctrl: true,
    alt: true,
  },
  {
    name: "win32-with-wsl-env",
    platform: "win32",
    env: { WSL_DISTRO_NAME: "Ubuntu" },
    label: "Alt+V",
    ctrl: false,
    alt: true,
  },
];

function mockEnvironment(t: TestContext, environment: (typeof environments)[number]): void {
  const descriptor = Object.getOwnPropertyDescriptor(process, "platform")!;
  Object.defineProperty(process, "platform", { value: environment.platform });
  t.after(() => Object.defineProperty(process, "platform", descriptor));
  t.mock.method(os, "release", () => environment.release ?? "6.8.0-generic");
  for (const key of ["WSL_DISTRO_NAME", "WSL_INTEROP"]) {
    const original = process.env[key];
    const value = environment.env?.[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
    t.after(() => {
      if (original === undefined) delete process.env[key];
      else process.env[key] = original;
    });
  }
}

for (const environment of environments) {
  const { name, platform, label, ctrl, alt } = environment;

  test(`${name}: only the image paste shortcuts trigger image reading`, (t) => {
    mockEnvironment(t, environment);
    for (const [raw, expected] of [
      ["\u001bv", alt],
      ["\u001bV", alt],
      ["\u0016", ctrl],
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

  test(`${name}: help, welcome tips and prompt footer show ${label}`, async (t) => {
    mockEnvironment(t, environment);

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
          reasoningSummary: "off" as const,
          onReasoningSummaryChange: () => "",
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
    if (!ctrl) assert.ok(!footer.includes("ctrl+v image"), footer);
    if (!alt) assert.ok(!footer.includes("alt+v image"), footer);

    // Reload the module so its static help text uses the simulated platform.
    const moduleUrl = new URL(`../cli-args.ts?image-paste-platform=${name}`, import.meta.url).href;
    const { parseArguments } = await import(moduleUrl);
    const output: string[] = [];
    t.mock.method(console, "log", (...args: unknown[]) => output.push(args.join(" ")));
    await parseArguments(["--help"]);
    const help = output.join("\n");
    assert.ok(help.includes(`${label.toLowerCase().padEnd(17)}Paste an image from the clipboard`), help);
    if (!ctrl) assert.ok(!help.includes(`${"ctrl+v".padEnd(17)}Paste an image from the clipboard`), help);
    if (!alt) assert.ok(!help.includes(`${"alt+v".padEnd(17)}Paste an image from the clipboard`), help);
  });
}
