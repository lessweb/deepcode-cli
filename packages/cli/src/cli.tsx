import React from "react";
import { render } from "ink";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import {
  setShellIfWindows,
  getProjectCode,
  SessionManager,
  createOpenAIClient,
  resolveCurrentSettings,
} from "@vegamo/deepcode-core";
import type { SessionMessage, LlmStreamProgress } from "@vegamo/deepcode-core";
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

  if (parsed.headless && parsed.prompt) {
    await runHeadless(parsed.prompt, projectRoot);
    return;
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
 * Run in headless (non-interactive) mode.
 * Creates a SessionManager, submits the prompt, outputs the final response, and exits.
 */
async function runHeadless(promptText: string, projectRoot: string): Promise<void> {
  process.stderr.write("[headless] Starting non-interactive mode...\n");

  const assistantMessages: SessionMessage[] = [];

  const sessionManager = new SessionManager({
    projectRoot,
    createOpenAIClient: () => createOpenAIClient(projectRoot),
    getResolvedSettings: () => {
      const settings = resolveCurrentSettings(projectRoot);
      // Headless = no user to ask → auto-approve all permissions
      return {
        ...settings,
        permissions: {
          allow: [],
          deny: [],
          ask: [],
          defaultMode: "allowAll" as const,
        },
      };
    },
    renderMarkdown: (text: string) => text,
    onAssistantMessage: (message: SessionMessage) => {
      assistantMessages.push(message);
      // Stream content to stdout as it arrives
      if (message.content) {
        process.stdout.write(message.content as string);
      }
    },
    onLlmStreamProgress: (progress: LlmStreamProgress) => {
      if (progress.phase === "start") {
        process.stderr.write("[headless] Model is thinking...\n");
      } else if (progress.phase === "end") {
        process.stderr.write("[headless] Response complete.\n");
      }
    },
  });

  try {
    // Initialize MCP servers from settings
    const settings = resolveCurrentSettings(projectRoot);
    await sessionManager.initMcpServers(settings.mcpServers);

    // Submit the prompt
    await sessionManager.handleUserPrompt({ text: promptText });

    process.stdout.write("\n");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[headless] Error: ${message}\n`);
    process.exit(1);
  } finally {
    sessionManager.dispose();
  }

  process.exit(0);
}
