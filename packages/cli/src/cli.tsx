import React from "react";
import { render } from "ink";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import {
  setShellIfWindows,
  getProjectCode,
  createOpenAIClient,
  resolveCurrentSettings,
  SessionManager,
} from "@vegamo/deepcode-core";
import type { SessionMessage } from "@vegamo/deepcode-core";
import { checkForNpmUpdate, promptForPendingUpdate } from "./common/update-check";
import { AppContainer } from "./ui";
import { parseArguments } from "./cli-args";
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

  // Configure Windows shell AFTER --version/--help handling.
  // On Windows without Git Bash, setShellIfWindows() throws and calls process.exit(1).
  // If called before argument parsing, --help and --version would fail on those machines.
  configureWindowsShell();

  let initialPrompt = parsed.prompt;
  let resumeSessionId = parsed.resume;
  const projectRoot = process.cwd();

  // Non-interactive mode: when -p is provided, skip TUI and output plain text
  if (initialPrompt) {
    await runNonInteractiveMode(projectRoot, initialPrompt);
    process.exit(0);
  }

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

/**
 * Run in non-interactive mode: process a single prompt and output plain text response.
 * This mimics Claude Code's --print mode behavior.
 */
async function runNonInteractiveMode(projectRoot: string, prompt: string): Promise<void> {
  let assistantResponse = "";
  let hasError = false;

  const sessionManager = new SessionManager({
    projectRoot,
    createOpenAIClient: () => createOpenAIClient(projectRoot),
    getResolvedSettings: () => resolveCurrentSettings(projectRoot),
    renderMarkdown: (text) => text,
    onAssistantMessage: (message: SessionMessage) => {
      // Collect assistant's text response
      if (message.role === "assistant" && typeof message.content === "string") {
        assistantResponse = message.content;
      }
    },
    onSessionEntryUpdated: () => {
      // No-op for non-interactive mode
    },
    onLlmStreamProgress: () => {
      // No-op for non-interactive mode
    },
    onMcpStatusChanged: () => {
      // No-op for non-interactive mode
    },
    onProcessStdout: () => {
      // No-op for non-interactive mode
    },
  });

  try {
    await sessionManager.handleUserPrompt({
      text: prompt,
      imageUrls: [],
    });

    // Output the response as plain text
    if (assistantResponse) {
      process.stdout.write(assistantResponse + "\n");
    }
  } catch (error) {
    hasError = true;
    const message = error instanceof Error ? error.message : String(error);
    writeStderrLine(`Error: ${message}`);
    process.exit(1);
  } finally {
    sessionManager.dispose();
  }

  if (!hasError && !assistantResponse) {
    writeStderrLine("Warning: No response received from the model.");
    process.exit(1);
  }
}
