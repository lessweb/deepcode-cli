import { spawn, type ChildProcess } from "child_process";
import { createInterface, type Interface } from "readline";
import * as path from "path";
import { killProcessTree } from "../common/process-tree";
import type { McpTransport, McpTransportHandlers } from "./mcp-transport";

export type McpSpawnSpec = {
  command: string;
  args: string[];
  shell: boolean;
  windowsHide?: boolean;
};

const STDERR_BUFFER_LIMIT = 4000;

/**
 * Stdio transport: launches the MCP server as a child process and exchanges
 * newline-delimited JSON-RPC messages over stdin/stdout. Captured stderr is
 * attached to errors for easier debugging.
 */
export class StdioTransport implements McpTransport {
  private process: ChildProcess | null = null;
  private reader: Interface | null = null;
  private stderrBuffer = "";
  private handlers: McpTransportHandlers | null = null;
  private intentionallyClosed = false;
  private closeReported = false;

  constructor(
    private readonly serverName: string,
    private readonly command: string,
    private readonly args: string[] = [],
    private readonly env?: Record<string, string>
  ) {}

  async start(handlers: McpTransportHandlers): Promise<void> {
    this.handlers = handlers;
    this.intentionallyClosed = false;
    this.closeReported = false;

    const childEnv = {
      ...process.env,
      ...this.env,
    };
    const args = withNpxYesArg(this.command, this.args);
    const spawnSpec = createMcpSpawnSpec(this.command, args);

    this.process = spawn(spawnSpec.command, spawnSpec.args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: childEnv,
      shell: spawnSpec.shell,
      windowsHide: spawnSpec.windowsHide,
    });

    this.process.on("error", (err) => {
      this.reportClose(`Failed to start MCP server "${this.serverName}" (${this.command}): ${err.message}`);
    });

    this.process.on("close", (code) => {
      this.reportClose(`MCP server "${this.serverName}" exited with code ${code}`);
    });

    if (this.process.stderr) {
      this.process.stderr.on("data", (data: Buffer) => {
        this.appendStderr(data.toString("utf8"));
      });
    }

    this.reader = createInterface({ input: this.process.stdout! });
    this.reader.on("line", (line: string) => {
      this.handleLine(line);
    });
  }

  send(message: object): void {
    if (this.process?.stdin) {
      this.process.stdin.write(`${JSON.stringify(message)}\n`);
    }
  }

  close(): void {
    this.intentionallyClosed = true;
    if (this.reader) {
      this.reader.close();
      this.reader = null;
    }
    if (this.process) {
      if (typeof this.process.pid === "number") {
        killProcessTree(this.process.pid, "SIGTERM", { killGroupOnNonWindows: false });
      } else {
        this.process.kill();
      }
      this.process = null;
    }
  }

  isConnected(): boolean {
    return this.process !== null && this.process.exitCode === null;
  }

  decorateError(message: string): Error {
    const stderr = this.stderrBuffer.trim();
    return new Error(stderr ? `${message}. stderr: ${stderr}` : message);
  }

  private reportClose(reason: string): void {
    if (this.closeReported) return;
    this.closeReported = true;
    this.reader?.close();
    this.reader = null;
    this.process = null;
    if (!this.intentionallyClosed) {
      this.handlers?.onClose(reason);
    }
  }

  private handleLine(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      // Ignore unparseable lines (e.g. server debug noise on stdout)
      return;
    }

    // Per MCP 2025-03-26 §4.1.1.3 a payload may be a JSON-RPC batch.
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (item && typeof item === "object") {
          this.handlers?.onMessage(item as object);
        }
      }
      return;
    }

    if (parsed && typeof parsed === "object") {
      this.handlers?.onMessage(parsed as object);
    }
  }

  private appendStderr(text: string): void {
    this.stderrBuffer = `${this.stderrBuffer}${text}`;
    if (this.stderrBuffer.length > STDERR_BUFFER_LIMIT) {
      this.stderrBuffer = this.stderrBuffer.slice(-STDERR_BUFFER_LIMIT);
    }
  }
}

function withNpxYesArg(command: string, args: string[]): string[] {
  const executable = path
    .basename(command)
    .toLowerCase()
    .replace(/\.cmd$/, "");
  if (executable !== "npx") {
    return args;
  }
  if (args.includes("-y") || args.includes("--yes")) {
    return args;
  }
  return ["-y", ...args];
}

export function createMcpSpawnSpec(
  command: string,
  args: string[],
  platform: NodeJS.Platform = process.platform
): McpSpawnSpec {
  if (platform === "win32") {
    return {
      // On Windows, shell: true lets cmd.exe resolve the command via PATHEXT
      // (npx -> npx.cmd, etc.). Join command and args into a single string
      // with empty spawn args to avoid Node 24 DEP0190.
      // Only quote arguments that need protection from cmd.exe to prevent
      // double-wrapping by Node.js's own shell quoting.
      command: [command, ...args].map(quoteWindowsArgIfNeeded).join(" "),
      args: [],
      shell: true,
      windowsHide: true,
    };
  }

  return {
    command,
    args,
    shell: false,
  };
}

function quoteWindowsArgIfNeeded(arg: string): string {
  if (/[\s"&|<>^()]/.test(arg)) {
    return `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/\\+$/g, "$&$&")}"`;
  }
  return arg;
}
