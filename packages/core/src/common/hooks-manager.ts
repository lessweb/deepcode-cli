import { spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resolveShellPath } from "./shell-utils";

export type HookPhase =
  | "pre-bash"
  | "post-bash"
  | "pre-read"
  | "post-read"
  | "pre-write"
  | "post-write"
  | "pre-edit"
  | "post-edit"
  | "on-error"
  | "on-compaction";

export type HookContext = {
  tool: string;
  sessionId: string;
  projectRoot: string;
  filePath?: string;
  command?: string;
  ok?: boolean;
  error?: string;
};

export type HookResult = {
  phase: HookPhase;
  ok: boolean;
  output: string;
  blocked: boolean;
  exitCode: number | null;
  durationMs: number;
};

const HOOK_TIMEOUT_MS = 30_000;
const HOOK_DIRS = [".deepcode/hooks", ".agents/hooks"];

function getHookRoots(projectRoot: string): Array<{ root: string; label: string }> {
  const homeDir = os.homedir();
  return [
    ...HOOK_DIRS.map((dir) => ({
      root: path.join(projectRoot, dir),
      label: `project:${dir}`,
    })),
    ...HOOK_DIRS.map((dir) => ({
      root: path.join(homeDir, dir),
      label: `user:${dir}`,
    })),
  ];
}

function findHookScript(projectRoot: string, phase: HookPhase): string | null {
  for (const { root } of getHookRoots(projectRoot)) {
    const scriptPath = path.join(root, `${phase}.js`);
    if (fs.existsSync(scriptPath)) {
      return scriptPath;
    }
    // Also accept .sh
    const shPath = path.join(root, `${phase}.sh`);
    if (fs.existsSync(shPath)) {
      return shPath;
    }
  }
  return null;
}

function resolveRunner(scriptPath: string): { command: string; args: string[] } {
  const ext = path.extname(scriptPath);
  if (ext === ".js") {
    return { command: process.execPath, args: [scriptPath] };
  }
  if (ext === ".sh") {
    const shellPath = resolveShellPath();
    return { command: shellPath, args: [scriptPath] };
  }
  return { command: scriptPath, args: [] };
}

export class HooksManager {
  private enabled: boolean;

  constructor(options: { enabled?: boolean } = {}) {
    this.enabled = options.enabled ?? true;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  async executeHook(phase: HookPhase, projectRoot: string, context: HookContext): Promise<HookResult> {
    const startedAt = Date.now();
    const emptyResult: HookResult = {
      phase,
      ok: true,
      output: "",
      blocked: false,
      exitCode: null,
      durationMs: 0,
    };

    if (!this.enabled) {
      return emptyResult;
    }

    const scriptPath = findHookScript(projectRoot, phase);
    if (!scriptPath) {
      return emptyResult;
    }

    const { command, args } = resolveRunner(scriptPath);
    const hookEnv: NodeJS.ProcessEnv = {
      ...process.env,
      DEEPCODE_HOOK_PHASE: phase,
      DEEPCODE_TOOL: context.tool,
      DEEPCODE_SESSION_ID: context.sessionId,
      DEEPCODE_PROJECT_ROOT: context.projectRoot,
      ...(context.filePath ? { DEEPCODE_FILE: context.filePath } : {}),
      ...(context.command ? { DEEPCODE_COMMAND: context.command } : {}),
    };

    const contextJson = JSON.stringify({
      phase,
      tool: context.tool,
      sessionId: context.sessionId,
      projectRoot: context.projectRoot,
      filePath: context.filePath ?? null,
      command: context.command ?? null,
      ok: context.ok ?? null,
      error: context.error ?? null,
      timestamp: new Date().toISOString(),
    });

    try {
      const result = await this.runHookProcess(command, args, contextJson, hookEnv, projectRoot);

      return {
        phase,
        ok: result.exitCode === 0,
        output: result.output,
        blocked: result.exitCode === 2, // Convention: exit code 2 = block
        exitCode: result.exitCode,
        durationMs: Date.now() - startedAt,
      };
    } catch (error) {
      return {
        phase,
        ok: false,
        output: error instanceof Error ? error.message : String(error),
        blocked: false,
        exitCode: -1,
        durationMs: Date.now() - startedAt,
      };
    }
  }

  private runHookProcess(
    command: string,
    args: string[],
    stdinJson: string,
    env: NodeJS.ProcessEnv,
    cwd: string
  ): Promise<{ output: string; exitCode: number | null }> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd,
        env,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
        timeout: HOOK_TIMEOUT_MS,
      });

      let stdout = "";
      let stderr = "";
      let settled = false;

      const settle = (exitCode: number | null, error?: string) => {
        if (settled) return;
        settled = true;
        if (error) {
          reject(new Error(error));
        } else {
          resolve({ output: stdout + (stderr ? `\n${stderr}` : ""), exitCode });
        }
      };

      child.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8").slice(0, 8000);
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8").slice(0, 2000);
      });

      child.on("error", (err) => settle(null, err.message));
      child.on("close", (code) => settle(typeof code === "number" ? code : null));

      // Write context to stdin
      child.stdin?.write(stdinJson);
      child.stdin?.end();
    });
  }

  /** Run pre-hook; if it blocks (exit code 2), return the block reason. */
  async runPreHook(
    phase: HookPhase,
    projectRoot: string,
    context: HookContext
  ): Promise<{ blocked: boolean; reason?: string }> {
    if (!this.enabled) return { blocked: false };

    const result = await this.executeHook(phase, projectRoot, context);
    if (result.blocked) {
      return {
        blocked: true,
        reason: result.output.trim() || `Operation blocked by ${phase} hook.`,
      };
    }
    return { blocked: false };
  }

  /** Run post-hook (fire-and-forget, result is informational). */
  async runPostHook(phase: HookPhase, projectRoot: string, context: HookContext): Promise<void> {
    await this.executeHook(phase, projectRoot, context);
  }
}
