import { execFileSync } from "node:child_process";

export default function gitBranchProvider({ projectRoot }) {
  try {
    const out = execFileSync("git", ["branch", "--show-current"], {
      cwd: projectRoot || process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1500,
    }).trim();
    if (!out) return "";
    return `git:${out}`;
  } catch {
    return "";
  }
}
