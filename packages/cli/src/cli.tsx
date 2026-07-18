import React from "react";
import { render } from "ink";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { setShellIfWindows, getProjectCode } from "@vegamo/deepcode-core";
import { checkForNpmUpdate, promptForPendingUpdate } from "./common/update-check";
import { AppContainer } from "./ui";
import { parseArguments } from "./cli-args";
import { runLogin, printLoginHelp } from "./commands/login";
import { writeStderrLine, writeStdoutLine } from "./utils/stdio-helpers";
import { getPackageJson } from "./utils/package";
import { CLI_VERSION } from "./generated/git-commit";

void main();

async function main(): Promise<void> {
  const packageInfo = await getPackageJson();
  const parsed = await parseArguments();

  // --version and --help are handled by yargs internally (prints output as side effect)
  // but with .exitProcess(false) we need to exit manually.
  if (parsed.version || parsed.help) {
    process.exit(0);
  }

  // `login` is a standalone sub-command: it never starts the TUI and works
  // without a TTY (so keys can be piped), so dispatch it before the
  // interactive-terminal check and Windows shell configuration below.
  if (parsed.command === "login") {
    if (parsed.login?.help) {
      printLoginHelp();
      process.exit(0);
    }
    await runLogin({ apiKey: parsed.login?.apiKey, show: parsed.login?.show ?? false });
    process.exit(0);
  }

  // Configure Windows shell AFTER --version/--help handling.
  // On Windows without Git Bash, setShellIfWindows() throws and calls process.exit(1).
  // If called before argument parsing, --help and --version would fail on those machines.
  configureWindowsShell();

  let initialPrompt = parsed.prompt;
  let resumeSessionId = parsed.resume;
  const projectRoot = process.cwd();

  if (!process.stdin.isTTY) {
    writeStderrLine("deepcode requires an interactive terminal (TTY). Re-run from a real terminal session.\n");
    process.exit(1);
  }

  // Validate --resume <sessionId> before entering TUI
  if (typeof resumeSessionId === "string") {
    const projectCode = getProjectCode(projectRoot);
    const indexPath = join(homedir(), ".deepcode", "projects", projectCode, "sessions-index.json");
    try {
      const index = JSON.parse(readFileSync(indexPath, "utf-8"));
      const found =
        Array.isArray(index?.entries) && index.entries.some((e: { id: string }) => e.id === resumeSessionId);
      if (!found) {
        writeStderrLine(`No saved session found with ID "${resumeSessionId}".\n`);
        process.exit(1);
      }
    } catch {
      writeStderrLine(`No saved session found with ID "${resumeSessionId}".\n`);
      process.exit(1);
    }
  }

  const updatePromptResult = await promptForPendingUpdate(packageInfo);
  if (updatePromptResult.installed) {
    process.exit(0);
  }

  const restartRef: { current: (() => void) | null } = { current: null };

  function startApp(): void {
    let restarting = false;
    const appInitialPrompt = initialPrompt;
    initialPrompt = undefined;
    const appResumeSessionId = resumeSessionId;
    resumeSessionId = undefined;
    const inkInstance = render(
      <AppContainer
        projectRoot={projectRoot}
        version={packageInfo?.version ?? CLI_VERSION}
        initialPrompt={appInitialPrompt}
        resumeSessionId={appResumeSessionId}
        onRestart={() => restartRef.current?.()}
      />,
      { exitOnCtrlC: false }
    );

    restartRef.current = () => {
      restarting = true;
      writeStdoutLine("\u001B[2J\u001B[3J\u001B[H");
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

/**
 * Configure shell environment for Windows.
 * Sets NoDefaultCurrentDirectoryInExePath and resolves Git Bash path.
 * Must be called after --version/--help handling to avoid blocking those
 * commands on Windows machines without Git Bash installed.
 */
function configureWindowsShell(): void {
  process.env.NoDefaultCurrentDirectoryInExePath = "1";
  try {
    setShellIfWindows();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeStderrLine(`deepcode: ${message}\n`);
    process.exit(1);
  }
}
