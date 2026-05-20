import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";

const FILE_HISTORY_AUTHOR_NAME = "DeepCode Checkpoint";
const FILE_HISTORY_AUTHOR_EMAIL = "deepcode-checkpoint@localhost";

export class GitFileHistory {
  constructor(
    private readonly projectRoot: string,
    private readonly gitDir: string
  ) {}

  ensureSession(sessionId: string): string | undefined {
    const branchRef = this.getSessionBranchRef(sessionId);
    if (!branchRef) {
      return undefined;
    }

    try {
      if (!fs.existsSync(this.gitDir)) {
        fs.mkdirSync(path.dirname(this.gitDir), { recursive: true });
        this.runGit(["init"], { includeWorkTree: true });
      }

      const current = this.getCurrentCheckpointHash(sessionId);
      if (current) {
        return current;
      }

      const emptyTree = this.runGit(["mktree"], { includeWorkTree: false, input: "" }).trim();
      const commitHash = this.createCommit(emptyTree, null, "Initial checkpoint");
      this.runGit(["update-ref", branchRef, commitHash], { includeWorkTree: false });
      return commitHash;
    } catch {
      return undefined;
    }
  }

  getCurrentCheckpointHash(sessionId: string): string | undefined {
    const branchRef = this.getSessionBranchRef(sessionId);
    if (!branchRef || !fs.existsSync(this.gitDir)) {
      return undefined;
    }

    try {
      const hash = this.runGit(["rev-parse", "--verify", `${branchRef}^{commit}`], {
        includeWorkTree: false,
      }).trim();
      return isCommitHash(hash) ? hash : undefined;
    } catch {
      return undefined;
    }
  }

  recordCheckpoint(sessionId: string, filePaths: string[], message: string): string | undefined {
    const branchRef = this.getSessionBranchRef(sessionId);
    if (!branchRef) {
      return undefined;
    }

    const relativePaths = filePaths
      .map((filePath) => this.toProjectRelativeGitPath(filePath))
      .filter((filePath): filePath is string => Boolean(filePath));
    if (relativePaths.length === 0) {
      return this.getCurrentCheckpointHash(sessionId);
    }

    try {
      const parentHash = this.ensureSession(sessionId);
      if (!parentHash) {
        return undefined;
      }
      this.runGit(["read-tree", "--reset", branchRef], { includeWorkTree: true });
      this.runGit(["add", "-f", "-A", "--", ...relativePaths], { includeWorkTree: true });
      const treeHash = this.runGit(["write-tree"], { includeWorkTree: false }).trim();
      const parentTreeHash = this.runGit(["rev-parse", `${parentHash}^{tree}`], {
        includeWorkTree: false,
      }).trim();
      if (treeHash === parentTreeHash) {
        return parentHash;
      }

      const commitHash = this.createCommit(treeHash, parentHash, message);
      this.runGit(["update-ref", branchRef, commitHash, parentHash], { includeWorkTree: false });
      return commitHash;
    } catch {
      return undefined;
    }
  }

  canRestore(sessionId: string, checkpointHash: string): boolean {
    if (!isCommitHash(checkpointHash)) {
      return false;
    }
    if (!this.getSessionBranchRef(sessionId)) {
      return false;
    }
    if (!fs.existsSync(this.gitDir)) {
      return false;
    }

    try {
      this.runGit(["cat-file", "-e", `${checkpointHash}^{commit}`], { includeWorkTree: false });
      return true;
    } catch {
      return false;
    }
  }

  restore(sessionId: string, checkpointHash: string): void {
    if (!isCommitHash(checkpointHash)) {
      throw new Error("Invalid checkpoint hash.");
    }
    const branchRef = this.getSessionBranchRef(sessionId);
    if (!branchRef || !fs.existsSync(this.gitDir)) {
      throw new Error("File history Git repository was not found for this project.");
    }
    this.runGit(["cat-file", "-e", `${checkpointHash}^{commit}`], { includeWorkTree: false });

    try {
      this.runGit(["read-tree", "--reset", branchRef], { includeWorkTree: true });
    } catch {
      // If the session branch is missing, fall back to the target tree only.
      // The target checkpoint has already been validated above.
    }
    this.runGit(["read-tree", "--reset", "-u", checkpointHash], { includeWorkTree: true });
    this.runGit(["update-ref", branchRef, checkpointHash], { includeWorkTree: false });
  }

  private getSessionBranchRef(sessionId: string): string | null {
    if (!/^[A-Za-z0-9._-]+$/.test(sessionId)) {
      return null;
    }
    return `refs/heads/${sessionId}`;
  }

  private createCommit(treeHash: string, parentHash: string | null, message: string): string {
    const args = ["commit-tree", treeHash];
    if (parentHash) {
      args.push("-p", parentHash);
    }
    args.push("-m", message);
    return this.runGit(args, {
      includeWorkTree: false,
      env: getFileHistoryGitEnv(),
    }).trim();
  }

  private toProjectRelativeGitPath(filePath: string): string | null {
    const absolutePath = path.resolve(filePath);
    const relativePath = path.relative(this.projectRoot, absolutePath);
    if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
      return null;
    }
    return relativePath.split(path.sep).join("/");
  }

  private runGit(
    args: string[],
    options: { includeWorkTree: boolean; input?: string; env?: NodeJS.ProcessEnv }
  ): string {
    const gitArgs = ["-c", "core.autocrlf=false", "-c", "core.eol=lf", `--git-dir=${this.gitDir}`];
    if (options.includeWorkTree) {
      gitArgs.push(`--work-tree=${this.projectRoot}`);
    }
    gitArgs.push(...args);
    const result = childProcess.spawnSync("git", gitArgs, {
      encoding: "utf8",
      input: options.input,
      env: options.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    if (result.status !== 0) {
      const detail = (result.stderr || result.stdout || "").trim();
      throw new Error(detail || `git ${args.join(" ")} failed`);
    }
    return result.stdout ?? "";
  }
}

function getFileHistoryGitEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME || FILE_HISTORY_AUTHOR_NAME,
    GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL || FILE_HISTORY_AUTHOR_EMAIL,
    GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME || FILE_HISTORY_AUTHOR_NAME,
    GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL || FILE_HISTORY_AUTHOR_EMAIL,
  };
}

function isCommitHash(value: string): boolean {
  return /^[0-9a-f]{40}$/i.test(value);
}
