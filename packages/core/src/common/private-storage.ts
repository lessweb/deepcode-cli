/**
 * User-private filesystem helpers for DeepCode runtime state.
 *
 * DeepCode stores API keys and session data under the user's home directory.
 * POSIX callers should rely on explicit mode bits (0600/0700) rather than the
 * process umask, which is commonly permissive on desktop systems.  Windows
 * ignores POSIX mode bits, so we additionally restrict the NTFS ACL to the
 * current user — matching the 0600 intent.
 */

import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/** POSIX mode for private files: owner read/write only. */
export const PRIVATE_FILE_MODE = 0o600;
/** POSIX mode for private directories: owner rwx only. */
export const PRIVATE_DIRECTORY_MODE = 0o700;

/**
 * Resolve the current Windows user as a fully-qualified principal
 * (``DOMAIN\user``) so ACL grants are unambiguous across machines/domains.
 * Returns null when the identity cannot be resolved (callers no-op).
 */
export function windowsIdentity(): string | null {
  if (process.platform !== "win32") {
    return null;
  }
  try {
    const stdout = execFileSync("whoami", {
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const principal = stdout.trim();
    return principal || null;
  } catch {
    return null;
  }
}

/**
 * Restrict an NTFS path to the current user (Windows only; no-op elsewhere).
 *
 * Two idempotent steps:
 *  1. ``icacls /inheritance:r`` removes inherited ACEs so a permissive parent
 *     (e.g. the profile root granting ``Authenticated Users``) no longer
 *     applies.
 *  2. ``icacls /grant:r <user>:F`` grants the current user exclusive full
 *     control (``:r`` replaces, does not append).
 *
 * Failures are swallowed (best-effort, like POSIX chmod) — the file is still
 * created; only its ACL may be more permissive than intended.
 */
export function restrictWindowsAcl(targetPath: string): void {
  if (process.platform !== "win32") {
    return;
  }
  const identity = windowsIdentity();
  if (!identity) {
    return;
  }
  for (const args of [
    ["icacls", targetPath, "/inheritance:r"],
    ["icacls", targetPath, "/grant:r", `${identity}:F`],
  ]) {
    try {
      execFileSync("icacls", args, {
        encoding: "utf8",
        timeout: 15000,
        windowsHide: true,
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      return; // best-effort; keep the caller moving
    }
  }
}

/**
 * Write a private file with user-only permissions on every platform.
 *
 * - POSIX: mode 0600 (subject to umask, which typically keeps it at 0600).
 * - Windows: mode bits are ignored by the OS, so we remove inherited ACEs
 *   and grant the current user exclusive full control.
 */
export function writePrivateFile(targetPath: string, contents: string): void {
  fs.writeFileSync(targetPath, contents, { encoding: "utf8", mode: PRIVATE_FILE_MODE });
  if (process.platform === "win32") {
    restrictWindowsAcl(targetPath);
  }
}

/**
 * Ensure a directory exists with user-only permissions (0700 on POSIX;
 * current-user-only ACL on Windows).
 */
export function ensurePrivateDirectory(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  if (process.platform === "win32") {
    restrictWindowsAcl(dirPath);
  }
}

/** Home directory used for DeepCode user state. */
export function deepcodeHome(): string {
  return path.join(os.homedir(), ".deepcode");
}
