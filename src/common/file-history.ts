import * as childProcess from "child_process";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

const FILE_HISTORY_AUTHOR_NAME = "DeepCode Checkpoint";
const FILE_HISTORY_AUTHOR_EMAIL = "deepcode-checkpoint@localhost";
const MANIFEST_PATH = ".deepcode-file-history.json";

type FileHistoryEntry = {
  path: string;
  blob: string;
  mode: "100644";
};

type FileHistoryManifest = {
  version: 1;
  files: Record<string, FileHistoryEntry>;
};

export class GitFileHistory {
  constructor(
    _projectRoot: string,
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
        this.runGit(["init"]);
      }

      const current = this.getCurrentCheckpointHash(sessionId);
      if (current) {
        return current;
      }

      const treeHash = this.createTree(emptyManifest());
      const commitHash = this.createCommit(treeHash, null, "Initial checkpoint");
      this.runGit(["update-ref", branchRef, commitHash]);
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
      const hash = this.runGit(["rev-parse", "--verify", `${branchRef}^{commit}`]).trim();
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

    const absolutePaths = uniqueAbsolutePaths(filePaths);
    if (absolutePaths.length === 0) {
      return this.getCurrentCheckpointHash(sessionId);
    }

    try {
      const parentHash = this.ensureSession(sessionId);
      if (!parentHash) {
        return undefined;
      }

      const manifest = this.readManifest(parentHash);
      for (const filePath of absolutePaths) {
        const key = this.getFileKey(filePath);
        if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
          delete manifest.files[key];
          continue;
        }

        manifest.files[key] = {
          path: filePath,
          blob: this.hashFile(filePath),
          mode: "100644",
        };
      }

      const treeHash = this.createTree(manifest);
      const parentTreeHash = this.runGit(["rev-parse", `${parentHash}^{tree}`]).trim();
      if (treeHash === parentTreeHash) {
        return parentHash;
      }

      const commitHash = this.createCommit(treeHash, parentHash, message);
      this.runGit(["update-ref", branchRef, commitHash, parentHash]);
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
      this.runGit(["cat-file", "-e", `${checkpointHash}^{commit}`]);
      this.readManifest(checkpointHash);
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
    this.runGit(["cat-file", "-e", `${checkpointHash}^{commit}`]);

    const currentHash = this.getCurrentCheckpointHash(sessionId);
    const currentManifest = currentHash ? this.readManifest(currentHash) : emptyManifest();
    const targetManifest = this.readManifest(checkpointHash);

    for (const [key, entry] of Object.entries(currentManifest.files)) {
      if (!targetManifest.files[key]) {
        removeTrackedFile(entry.path);
      }
    }

    for (const entry of Object.values(targetManifest.files)) {
      fs.mkdirSync(path.dirname(entry.path), { recursive: true });
      fs.writeFileSync(entry.path, this.readBlob(entry.blob));
    }

    this.runGit(["update-ref", branchRef, checkpointHash]);
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
      env: getFileHistoryGitEnv(),
    }).trim();
  }

  private createTree(manifest: FileHistoryManifest): string {
    const normalizedManifest = normalizeManifest(manifest);
    const manifestBlob = this.hashContent(`${JSON.stringify(normalizedManifest, null, 2)}\n`);
    const entries: string[] = [`100644 blob ${manifestBlob}\t${MANIFEST_PATH}\0`];

    for (const [key, entry] of Object.entries(normalizedManifest.files)) {
      entries.push(`${entry.mode} blob ${entry.blob}\t${key}\0`);
    }

    return this.runGit(["mktree", "-z"], { input: entries.join("") }).trim();
  }

  private readManifest(commitHash: string): FileHistoryManifest {
    const buffer = this.runGitBuffer(["cat-file", "blob", `${commitHash}:${MANIFEST_PATH}`]);
    const parsed = JSON.parse(buffer.toString("utf8")) as FileHistoryManifest;
    if (!parsed || parsed.version !== 1 || !parsed.files || typeof parsed.files !== "object") {
      throw new Error("Invalid file history manifest.");
    }
    return normalizeManifest(parsed);
  }

  private readBlob(blobHash: string): Buffer {
    if (!isCommitHash(blobHash)) {
      throw new Error("Invalid file history blob hash.");
    }
    return this.runGitBuffer(["cat-file", "blob", blobHash]);
  }

  private hashFile(filePath: string): string {
    const blobHash = this.runGit(["hash-object", "-w", "--", filePath]).trim();
    if (!isCommitHash(blobHash)) {
      throw new Error("Invalid file history blob hash.");
    }
    return blobHash;
  }

  private hashContent(content: string): string {
    const blobHash = this.runGit(["hash-object", "-w", "--stdin"], { input: content }).trim();
    if (!isCommitHash(blobHash)) {
      throw new Error("Invalid file history blob hash.");
    }
    return blobHash;
  }

  private getFileKey(filePath: string): string {
    const hash = crypto.createHash("sha256").update(filePath).digest("hex");
    return `files-${hash}`;
  }

  private runGit(args: string[], options: { input?: string | Buffer; env?: NodeJS.ProcessEnv } = {}): string {
    return this.spawnGit(args, options, "utf8") as string;
  }

  private runGitBuffer(args: string[], options: { input?: string | Buffer; env?: NodeJS.ProcessEnv } = {}): Buffer {
    return this.spawnGit(args, options, "buffer") as Buffer;
  }

  private spawnGit(
    args: string[],
    options: { input?: string | Buffer; env?: NodeJS.ProcessEnv },
    encoding: BufferEncoding | "buffer"
  ): string | Buffer {
    const gitArgs = ["-c", "core.autocrlf=false", "-c", "core.eol=lf", `--git-dir=${this.gitDir}`, ...args];
    const result = childProcess.spawnSync("git", gitArgs, {
      encoding,
      input: options.input,
      env: options.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    if (result.status !== 0) {
      const stderr = Buffer.isBuffer(result.stderr) ? result.stderr.toString("utf8") : result.stderr;
      const stdout = Buffer.isBuffer(result.stdout) ? result.stdout.toString("utf8") : result.stdout;
      const detail = (stderr || stdout || "").trim();
      throw new Error(detail || `git ${args.join(" ")} failed`);
    }
    return result.stdout ?? (encoding === "buffer" ? Buffer.alloc(0) : "");
  }
}

function emptyManifest(): FileHistoryManifest {
  return { version: 1, files: {} };
}

function normalizeManifest(manifest: FileHistoryManifest): FileHistoryManifest {
  const files: Record<string, FileHistoryEntry> = {};
  for (const [key, entry] of Object.entries(manifest.files).sort(([left], [right]) => left.localeCompare(right))) {
    if (!isValidStoredPath(key) || !entry || entry.mode !== "100644" || !isCommitHash(entry.blob)) {
      throw new Error("Invalid file history manifest.");
    }
    files[key] = {
      path: path.resolve(entry.path),
      blob: entry.blob,
      mode: "100644",
    };
  }
  return { version: 1, files };
}

function uniqueAbsolutePaths(filePaths: string[]): string[] {
  return Array.from(new Set(filePaths.map((filePath) => path.resolve(filePath))));
}

function isValidStoredPath(value: string): boolean {
  return /^files-[0-9a-f]{64}$/.test(value);
}

function removeTrackedFile(filePath: string): void {
  if (!fs.existsSync(filePath)) {
    return;
  }
  const stat = fs.lstatSync(filePath);
  if (stat.isDirectory()) {
    return;
  }
  fs.unlinkSync(filePath);
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
