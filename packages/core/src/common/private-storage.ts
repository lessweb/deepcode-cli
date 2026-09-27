/**
 * User-private filesystem helpers for DeepCode runtime state.
 *
 * DeepCode stores API keys and session data under the user's home directory.
 * POSIX callers should rely on explicit mode bits (0600/0700) rather than the
 * process umask, which is commonly permissive on desktop systems.  Windows
 * ignores POSIX mode bits, so we additionally restrict the NTFS ACL to the
 * current user — matching the 0600 intent.
 */

import childProcess from "child_process";
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
 *
 * ``USERDOMAIN``/``USERNAME`` win when present: they are set by Windows for
 * every process, whereas under MSYS/Git-Bash a POSIX ``whoami`` earlier in
 * PATH answers with a bare, ambiguous name.
 *
 * Returns null when the identity cannot be resolved (callers no-op).
 */
export function windowsIdentity(): string | null {
  if (process.platform !== "win32") {
    return null;
  }
  const { USERDOMAIN, USERNAME } = process.env;
  if (USERDOMAIN && USERNAME) {
    return `${USERDOMAIN}\\${USERNAME}`;
  }
  try {
    const stdout = childProcess.execFileSync("whoami", {
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
 * Two idempotent steps, ordered fail-safe — grant before strip:
 *  1. ``icacls /grant:r`` grants the current user exclusive full control
 *     (``:r`` replaces, does not append).  For a directory the grant carries
 *     ``(OI)(CI)`` so it is inherited by existing and future children.
 *  2. ``icacls /inheritance:r`` removes inherited ACEs so a permissive parent
 *     (e.g. the profile root granting ``Authenticated Users``) no longer
 *     applies.  For a directory this propagates to children, which is why the
 *     grant above must already name this user.
 *
 * The order matters: if the grant is issued first and fails, the inherited
 * ACEs are still in place and the path stays usable.  Stripping first can
 * leave the path (and, via inheritance, its children) with no ACE at all — the
 * next open then throws ``EPERM`` and the state file becomes unreachable.
 *
 * Returns whether the ACL now grants the current user alone.  Failures are
 * reported, never thrown: callers decide whether an unprotected path is
 * acceptable.  Note the argv must not repeat the program name — passing
 * ``icacls icacls <path>`` makes icacls exit with ERROR_INVALID_PARAMETER (87)
 * and leave the ACL untouched, which is how this helper silently no-opped
 * before.
 */
export function restrictWindowsAcl(targetPath: string, isDirectory = false): boolean {
  if (process.platform !== "win32") {
    return true;
  }
  const identity = windowsIdentity();
  if (!identity) {
    return false;
  }
  const grantee = isDirectory ? `${identity}:(OI)(CI)F` : `${identity}:F`;
  const runIcacls = (args: string[]): boolean => {
    try {
      childProcess.execFileSync("icacls", args, {
        encoding: "utf8",
        timeout: 15000,
        windowsHide: true,
        stdio: ["ignore", "pipe", "ignore"],
      });
      return true;
    } catch {
      return false; // best-effort: keep the caller moving, but do not pretend
    }
  };
  // Grant first: if this fails the inherited ACEs are still in place, so the
  // path stays usable.  Stripping first could leave a path with no ACE at all.
  if (!runIcacls([targetPath, "/grant:r", grantee])) {
    return false;
  }
  // Then drop the inherited ACEs.  For a directory this propagates to
  // children, which is why the grant above must already name this user.
  if (!runIcacls([targetPath, "/inheritance:r"])) {
    return false;
  }
  return true;
}

/**
 * Write a private file with user-only permissions on every platform.
 *
 * - POSIX: mode 0600 (applied by the write itself, subject to umask).
 * - Windows: mode bits are ignored by the OS, so we grant the current user
 *   exclusive full control first and then remove inherited ACEs.
 *
 * Returns true when the platform's permission model was applied as requested.
 */
export function writePrivateFile(targetPath: string, contents: string): boolean {
  fs.writeFileSync(targetPath, contents, { encoding: "utf8", mode: PRIVATE_FILE_MODE });
  return process.platform === "win32" ? restrictWindowsAcl(targetPath) : true;
}

/**
 * Ensure a directory exists with user-only permissions (0700 on POSIX;
 * current-user-only ACL on Windows).  Returns true when applied as requested.
 */
export function ensurePrivateDirectory(dirPath: string): boolean {
  fs.mkdirSync(dirPath, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  return process.platform === "win32" ? restrictWindowsAcl(dirPath, true) : true;
}

/** Home directory used for DeepCode user state. */
export function deepcodeHome(): string {
  return path.join(os.homedir(), ".deepcode");
}
