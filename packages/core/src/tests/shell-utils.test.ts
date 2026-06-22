import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildDisableExtglobCommand,
  buildShellInitCommand,
  getShellKind,
  posixPathToWindowsPath,
  resolveWindowsGitBashPath,
  rewriteWindowsNullRedirect,
  windowsPathToPosixPath,
} from "../common/shell-utils";
import { isAbsoluteFilePath, normalizeFilePath } from "../common/state";

test("Windows paths convert to Git Bash POSIX paths", () => {
  assert.equal(windowsPathToPosixPath("C:\\Users\\foo"), "/c/Users/foo");
  assert.equal(windowsPathToPosixPath("d:\\IdeaProjects\\guesswho-api"), "/d/IdeaProjects/guesswho-api");
  assert.equal(windowsPathToPosixPath("\\\\server\\share\\dir"), "//server/share/dir");
});

test("Git Bash POSIX paths convert to native Windows paths", () => {
  assert.equal(posixPathToWindowsPath("/c/Users/foo"), "C:\\Users\\foo");
  assert.equal(posixPathToWindowsPath("/cygdrive/d/IdeaProjects/guesswho-api"), "D:\\IdeaProjects\\guesswho-api");
  assert.equal(posixPathToWindowsPath("//server/share/dir"), "\\\\server\\share\\dir");
});

test("Windows nul redirects are rewritten for POSIX bash", () => {
  assert.equal(rewriteWindowsNullRedirect("cmd >nul"), "cmd >/dev/null");
  assert.equal(rewriteWindowsNullRedirect("cmd 2>NUL && next"), "cmd 2>/dev/null && next");
  assert.equal(rewriteWindowsNullRedirect("cmd &>nul\nnext"), "cmd &>/dev/null\nnext");
  assert.equal(rewriteWindowsNullRedirect("echo nullable"), "echo nullable");
});

test("Shell kind detection supports Windows bash.exe paths", () => {
  assert.equal(getShellKind("C:\\Program Files\\Git\\bin\\bash.exe"), "bash");
  assert.equal(getShellKind("/bin/zsh"), "zsh");
  assert.equal(
    buildDisableExtglobCommand("C:\\Program Files\\Git\\bin\\bash.exe"),
    "shopt -u extglob 2>/dev/null || true"
  );
  assert.equal(buildDisableExtglobCommand("/bin/zsh"), "setopt NO_EXTENDED_GLOB 2>/dev/null || true");
});

test("Shell init commands suppress startup file output", () => {
  assert.equal(
    buildShellInitCommand("/bin/zsh"),
    'ZSHRC="${ZDOTDIR:-$HOME}/.zshrc"; if [ -f "$ZSHRC" ]; then { . "$ZSHRC"; } >/dev/null 2>&1; fi'
  );
  assert.equal(
    buildShellInitCommand("/bin/bash"),
    'BASHRC="${BASH_ENV:-$HOME/.bashrc}"; if [ -f "$BASHRC" ]; then { . "$BASHRC"; } >/dev/null 2>&1; fi'
  );
  assert.equal(buildShellInitCommand("/bin/fish"), null);
});

test("Windows Git Bash detection prefers bash.exe from PATH", () => {
  const bashPath = "D:\\Tools\\Git\\bin\\bash.exe";
  const resolved = resolveWindowsGitBashPath({
    findExecutableCandidates: (executable) => (executable === "bash" ? [bashPath] : []),
    findGitExecPath: () => null,
    existsSync: (candidate) => candidate === bashPath,
  });

  assert.equal(resolved, bashPath);
});

test("Windows Git Bash detection derives bash.exe from git exec path", () => {
  const bashPath = "D:\\Tools\\Git\\bin\\bash.exe";
  const resolved = resolveWindowsGitBashPath({
    findExecutableCandidates: () => [],
    findGitExecPath: () => "D:/Tools/Git/mingw64/libexec/git-core",
    existsSync: (candidate) => candidate === bashPath,
  });

  assert.equal(resolved, bashPath);
});

test("Windows Git Bash detection derives bash.exe from git.exe candidates", () => {
  const bashPath = "D:\\Tools\\Git\\bin\\bash.exe";
  const resolved = resolveWindowsGitBashPath({
    findExecutableCandidates: (executable) => (executable === "git" ? ["D:\\Tools\\Git\\cmd\\git.exe"] : []),
    findGitExecPath: () => null,
    existsSync: (candidate) => candidate === bashPath,
  });

  assert.equal(resolved, bashPath);
});

test("Windows Git Bash detection skips WSL System32 bash.exe in PATH results", () => {
  // When WSL1 is enabled on older Windows 10, C:\Windows\System32\bash.exe
  // appears in PATH. That launcher would execute commands inside the Linux
  // distro instead of the Windows host, breaking all tool invocations.
  // The PATH bash strategy should ignore it and fall through.
  const system32Bash = "C:\\Windows\\System32\\bash.exe";
  const gitBash = "D:\\Tools\\Git\\bin\\bash.exe";
  const resolved = resolveWindowsGitBashPath({
    findExecutableCandidates: (executable) =>
      executable === "bash" ? [system32Bash] : executable === "git" ? ["D:\\Tools\\Git\\cmd\\git.exe"] : [],
    findGitExecPath: () => null,
    existsSync: (candidate) => candidate === gitBash,
  });

  assert.equal(resolved, gitBash);
});

test("File tool path normalization converts Git Bash drive paths on Windows", () => {
  assert.equal(
    normalizeFilePath("/d/IdeaProjects/guesswho-api/API_DOCUMENTATION.md", "win32"),
    "D:\\IdeaProjects\\guesswho-api\\API_DOCUMENTATION.md"
  );
  assert.equal(normalizeFilePath("/cygdrive/c/Users/foo/file.txt", "win32"), "C:\\Users\\foo\\file.txt");
  assert.equal(normalizeFilePath("/dev/null", "win32"), "\\dev\\null");
});

test("File tool absolute checks accept Git Bash drive paths but reject root-relative POSIX paths on Windows", () => {
  assert.equal(isAbsoluteFilePath("/d/IdeaProjects/guesswho-api/API_DOCUMENTATION.md", "win32"), true);
  assert.equal(isAbsoluteFilePath("D:/IdeaProjects/guesswho-api/API_DOCUMENTATION.md", "win32"), true);
  assert.equal(isAbsoluteFilePath("/dev/null", "win32"), false);
  assert.equal(isAbsoluteFilePath("./API_DOCUMENTATION.md", "win32"), false);
});
