import { execFileSync, spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { resolveShellPath } from "./shell-utils";

export type BashToolName = "rg" | "jq";

export type BashToolState = {
  name: BashToolName;
  available: boolean;
};

export type BashToolingStatus = {
  tools: BashToolState[];
  missing: BashToolName[];
};

export type InstallCommand = {
  command: string;
  args: string[];
  display: string;
};

export type BashToolInstallPlan = {
  manager: string;
  commands: InstallCommand[];
};

export type BashToolInstallResult = {
  before: BashToolingStatus;
  after: BashToolingStatus;
  plan: BashToolInstallPlan | null;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  error?: string;
};

export type InstallSpawn = {
  command: string;
  args: string[];
};

const BASH_TOOLS: BashToolName[] = ["rg", "jq"];
const WINDOWS_TOOL_PACKAGES: Record<BashToolName, string[]> = {
  rg: ["BurntSushi.ripgrep.MSVC", "BurntSushi.ripgrep.GNU"],
  jq: ["jqlang.jq"],
};

export function getBashToolingStatus(): BashToolingStatus {
  addDiscoveredWindowsToolDirsToPath();
  const tools = BASH_TOOLS.map((name) => ({
    name,
    available: isCommandAvailableInBash(name),
  }));
  return {
    tools,
    missing: tools.filter((tool) => !tool.available).map((tool) => tool.name),
  };
}

export function formatBashToolingStatus(status: BashToolingStatus): string {
  if (status.missing.length === 0) {
    return "rg+jq ready";
  }
  return `missing ${status.missing.join(",")} (/install)`;
}

export function formatBashToolInstallResult(result: BashToolInstallResult): string {
  if (result.before.missing.length === 0) {
    return "/install\n└ rg and jq are already available";
  }
  if (!result.plan) {
    return [
      `/install\n└ Missing ${result.before.missing.join(", ")}`,
      "No supported package manager found. Install ripgrep and jq manually, then restart the CLI.",
    ].join("\n");
  }
  if (result.after.missing.length === 0) {
    return `/install\n└ Installed rg and jq with ${result.plan.manager}`;
  }
  if (result.exitCode === 0 && result.signal === null && !result.error) {
    return [
      `/install\n└ ${result.plan.manager} finished, but Bash still cannot find every tool`,
      `Still missing: ${result.after.missing.join(", ")}`,
      "Restart the terminal or add the installed binaries to PATH.",
    ].join("\n");
  }
  const failedSuffix =
    result.exitCode === null && result.signal === null
      ? ""
      : ` (exit ${result.exitCode ?? result.signal ?? "unknown"})`;
  return [
    `/install\n└ ${result.plan.manager} install did not finish cleanly${failedSuffix}`,
    `Still missing: ${result.after.missing.join(", ")}`,
    `Command: ${result.plan.commands.map((command) => command.display).join(" && ")}`,
  ].join("\n");
}

export function buildBashToolInstallPlan(
  missing: BashToolName[],
  options: {
    platform?: NodeJS.Platform;
    hasCommand?: (command: string) => boolean;
    isRoot?: boolean;
  } = {}
): BashToolInstallPlan | null {
  const platform = options.platform ?? process.platform;
  const hasCommand = options.hasCommand ?? isNativeCommandAvailable;
  const isRoot = options.isRoot ?? (typeof process.getuid === "function" ? process.getuid() === 0 : false);
  const packages = missing.map((tool) => (tool === "rg" ? "ripgrep" : "jq"));

  if (missing.length === 0) {
    return { manager: "none", commands: [] };
  }

  if (platform === "win32") {
    if (hasCommand("winget")) {
      return {
        manager: "winget",
        commands: missing.map((tool) => {
          const packageId = tool === "rg" ? "BurntSushi.ripgrep.MSVC" : "jqlang.jq";
          const args = [
            "install",
            "-e",
            "--id",
            packageId,
            "--accept-package-agreements",
            "--accept-source-agreements",
          ];
          return { command: "winget", args, display: formatCommand("winget", args) };
        }),
      };
    }
    if (hasCommand("scoop")) {
      const args = ["install", ...packages];
      return { manager: "scoop", commands: [{ command: "scoop", args, display: formatCommand("scoop", args) }] };
    }
    if (hasCommand("choco")) {
      const args = ["install", "-y", ...packages];
      return { manager: "choco", commands: [{ command: "choco", args, display: formatCommand("choco", args) }] };
    }
    return null;
  }

  if (hasCommand("brew")) {
    const args = ["install", ...packages];
    return { manager: "brew", commands: [{ command: "brew", args, display: formatCommand("brew", args) }] };
  }

  if (hasCommand("apt-get")) {
    const update = privilegedCommand("apt-get", ["update"], platform, hasCommand, isRoot);
    const install = privilegedCommand("apt-get", ["install", "-y", ...packages], platform, hasCommand, isRoot);
    return { manager: "apt-get", commands: [update, install] };
  }
  if (hasCommand("dnf")) {
    return singlePrivilegedPlan("dnf", ["install", "-y", ...packages], platform, hasCommand, isRoot);
  }
  if (hasCommand("yum")) {
    return singlePrivilegedPlan("yum", ["install", "-y", ...packages], platform, hasCommand, isRoot);
  }
  if (hasCommand("pacman")) {
    return singlePrivilegedPlan("pacman", ["-S", "--needed", ...packages], platform, hasCommand, isRoot);
  }
  if (hasCommand("zypper")) {
    return singlePrivilegedPlan("zypper", ["install", "-y", ...packages], platform, hasCommand, isRoot);
  }
  if (hasCommand("apk")) {
    return singlePrivilegedPlan("apk", ["add", ...packages], platform, hasCommand, isRoot);
  }

  return null;
}

export async function installMissingBashTools(): Promise<BashToolInstallResult> {
  const before = getBashToolingStatus();
  if (before.missing.length === 0) {
    return { before, after: before, plan: { manager: "none", commands: [] }, exitCode: 0, signal: null };
  }

  const plan = buildBashToolInstallPlan(before.missing);
  if (!plan) {
    return { before, after: before, plan: null, exitCode: null, signal: null };
  }

  let exitCode: number | null = 0;
  let signal: NodeJS.Signals | null = null;
  let error: string | undefined;

  for (const command of plan.commands) {
    const result = await runInstallCommand(command);
    exitCode = result.exitCode;
    signal = result.signal;
    error = result.error;
    if (exitCode !== 0 || signal !== null || error) {
      break;
    }
  }

  return {
    before,
    after: getBashToolingStatus(),
    plan,
    exitCode,
    signal,
    error,
  };
}

export function addDiscoveredWindowsToolDirsToPath(): void {
  if (process.platform !== "win32") {
    return;
  }

  const dirs = BASH_TOOLS.flatMap((tool) => findWindowsToolDirs(tool));
  for (const dir of dirs) {
    prependProcessPath(dir);
  }
}

function isCommandAvailableInBash(command: BashToolName): boolean {
  try {
    execFileSync(resolveShellPath(), ["-lc", `command -v ${command} >/dev/null 2>&1`], {
      stdio: "ignore",
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}

function isNativeCommandAvailable(command: string): boolean {
  try {
    if (process.platform === "win32") {
      execFileSync("where.exe", [command], { stdio: "ignore", windowsHide: true });
    } else {
      execFileSync("sh", ["-lc", `command -v ${shellSingleQuote(command)} >/dev/null 2>&1`], { stdio: "ignore" });
    }
    return true;
  } catch {
    return false;
  }
}

function singlePrivilegedPlan(
  manager: string,
  args: string[],
  platform: NodeJS.Platform,
  hasCommand: (command: string) => boolean,
  isRoot: boolean
): BashToolInstallPlan {
  return { manager, commands: [privilegedCommand(manager, args, platform, hasCommand, isRoot)] };
}

function privilegedCommand(
  command: string,
  args: string[],
  platform: NodeJS.Platform,
  hasCommand: (command: string) => boolean,
  isRoot: boolean
): InstallCommand {
  if (platform !== "win32" && !isRoot && hasCommand("sudo")) {
    const sudoArgs = [command, ...args];
    return { command: "sudo", args: sudoArgs, display: formatCommand("sudo", sudoArgs) };
  }
  return { command, args, display: formatCommand(command, args) };
}

function runInstallCommand(command: InstallCommand): Promise<{
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  error?: string;
}> {
  return new Promise((resolve) => {
    let settled = false;
    const installSpawn = buildInstallSpawn(command);
    const child = spawn(installSpawn.command, installSpawn.args, {
      stdio: "inherit",
      windowsHide: false,
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve({ exitCode: null, signal: null, error: error.message });
    });
    child.on("close", (exitCode, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve({ exitCode, signal });
    });
  });
}

export function buildInstallSpawn(command: InstallCommand, platform: NodeJS.Platform = process.platform): InstallSpawn {
  if (platform !== "win32") {
    return { command: command.command, args: command.args };
  }

  const resolvedCommand = findNativeCommandPath(command.command) ?? command.command;
  if (!/\.(cmd|bat)$/i.test(resolvedCommand)) {
    return { command: resolvedCommand, args: command.args };
  }

  return {
    command: "cmd.exe",
    args: ["/d", "/s", "/c", formatCommandForCmd(resolvedCommand, command.args)],
  };
}

function findNativeCommandPath(command: string): string | null {
  try {
    const output = execFileSync("where.exe", [command], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
    return (
      output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean) ?? null
    );
  } catch {
    return null;
  }
}

function findWindowsToolDirs(tool: BashToolName): string[] {
  const executable = `${tool}.exe`;
  const dirs = findExecutableDirs(executable);
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) {
    return dirs;
  }

  const wingetPackages = path.join(localAppData, "Microsoft", "WinGet", "Packages");
  for (const packageId of WINDOWS_TOOL_PACKAGES[tool]) {
    dirs.push(...findExecutableDirsUnderPackage(wingetPackages, packageId, executable));
  }
  return uniquePaths(dirs);
}

function findExecutableDirs(executable: string): string[] {
  try {
    const output = execFileSync("where.exe", [executable], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
    return output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((file) => path.dirname(file));
  } catch {
    return [];
  }
}

function findExecutableDirsUnderPackage(root: string, packageId: string, executable: string): string[] {
  if (!fs.existsSync(root)) {
    return [];
  }

  const dirs: string[] = [];
  const stack = safeReadDir(root)
    .filter((entry) => entry.isDirectory() && entry.name.toLowerCase().startsWith(packageId.toLowerCase()))
    .map((entry) => path.join(root, entry.name));

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    for (const entry of safeReadDir(current)) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && entry.name.toLowerCase() === executable.toLowerCase()) {
        dirs.push(current);
      }
    }
  }
  return dirs;
}

function safeReadDir(dir: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function prependProcessPath(dir: string): void {
  const key = Object.keys(process.env).find((envKey) => envKey.toLowerCase() === "path") ?? "Path";
  const current = process.env[key] ?? "";
  const parts = current.split(path.delimiter).filter(Boolean);
  if (parts.some((part) => path.resolve(part).toLowerCase() === path.resolve(dir).toLowerCase())) {
    return;
  }
  process.env[key] = [dir, ...parts].join(path.delimiter);
}

function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const results: string[] = [];
  for (const item of paths) {
    const key = path.resolve(item).toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    results.push(item);
  }
  return results;
}

function formatCommand(command: string, args: string[]): string {
  return [command, ...args].map(quoteCommandArg).join(" ");
}

function quoteCommandArg(arg: string): string {
  return /^[A-Za-z0-9._/:-]+$/.test(arg) ? arg : JSON.stringify(arg);
}

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function formatCommandForCmd(command: string, args: string[]): string {
  return [command, ...args].map(quoteCmdArg).join(" ");
}

function quoteCmdArg(arg: string): string {
  if (/^[A-Za-z0-9._/:=-]+$/.test(arg)) {
    return arg;
  }
  return `"${arg.replace(/"/g, '""')}"`;
}
