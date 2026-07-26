import { spawn } from "child_process";
import { randomUUID } from "crypto";
import { resolveShellPath, buildShellEnv, toNativeCwd } from "./shell-utils";

export type ShellSession = {
  id: string;
  name: string; // user-assigned name (e.g., "build", "test")
  cwd: string;
  env: Record<string, string>;
  createdAt: string;
  commandCount: number;
};

export type ShellExecResult = {
  ok: boolean;
  output: string;
  exitCode: number | null;
  signal: string | null;
  truncated: boolean;
  cwd: string;
  durationMs: number;
};

const SHELL_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_CHARS = 30_000;
const MAX_SESSIONS = 8;

const sessionsByName = new Map<string, Map<string, ShellSession>>();

function getSessionMap(sessionId: string): Map<string, ShellSession> {
  let map = sessionsByName.get(sessionId);
  if (!map) {
    map = new Map<string, ShellSession>();
    sessionsByName.set(sessionId, map);
  }
  return map;
}

export class ShellSessionManager {
  createSession(
    sessionId: string,
    name: string,
    options: { cwd?: string; env?: Record<string, string> } = {}
  ): ShellSession {
    const map = getSessionMap(sessionId);

    // Enforce max session limit
    if (map.size >= MAX_SESSIONS) {
      const oldest = [...map.entries()].sort((a, b) => a[1].createdAt.localeCompare(b[1].createdAt))[0];
      if (oldest) {
        map.delete(oldest[0]);
      }
    }

    const shell: ShellSession = {
      id: randomUUID(),
      name,
      cwd: options.cwd ?? process.cwd(),
      env: options.env ?? {},
      createdAt: new Date().toISOString(),
      commandCount: 0,
    };
    map.set(name, shell);
    return shell;
  }

  getSession(sessionId: string, name: string): ShellSession | null {
    return getSessionMap(sessionId).get(name) ?? null;
  }

  listSessions(sessionId: string): ShellSession[] {
    return [...getSessionMap(sessionId).values()];
  }

  setEnv(sessionId: string, name: string, key: string, value: string): boolean {
    const shell = this.getSession(sessionId, name);
    if (!shell) return false;
    shell.env[key] = value;
    return true;
  }

  setCwd(sessionId: string, name: string, cwd: string): boolean {
    const shell = this.getSession(sessionId, name);
    if (!shell) return false;
    shell.cwd = cwd;
    return true;
  }

  async execute(
    sessionId: string,
    name: string,
    command: string,
    options: { timeoutMs?: number } = {}
  ): Promise<ShellExecResult> {
    const shell = this.getSession(sessionId, name);
    if (!shell) {
      return {
        ok: false,
        output: `Shell session "${name}" not found. Create it first with the bash tool.`,
        exitCode: 1,
        signal: null,
        truncated: false,
        cwd: "",
        durationMs: 0,
      };
    }

    const startedAt = Date.now();
    const timeoutMs = options.timeoutMs ?? SHELL_TIMEOUT_MS;
    const marker = `__DEEPCODE_SH_${randomUUID().slice(0, 8)}__`;
    const shellPath = resolveShellPath();

    const wrappedCommand = buildWrappedCommand(command, marker, shell.env);

    return new Promise((resolve) => {
      const child = spawn(shellPath, ["-c", wrappedCommand], {
        cwd: shell.cwd,
        env: buildShellEnv(shellPath, shell.env),
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        timeout: timeoutMs,
      });

      let stdout = "";
      let stderr = "";
      let settled = false;

      const settle = (exitCode: number | null, signal: string | null, error?: string) => {
        if (settled) return;
        settled = true;

        if (error) {
          resolve({
            ok: false,
            output: error,
            exitCode,
            signal,
            truncated: false,
            cwd: shell.cwd,
            durationMs: Date.now() - startedAt,
          });
          return;
        }

        const { output: cleaned, cwd: newCwd } = stripMarker(stdout, marker);
        const combined = stderr ? `${cleaned}\n${stderr}` : cleaned;
        const truncated = combined.length > MAX_OUTPUT_CHARS;
        const output = truncated ? combined.slice(0, MAX_OUTPUT_CHARS) : combined;

        if (newCwd) {
          shell.cwd = newCwd;
        }
        shell.commandCount += 1;

        resolve({
          ok: exitCode === 0 && signal === null,
          output,
          exitCode,
          signal,
          truncated,
          cwd: shell.cwd,
          durationMs: Date.now() - startedAt,
        });
      };

      child.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });

      child.on("error", (err) => settle(-1, null, err.message));
      child.on("close", (code, signal) => settle(typeof code === "number" ? code : null, signal ?? null));
    });
  }

  removeSession(sessionId: string, name: string): boolean {
    return getSessionMap(sessionId).delete(name);
  }

  clearAll(sessionId: string): void {
    sessionsByName.delete(sessionId);
  }
}

function buildWrappedCommand(command: string, marker: string, env: Record<string, string>): string {
  const exports = Object.entries(env)
    .map(([k, v]) => `export ${k}='${v.replace(/'/g, "'\\''")}'`)
    .join("; ");

  const parts = [
    exports,
    command,
    `__DEEPCODE_SH_STATUS__=$?`,
    `printf '%s%s\\n' "${marker}" "$PWD"`,
    "exit $__DEEPCODE_SH_STATUS__",
  ].filter(Boolean);

  return `{ ${parts.join("; ")}; } < /dev/null`;
}

function stripMarker(stdout: string, marker: string): { output: string; cwd: string | null } {
  if (!stdout) return { output: "", cwd: null };

  const lines = stdout.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].startsWith(marker)) {
      const shellCwd = lines[i].slice(marker.length).trim();
      const cwd = shellCwd ? toNativeCwd(shellCwd) : null;
      lines.splice(i, 1);
      return { output: lines.join("\n"), cwd };
    }
  }
  return { output: stdout, cwd: null };
}
