import React from "react";
import { render } from "ink";
import { setShellIfWindows } from "./common/shell-utils";
import { checkForNpmUpdate, promptForPendingUpdate, type PackageInfo } from "./common/update-check";
import { AppContainer } from "./ui";
import { t } from "./common/i18n";
import { initI18n } from "./common/i18n";
import { resolveCurrentSettings } from "./ui/views/App";

const args = process.argv.slice(2);
const packageInfo = readPackageInfo();

// Initialize i18n early so --help and --version can use translations
const settings = resolveCurrentSettings(process.cwd());
initI18n(settings.locale, {
  thinkingLocale: settings.thinkingLocale,
  replyLocale: settings.replyLocale,
});

if (args.includes("--version") || args.includes("-v")) {
  process.stdout.write(`${packageInfo.version || "unknown"}\n`);
  process.exit(0);
}

if (args.includes("--help") || args.includes("-h")) {
  process.stdout.write(
    [
      t("cli.help.title"),
      "",
      t("cli.help.usage"),
      t("cli.help.launchTui"),
      t("cli.help.launchWithPrompt"),
      t("cli.help.launchWithPromptLong"),
      t("cli.help.printVersion"),
      t("cli.help.printHelp"),
      "",
      t("cli.help.configSection"),
      t("cli.help.userSettings"),
      t("cli.help.projectSettings"),
      t("cli.help.userSkills"),
      t("cli.help.projectSkills"),
      t("cli.help.legacySkills"),
      "",
      t("cli.help.tuiSection"),
      t("cli.help.enterSend"),
      t("cli.help.shiftEnterNewline"),
      t("cli.help.homeEnd"),
      t("cli.help.altLeftRight"),
      t("cli.help.ctrlW"),
      t("cli.help.ctrlV"),
      t("cli.help.ctrlX"),
      t("cli.help.esc"),
      t("cli.help.slash"),
      t("cli.help.slashSkills"),
      t("cli.help.slashModel"),
      t("cli.help.slashNew"),
      t("cli.help.slashInit"),
      t("cli.help.slashResume"),
      t("cli.help.slashContinue"),
      t("cli.help.slashUndo"),
      t("cli.help.slashMcp"),
      t("cli.help.slashRaw"),
      t("cli.help.slashExit"),
      t("cli.help.slashConfig"),
      t("cli.help.ctrlD"),
    ].join("\n") + "\n"
  );
  process.exit(0);
}

function extractInitialPrompt(args: string[]): string | undefined {
  const promptIndex = args.findIndex((arg) => arg === "-p" || arg === "--prompt");
  if (promptIndex !== -1 && promptIndex + 1 < args.length) {
    return args[promptIndex + 1];
  }
  return undefined;
}

let initialPrompt = extractInitialPrompt(args);
const projectRoot = process.cwd();
configureWindowsShell();

if (!process.stdin.isTTY) {
  process.stderr.write(t("cli.help.ttyRequired") + "\n");
  process.exit(1);
}

void main();

async function main(): Promise<void> {
  const updatePromptResult = await promptForPendingUpdate(packageInfo);

  const restartRef: { current: (() => void) | null } = { current: null };

  function startApp(): void {
    let restarting = false;
    const appInitialPrompt = initialPrompt;
    initialPrompt = undefined;

    // Initialize i18n before rendering
    const settings = resolveCurrentSettings(projectRoot);
    initI18n(settings.locale, {
      thinkingLocale: settings.thinkingLocale,
      replyLocale: settings.replyLocale,
    });

    const inkInstance = render(
      <AppContainer
        projectRoot={projectRoot}
        version={packageInfo.version}
        initialPrompt={appInitialPrompt}
        onRestart={() => restartRef.current?.()}
        initialLocale={settings.locale}
        initialThinkingLocale={settings.thinkingLocale}
        initialReplyLocale={settings.replyLocale}
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

  if (!updatePromptResult.installed) {
    void checkForNpmUpdate(packageInfo);
  }

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
