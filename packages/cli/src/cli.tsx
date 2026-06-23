import React from "react";
import { render } from "ink";
import { setShellIfWindows } from "@vegamo/deepcode-core";
import { checkForNpmUpdate, promptForPendingUpdate, type PackageInfo } from "./common/update-check";
import { AppContainer } from "./ui";
import { extractInitialPrompt, extractResumeSessionId } from "./cli-args";

const args = process.argv.slice(2);
const packageInfo = readPackageInfo();

if (args.includes("--version") || args.includes("-v")) {
  process.stdout.write(`${packageInfo.version || "unknown"}\n`);
  process.exit(0);
}

if (args.includes("--help") || args.includes("-h")) {
  process.stdout.write(
    [
      "deepcode - Deep Code CLI",
      "",
      "Usage:",
      "  deepcode                              Launch the interactive TUI in the current directory",
      "  deepcode -p <prompt>                  Launch with a pre-filled prompt",
      "  deepcode --prompt <prompt>            Same as -p",
      "  deepcode --resume [sessionId]         Resume a specific session by its ID. Use without an ID to show session picker",
      "  deepcode --version                    Print the version",
      "  deepcode --help                       Show this help",
      "",
      "Configuration:",
      "  ~/.deepcode/settings.json    User-level API key, model, base URL",
      "  ./.deepcode/settings.json    Project-level settings",
      "  ./.deepcode/skills/*/SKILL.md Project-level native skills",
      "  ./.agents/skills/*/SKILL.md   Project-level interoperable skills",
      "  ~/.deepcode/skills/*/SKILL.md User-level native skills",
      "  ~/.agents/skills/*/SKILL.md   User-level interoperable skills",
      "",
      "Inside the TUI:",
      "  enter            Send the prompt",
      "  shift+enter      Insert a newline",
      "  home/end         Move within the current line",
      "  alt+left/right   Move by word",
      "  ctrl+w           Delete the previous word",
      "  ctrl+v           Paste an image from the clipboard",
      "  ctrl+x           Clear pasted images",
      "  esc              Interrupt the current model turn",
      "  /                Open the skills/commands menu",
      "  /skills          List available skills",
      "  /model           Select model, thinking mode and effort control",
      "  /new             Start a fresh conversation",
      "  /init            Initialize an AGENTS.md file with instructions for LLM",
      "  /resume          Pick a previous conversation to continue",
      "  /continue        Continue the active conversation, or resume one if empty",
      "  /undo            Restore code and/or conversation to a previous point",
      "  /mcp             Show MCP server status and available tools",
      "  /raw             Toggle display mode for viewing or collapsing reasoning content",
      "  /exit            Quit",
      "  ctrl+d twice     Quit",
    ].join("\n") + "\n"
  );
  process.exit(0);
}

let initialPrompt = extractInitialPrompt(args);
const resumeSessionId = extractResumeSessionId(args);
const projectRoot = process.cwd();
configureWindowsShell();

if (!process.stdin.isTTY) {
  process.stderr.write("deepcode requires an interactive terminal (TTY). " + "Re-run from a real terminal session.\n");
  process.exit(1);
}

void main();

async function main(): Promise<void> {
  const updatePromptResult = await promptForPendingUpdate(packageInfo);
  if (updatePromptResult.installed) {
    process.exit(0);
  }

  const restartRef: { current: (() => void) | null } = { current: null };

  function startApp(): void {
    let restarting = false;
    const appInitialPrompt = initialPrompt;
    initialPrompt = undefined;
    const inkInstance = render(
      <AppContainer
        projectRoot={projectRoot}
        version={packageInfo.version}
        initialPrompt={appInitialPrompt}
        resumeSessionId={resumeSessionId}
        onRestart={() => restartRef.current?.()}
      />,
      { exitOnCtrlC: false }
    );

    restartRef.current = () => {
      restarting = true;
      process.stdout.write("\u001B[2J\u001B[3J\u001B[H");
      inkInstance.unmount();
      startApp();
    };

    inkInstance.waitUntilExit().then(() => {
      if (!restarting) {
        restartRef.current = null;
        process.exit(0);
      }
    });
  }

  void checkForNpmUpdate(packageInfo);

  startApp();
}

function configureWindowsShell(): void {
  process.env.NoDefaultCurrentDirectoryInExePath = "1";
  try {
    setShellIfWindows();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`deepcode: ${message}\n`);
    process.exit(1);
  }
}

function readPackageInfo(): PackageInfo {
  try {
    const pkg = require("../package.json") as { name?: unknown; version?: unknown };
    return {
      name: typeof pkg.name === "string" ? pkg.name : "@vegamo/deepcode-cli",
      version: typeof pkg.version === "string" ? pkg.version : "",
    };
  } catch {
    return { name: "@vegamo/deepcode-cli", version: "" };
  }
}
