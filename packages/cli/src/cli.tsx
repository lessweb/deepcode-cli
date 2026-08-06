import { render } from "ink";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { ensureUserSettingsFile, getProjectCode, setShellIfWindows } from "@vegamo/deepcode-core";
import { checkForNpmUpdate, promptForPendingUpdate } from "./common/update-check";
import { AppContainer } from "./ui";
import { parseArguments } from "./cli-args";
import { writeStderrLine, writeStdoutLine } from "./utils/stdio-helpers";
import { getPackageJson } from "./utils/package";
import { CLI_VERSION } from "./generated/git-commit";
import { runExecMode } from "./exec-runner";

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

  // First run: scaffold a ready-to-edit settings.json so the user only has to
  // paste their API key instead of authoring the file by hand. (#202)
  const scaffold = ensureUserSettingsFile();
  if (scaffold.created) {
    writeStderrLine(`Created ${scaffold.path} — edit it to add your API key.\n`);
  }

  let initialPrompt = parsed.prompt;
  let resumeSessionId = parsed.resume;
  let forkSessionId = parsed.fork;
  const projectRoot = process.cwd();

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
    const inkInstance = render(
      <AppContainer
        projectRoot={projectRoot}
        version={packageInfo?.version ?? CLI_VERSION}
        initialPrompt={appInitialPrompt}
        resumeSessionId={appResumeSessionId}
        forkSessionId={typeof appForkSessionId === "string" ? appForkSessionId : undefined}
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
