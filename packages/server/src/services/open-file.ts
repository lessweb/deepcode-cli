/**
 * Project file opening helpers.
 *
 * Summary:
 * Normalizes project-local file paths and builds platform-specific opener command
 * candidates for editor/file open requests.
 *
 * Exports:
 * - normalizeProjectFilePath(projectRoot: string, filePath: string)
 * - getOpenFileCommands(filePath: string, line: number): OpenFileCommand[]
 * - type OpenFileRequest
 * - type OpenFileCommand
 */
import * as path from "node:path";

export type OpenFileRequest = {
  absolutePath: string;
  relativePath: string;
  line: number;
};

export type OpenFileCommand = {
  command: string;
  args: string[];
};

export function normalizeProjectFilePath(
  projectRoot: string,
  filePath: string
): { ok: true; data: Omit<OpenFileRequest, "line"> } | { ok: false; error: string } {
  const trimmedPath = filePath.trim();
  if (!trimmedPath) {
    return { ok: false, error: "filePath is required" };
  }
  const root = path.resolve(projectRoot);
  const absolutePath = path.resolve(path.isAbsolute(trimmedPath) ? trimmedPath : path.join(root, trimmedPath));
  const relativePath = path.relative(root, absolutePath);
  if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return { ok: false, error: "filePath must point to a file inside the project root" };
  }
  return { ok: true, data: { absolutePath, relativePath } };
}

export function getOpenFileCommands(filePath: string, line: number): OpenFileCommand[] {
  const commands: OpenFileCommand[] = [{ command: "code", args: ["-g", `${filePath}:${line}`] }];
  if (process.platform === "darwin") {
    commands.push({ command: "open", args: [filePath] });
  } else if (process.platform === "win32") {
    commands.push({ command: "cmd.exe", args: ["/c", "start", "", filePath] });
  } else {
    commands.push({ command: "xdg-open", args: [filePath] });
  }
  return commands;
}
