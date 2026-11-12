import * as os from "node:os";
import path from "node:path";

export function formatHomeRelativePath(value: string, home = os.homedir()): string {
  const normalizedValue = path.resolve(value);
  const normalizedHome = path.resolve(home);
  const relative = path.relative(normalizedHome, normalizedValue);

  if (relative === "") {
    return "~";
  }
  if (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) {
    return `~${path.sep}${relative}`;
  }
  return normalizedValue;
}

export function formatDisplayPath(value: string, projectRoot = process.cwd(), home = os.homedir()): string {
  if (!value) return "";
  const absolute = path.resolve(projectRoot, value);
  const relative = path.relative(projectRoot, absolute);
  if (relative && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) {
    return relative;
  }
  const displayPath = formatHomeRelativePath(absolute, home);
  return displayPath.startsWith(`~${path.sep}`) ? `~/${displayPath.slice(2).split(path.sep).join("/")}` : displayPath;
}
