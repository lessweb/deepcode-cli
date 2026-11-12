import { test } from "node:test";
import assert from "node:assert/strict";
import * as os from "os";
import * as path from "path";
import React from "react";
import { Box, Static, renderToString } from "ink";
import stringWidth from "string-width";
import { resolveSettingsSources } from "../../../core/src/settings";
import { buildWelcomeTips, formatHomeRelativePath } from "../ui";
import { AsciiLogo } from "../ui/ascii-art";
import { WelcomeScreen } from "../ui/views/WelcomeScreen";
import { stripTerminalControls } from "./terminal-output";

test("welcome logo clips its right edge without wrapping in narrow terminals", () => {
  const settings = resolveSettingsSources({}, {}, { model: "deepseek-flash", baseURL: "https://example.com" }, {});
  for (const width of [40, 60, 70, 72, 80, 120]) {
    const output = stripTerminalControls(
      renderToString(React.createElement(WelcomeScreen, { projectRoot: "/project", settings, skills: [], width }), {
        columns: width,
      })
    );
    const logo = output.split(/\n\s*╭─/)[0].trim();
    assert.deepEqual(
      logo.split("\n").map((line) => line.trim()),
      AsciiLogo.split("\n").map((line) => line.slice(0, width - 3).trim()),
      `terminal width: ${width}`
    );
  }
});

test("static welcome output stays within the terminal width and keeps the settings panel aligned", () => {
  const settings = resolveSettingsSources({}, {}, { model: "deepseek-flash", baseURL: "https://example.com" }, {});
  const projectRoot = path.resolve("/tmp");
  for (const width of [40, 60, 62, 70, 72, 73, 74, 80, 111, 112, 120]) {
    const output = stripTerminalControls(
      renderToString(
        React.createElement(
          Box,
          { flexDirection: "column", width },
          React.createElement(Static<string>, {
            items: ["welcome"],
            children: (key) => React.createElement(WelcomeScreen, { key, projectRoot, settings, skills: [], width }),
          })
        ),
        { columns: width }
      )
    );
    const lines = output.split("\n");
    for (const line of lines) {
      assert.ok(stringWidth(line) <= width, `terminal width: ${width}, line: ${line}`);
    }

    const panelWidth = width < 112 ? width : 72;
    const panelTop = lines.findIndex((line) => line.startsWith(" ╭─"));
    assert.deepEqual(
      lines.slice(0, panelTop).filter((line) => line.trim()),
      AsciiLogo.split("\n").map((line) => `  ${line.slice(0, panelWidth - 3)}`.trimEnd()),
      `logo at terminal width: ${width}`
    );
    assert.equal(lines[panelTop], ` ╭${"─".repeat(panelWidth - 4)}╮`);
    const panelBottom = lines.findIndex((line) => line.startsWith(" ╰─"));
    assert.ok(panelBottom > panelTop);
    assert.equal(lines[panelBottom], ` ╰${"─".repeat(panelWidth - 4)}╯`);
    for (const line of lines.slice(panelTop + 1, panelBottom)) {
      assert.ok(line.startsWith(" │ ") && line.endsWith(" │"), line);
      assert.equal(stringWidth(line), panelWidth - 1, line);
    }
    for (const [label, value] of [
      ["Model", settings.model],
      ["Thinking Enabled", String(settings.thinkingEnabled)],
      ["Reasoning Effort", settings.reasoningEffort],
      ["CWD", projectRoot],
    ]) {
      assert.ok(
        lines.some((line) => line.includes(label) && line.includes(value)),
        `${label} and its value should share a row at terminal width: ${width}`
      );
    }
  }
});

test("formatHomeRelativePath returns tilde for the home directory", () => {
  const home = path.resolve("/Users/example");
  assert.equal(formatHomeRelativePath(home, home), "~");
});

test("formatHomeRelativePath shortens paths inside the home directory", () => {
  const home = path.resolve("/Users/example");
  const result = formatHomeRelativePath(path.resolve("/Users/example/dev/project"), home);
  assert.equal(result, `~${path.sep}dev${path.sep}project`);
});

test("formatHomeRelativePath keeps paths outside the home directory absolute", () => {
  const home = path.resolve("/Users/example");
  const other = path.resolve("/tmp/project");
  // The result should be the absolute path since it's outside home
  const result = formatHomeRelativePath(other, home);
  assert.equal(result, other);
});

test("buildWelcomeTips includes built-in slash commands and loaded skills", () => {
  const tips = buildWelcomeTips([
    { name: "loaded", path: "/skills/loaded/SKILL.md", description: "Loaded skill", isLoaded: true },
    { name: "fresh", path: "/skills/fresh/SKILL.md", description: "Fresh skill" },
  ]);

  const labels = tips.map((tip) => tip.label);
  assert.ok(labels.includes("/new"));
  assert.ok(labels.includes("/loaded"));
  assert.ok(labels.includes("Ctrl+R"));
  assert.equal(labels.includes("/fresh"), false);
});
