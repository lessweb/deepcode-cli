import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as pathWin32 from "path/win32";

const WINDOWS_GIT_LOCATIONS = ["C:\\Program Files\\Git\\cmd\\git.exe", "C:\\Program Files (x86)\\Git\\cmd\\git.exe"];

const NUL_REDIRECT_REGEX = /(\d?&?>+\s*)[Nn][Uu][Ll](?=\s|$|[|&;)\n])/g;
let cachedGitBashPath: string | null = null;

export type ShellKind = "bash" | "zsh" | "unknown";

export function setShellIfWindows(): void {
  if (process.platform !== "win32") {
    return;
  }
  process.env.SHELL = findGitBashPath();
}

export function findGitBashPath(): string {
  if (cachedGitBashPath) {
    return cachedGitBashPath;
  }

  for (const gitPath of findAllWindowsExecutableCandidates("git")) {
    const bashPath = pathWin32.join(gitPath, "..", "..", "bin", "bash.exe");
    if (fs.existsSync(bashPath)) {
      cachedGitBashPath = bashPath;
      return bashPath;
    }
  }

  throw new Error(
    "Deep Code on Windows requires Git Bash. Install Git Bash for Windows and ensure bash.exe is available in PATH."
  );
}

export function resolveShellPath(): string {
  if (process.platform === "win32") {
    return findGitBashPath();
  }

  const envShell = process.env.SHELL;
  if (envShell && getShellKind(envShell) !== "unknown") {
    return envShell;
  }
  return "/bin/bash";
}

export function getShellKind(shellPath: string): ShellKind {
  const executable = shellPath.replace(/\\/g, "/").split("/").pop()?.toLowerCase() ?? "";
  if (executable === "bash" || executable === "bash.exe") {
    return "bash";
  }
  if (executable === "zsh" || executable === "zsh.exe") {
    return "zsh";
  }
  return "unknown";
}

export function buildShellInitCommand(shellPath: string): string | null {
  switch (getShellKind(shellPath)) {
    case "zsh":
      return ['ZSHRC="${ZDOTDIR:-$HOME}/.zshrc"', 'if [ -f "$ZSHRC" ]; then . "$ZSHRC"; fi'].join("; ");
    case "bash":
      return ['BASHRC="${BASH_ENV:-$HOME/.bashrc}"', 'if [ -f "$BASHRC" ]; then . "$BASHRC"; fi'].join("; ");
    default:
      return null;
  }
}

export function buildDisableExtglobCommand(shellPath: string): string | null {
  switch (getShellKind(shellPath)) {
    case "bash":
      return "shopt -u extglob 2>/dev/null || true";
    case "zsh":
      return "setopt NO_EXTENDED_GLOB 2>/dev/null || true";
    default:
      return null;
  }
}

export function rewriteWindowsNullRedirect(command: string): string {
  return command.replace(NUL_REDIRECT_REGEX, "$1/dev/null");
}

export function windowsPathToPosixPath(windowsPath: string): string {
  if (windowsPath.startsWith("\\\\")) {
    return windowsPath.replace(/\\/g, "/");
  }

  const driveMatch = windowsPath.match(/^([A-Za-z]):[/\\]/);
  if (driveMatch) {
    const driveLetter = driveMatch[1].toLowerCase();
    return `/${driveLetter}${windowsPath.slice(2).replace(/\\/g, "/")}`;
  }

  return windowsPath.replace(/\\/g, "/");
}

export function posixPathToWindowsPath(posixPath: string): string {
  if (posixPath.startsWith("//")) {
    return posixPath.replace(/\//g, "\\");
  }

  const cygdriveMatch = posixPath.match(/^\/cygdrive\/([A-Za-z])(\/|$)/);
  if (cygdriveMatch) {
    const driveLetter = cygdriveMatch[1].toUpperCase();
    const rest = posixPath.slice(`/cygdrive/${cygdriveMatch[1]}`.length);
    return `${driveLetter}:${(rest || "\\").replace(/\//g, "\\")}`;
  }

  const driveMatch = posixPath.match(/^\/([A-Za-z])(\/|$)/);
  if (driveMatch) {
    const driveLetter = driveMatch[1].toUpperCase();
    const rest = posixPath.slice(2);
    return `${driveLetter}:${(rest || "\\").replace(/\//g, "\\")}`;
  }

  return posixPath.replace(/\//g, "\\");
}

export function toNativeCwd(shellCwd: string): string {
  if (process.platform !== "win32") {
    return shellCwd;
  }
  return posixPathToWindowsPath(shellCwd);
}

export function buildShellEnv(shellPath: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    SHELL: shellPath,
    GIT_EDITOR: "true",
  };

  if (process.platform === "win32") {
    const tmpdir = windowsPathToPosixPath(os.tmpdir());
    env.TMPDIR = tmpdir;
    env.TMPPREFIX = path.posix.join(tmpdir, "zsh");
  }

  return env;
}

function findAllWindowsExecutableCandidates(executable: string): string[] {
  const extraCandidates = executable === "git" ? WINDOWS_GIT_LOCATIONS : [];

  try {
    const output = execFileSync("where.exe", [executable], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
    return filterWindowsExecutableCandidates([
      ...output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
      ...extraCandidates,
    ]);
  } catch {
    return filterWindowsExecutableCandidates(extraCandidates);
  }
}

function filterWindowsExecutableCandidates(candidates: string[]): string[] {
  const cwd = process.cwd().toLowerCase();
  const seen = new Set<string>();
  const results: string[] = [];

  for (const candidate of candidates) {
    const normalized = path.resolve(candidate).toLowerCase();
    const candidateDir = path.dirname(normalized).toLowerCase();
    if (candidateDir === cwd || normalized.startsWith(`${cwd}${path.sep}`)) {
      continue;
    }
    if (!seen.has(normalized) && fs.existsSync(candidate)) {
      seen.add(normalized);
      results.push(candidate);
    }
  }

  return results;
}
