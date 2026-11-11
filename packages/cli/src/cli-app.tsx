import { render } from "ink";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { setShellIfWindows, getProjectCode, resolveCurrentSettings } from "@vegamo/deepcode-core";
import { checkForNpmUpdate, promptForPendingUpdate } from "./common/update-check";
import { AppContainer } from "./ui";
import type { ParsedCliArgs } from "./cli-args";
import { writeStderrLine } from "./utils/stdio-helpers";
import type { PackageJson } from "./utils/package";
import { CLI_VERSION } from "./generated/git-commit";
import { runExecMode } from "./exec-runner";
import { TerminalImages } from "./ui/core/terminal-images";
import { createImageInput } from "./ui/core/terminal-image-input";

export async function runCliApp(parsed: ParsedCliArgs, packageInfo: PackageJson): Promise<void> {
  const projectRoot = process.cwd();
  const settingsFile = parsed.settingsFile === undefined ? undefined : resolve(projectRoot, parsed.settingsFile);
  if (settingsFile !== undefined) {
    try {
      resolveCurrentSettings(projectRoot, settingsFile);
    } catch (error) {
      writeStderrLine(`deepcode: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
      return;
    }
  }

  // Configure Windows shell AFTER --version/--help handling.
  // On Windows without Git Bash, setShellIfWindows() throws and calls process.exit(1).
  // If called before argument parsing, --help and --version would fail on those machines.
  configureWindowsShell();

  let initialPrompt = parsed.prompt;
  let resumeSessionId = parsed.resume;
  let forkSessionId = parsed.fork;
  // Resolve --last to the most recent session ID for the current project
  if (parsed.last) {
    const projectCode = getProjectCode(projectRoot);
    const indexPath = join(homedir(), ".deepcode", "projects", projectCode, "sessions-index.json");
    try {
      const index = JSON.parse(readFileSync(indexPath, "utf-8"));
      const entries: { id: string; updateTime: string }[] = Array.isArray(index?.entries) ? index.entries : [];
      if (entries.length === 0) {
        writeStderrLine("No previous sessions found for the current project.\n");
        process.exit(1);
      }
      const mostRecent = entries.reduce((a, b) => (a.updateTime > b.updateTime ? a : b));
      resumeSessionId = mostRecent.id;
    } catch {
      writeStderrLine("No previous sessions found for the current project.\n");
      process.exit(1);
    }
  }

  if (forkSessionId === true) {
    const projectCode = getProjectCode(projectRoot);
    const indexPath = join(homedir(), ".deepcode", "projects", projectCode, "sessions-index.json");
    try {
      const index = JSON.parse(readFileSync(indexPath, "utf-8"));
      const entries: { id: string; updateTime: string }[] = Array.isArray(index?.entries) ? index.entries : [];
      if (entries.length === 0) {
        writeStderrLine("No previous sessions found for the current project.\n");
        process.exit(1);
      }
      const mostRecent = entries.reduce((a, b) => (a.updateTime > b.updateTime ? a : b));
      forkSessionId = mostRecent.id;
    } catch {
      writeStderrLine("No previous sessions found for the current project.\n");
      process.exit(1);
    }
  }

  if (parsed.exec) {
    process.exitCode = await runExecMode({
      prompt: parsed.prompt!,
      projectRoot,
      settingsFile,
      sessionId: parsed.sessionId,
      json: parsed.json,
      resumeSessionId: typeof resumeSessionId === "string" ? resumeSessionId : undefined,
      forkSessionId: typeof forkSessionId === "string" ? forkSessionId : undefined,
    });
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

  if (typeof forkSessionId === "string") {
    const projectCode = getProjectCode(projectRoot);
    const indexPath = join(homedir(), ".deepcode", "projects", projectCode, "sessions-index.json");
    try {
      const index = JSON.parse(readFileSync(indexPath, "utf-8"));
      const found = Array.isArray(index?.entries) && index.entries.some((e: { id: string }) => e.id === forkSessionId);
      if (!found) {
        writeStderrLine(`No saved session found with ID "${forkSessionId}".\n`);
        process.exit(1);
      }
    } catch {
      writeStderrLine(`No saved session found with ID "${forkSessionId}".\n`);
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
    const appForkSessionId = forkSessionId;
    forkSessionId = undefined;
    const images = new TerminalImages(process.stdout);
    const imageInput = createImageInput(process.stdin, images);
    const inkInstance = render(
      <AppContainer
        projectRoot={projectRoot}
        settingsFile={settingsFile}
        version={packageInfo?.version ?? CLI_VERSION}
        initialPrompt={appInitialPrompt}
        resumeSessionId={appResumeSessionId}
        forkSessionId={typeof appForkSessionId === "string" ? appForkSessionId : undefined}
        onRestart={() => restartRef.current?.()}
      />,
      {
        exitOnCtrlC: false,
        stdout: images.stdout,
        stdin: imageInput.stdin,
        incrementalRendering: Boolean(images.protocol),
      }
    );
    imageInput.query();

    restartRef.current = () => {
      restarting = true;
      images.stdout.write("\u001B[2J\u001B[3J\u001B[H\n");
      inkInstance.unmount();
      imageInput.dispose();
      images.dispose();
      startApp();
    };

    inkInstance.waitUntilExit().then(() => {
      if (!restarting) {
        imageInput.dispose();
        images.dispose();
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
