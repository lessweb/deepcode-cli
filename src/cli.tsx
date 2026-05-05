import React from "react";
import { render } from "ink";
import { App } from "./ui/App";
import { setShellIfWindows } from "./tools/shell-utils";
import { checkForNpmUpdate, promptForPendingUpdate, type PackageInfo } from "./updateCheck";
import { runHeadless } from "./headless";

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
      "  deepcode               Launch the interactive TUI in the current directory",
      "  deepcode headless      Run a headless NDJSON server over stdio (for native frontends)",
      "  deepcode --version     Print the version",
      "  deepcode --help        Show this help",
      "",
      "Headless options:",
      "  --project-root <path>  Use the given directory as the project root (default: cwd)",
      "",
      "Configuration:",
      "  ~/.deepcode/settings.json   API key, model, base URL",
      "  ~/.agents/skills/*/SKILL.md  User-level skills",
      "  ./.deepcode/skills/*/SKILL.md Project-level skills",
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
      "  /new             Start a fresh conversation",
      "  /resume          Pick a previous conversation to continue",
      "  /exit            Quit",
      "  ctrl+d twice     Quit"
    ].join("\n") + "\n"
  );
  process.exit(0);
}

if (args[0] === "headless") {
  configureWindowsShell();
  void runHeadless(args.slice(1), packageInfo.version || "unknown").catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`deepcode headless: ${message}\n`);
    process.exit(1);
  });
} else {
  const projectRoot = process.cwd();
  configureWindowsShell();

  if (!process.stdin.isTTY) {
    process.stderr.write(
      "deepcode requires an interactive terminal (TTY). " +
        "Re-run from a real terminal session, or use `deepcode headless` for a programmatic interface.\n"
    );
    process.exit(1);
  }

  void main(projectRoot);
}

async function main(projectRoot: string): Promise<void> {
  const updatePromptResult = await promptForPendingUpdate(packageInfo);

  const inkInstance = render(<App projectRoot={projectRoot} version={packageInfo.version} />, {
    exitOnCtrlC: false
  });

  if (!updatePromptResult.installed) {
    void checkForNpmUpdate(packageInfo);
  }

  inkInstance.waitUntilExit().then(() => {
    process.exit(0);
  });
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
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pkg = require("../package.json") as { name?: unknown; version?: unknown };
    return {
      name: typeof pkg.name === "string" ? pkg.name : "@vegamo/deepcode-cli",
      version: typeof pkg.version === "string" ? pkg.version : ""
    };
  } catch {
    return { name: "@vegamo/deepcode-cli", version: "" };
  }
}
