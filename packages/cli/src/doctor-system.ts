import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { resolveShellPath, resolveWindowsGitBashPath } from "@vegamo/deepcode-core/common/shell-utils";
import { TENCENT_MIRROR_REGISTRY } from "@vegamo/deepcode-core/common/npm-registry";
import { killProcessTree } from "@vegamo/deepcode-core/common/process-tree";
import { describeNetworkError } from "@vegamo/deepcode-core/common/doctor-api";
import { inspectJsonFile, type DiagnosticCheck } from "@vegamo/deepcode-core/settings-diagnostics";

export type CommandResult = { code: number | null; stdout: string; stderr: string; error?: string };
export type CommandRunner = (command: string, args: string[]) => Promise<CommandResult>;

export function executablePaths(command: string, env = process.env, platform = process.platform): string[] {
  const extensions = platform === "win32" ? (env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""];
  const paths: string[] = [];
  for (const directory of (env.PATH ?? "").split(platform === "win32" ? ";" : ":")) {
    if (!directory) continue;
    for (const extension of extensions) {
      const candidate = path.resolve(directory.replace(/^"|"$/g, ""), command + extension.toLowerCase());
      try {
        fs.accessSync(candidate, platform === "win32" ? fs.constants.F_OK : fs.constants.X_OK);
        if (fs.statSync(candidate).isFile() && !paths.includes(candidate)) paths.push(candidate);
      } catch {
        /* Not an executable candidate. */
      }
    }
  }
  return paths;
}

/** No shell expansion, bounded output, and no npm diagnostic logs. */
export const runDoctorCommand: CommandRunner = (command, args) =>
  new Promise((resolve) => {
    if (command === "npm" && process.platform === "win32") {
      const npm = executablePaths("npm")
        .map((file) => path.join(path.dirname(file), "node_modules/npm/bin/npm-cli.js"))
        .find((file) => fs.existsSync(file));
      if (!npm) {
        resolve({ code: null, stdout: "", stderr: "", error: "npm CLI could not be located next to npm.cmd." });
        return;
      }
      command = process.execPath;
      args = [npm, ...args];
    }
    const child = spawn(command, args, {
      shell: false,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, npm_config_logs_max: "0", npm_config_update_notifier: "false" },
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result: CommandResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      if (child.pid) killProcessTree(child.pid);
      else child.kill("SIGKILL");
      finish({ code: null, stdout, stderr, error: "Command timed out after 5 seconds." });
    }, 5000);
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk).slice(0, Math.max(0, 65536 - stdout.length));
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk).slice(0, Math.max(0, 65536 - stderr.length));
    });
    child.on("error", (error) =>
      finish({ code: null, stdout, stderr, error: (error as NodeJS.ErrnoException).code ?? "Unable to start command" })
    );
    child.on("close", (code) => finish({ code, stdout: stdout.trim(), stderr }));
  });

function commandFailure(result: CommandResult): string {
  if (result.error) return result.error;
  const code = result.stderr.match(
    /\b(EACCES|EPERM|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|CERT_HAS_EXPIRED|SELF_SIGNED_CERT_IN_CHAIN|E401|E403|E404)\b/
  )?.[1];
  return `Exited with code ${result.code ?? "unknown"}${code ? ` (${code})` : ""}.`;
}

export function checkWritable(target: string, name: string, required = true): DiagnosticCheck {
  let existing = target;
  try {
    while (!fs.existsSync(existing)) {
      const parent = path.dirname(existing);
      if (parent === existing) break;
      existing = parent;
    }
    if (!fs.statSync(existing).isDirectory())
      return {
        status: required ? "FAIL" : "WARN",
        name,
        detail: `${existing} is not a directory. Choose a directory or remove the conflicting file.`,
      };
    fs.accessSync(existing, fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK);
    return {
      status: "PASS",
      name,
      detail:
        existing === target ? `${target}: accessible.` : `${target}: not created; parent ${existing} is accessible.`,
    };
  } catch {
    return {
      status: required ? "FAIL" : "WARN",
      name,
      detail: `${existing}: insufficient access. Correct directory ownership or permissions.`,
    };
  }
}

export async function inspectShell(
  run: CommandRunner = runDoctorCommand,
  platform = process.platform
): Promise<DiagnosticCheck> {
  try {
    let shell: string | null;
    if (platform === "win32") {
      const [bash, git, execPath] = await Promise.all([
        run("where.exe", ["bash"]),
        run("where.exe", ["git"]),
        run("git", ["--exec-path"]),
      ]);
      const cwd = path.win32.resolve(process.cwd()).toLowerCase();
      const candidates = (result: CommandResult) =>
        result.code === 0
          ? result.stdout
              .split(/\r?\n/)
              .map((line) => line.trim())
              .filter((candidate) => {
                const normalized = path.win32.resolve(candidate).toLowerCase();
                return (
                  candidate &&
                  !/system32[\\/]bash\.exe$/i.test(candidate) &&
                  path.win32.dirname(normalized) !== cwd &&
                  !normalized.startsWith(cwd + "\\")
                );
              })
          : [];
      shell = resolveWindowsGitBashPath({
        findExecutableCandidates: (name) => candidates(name === "bash" ? bash : git),
        findGitExecPath: () => (execPath.code === 0 ? execPath.stdout : null),
        existsSync: fs.existsSync,
      });
    } else shell = resolveShellPath();
    if (!shell) throw new Error();
    fs.accessSync(shell, fs.constants.X_OK);
    return { status: "PASS", name: "Shell", detail: shell };
  } catch {
    return {
      status: "FAIL",
      name: "Shell",
      detail:
        platform === "win32"
          ? "Git Bash was not found. Install Git for Windows and make bash.exe available in PATH."
          : "The configured shell is unavailable. Check SHELL or install /bin/bash.",
    };
  }
}

export async function inspectRuntime(options: {
  home: string;
  projectRoot: string;
  version: string;
  run?: CommandRunner;
}): Promise<DiagnosticCheck[]> {
  const run = options.run ?? runDoctorCommand;
  const checks: DiagnosticCheck[] = [
    { status: "PASS", name: "Deep Code", detail: `${options.version}; ${process.argv[1] ?? "unknown entry point"}` },
    {
      status: Number(process.versions.node.split(".")[0]) >= 22 ? "PASS" : "FAIL",
      name: "Node.js",
      detail: `${process.version}; ${process.execPath}. Requires Node.js 22 or later.`,
    },
    { status: "PASS", name: "Platform", detail: `${process.platform}/${process.arch}; ${os.release()}` },
    {
      status: process.stdin.isTTY && process.stdout.isTTY ? "PASS" : "WARN",
      name: "Terminal",
      detail:
        process.stdin.isTTY && process.stdout.isTTY
          ? "Interactive terminal available."
          : "Not an interactive terminal. Interactive startup requires a TTY; --doctor and --exec work without one.",
    },
    checkWritable(path.join(options.home, ".deepcode"), "Deep Code state directory"),
    checkWritable(path.join(options.home, ".deepcode-plus"), "Plus settings directory", false),
  ];
  checks.push(await inspectShell(run));
  const git = await run("git", ["--version"]);
  checks.push({
    status: git.code === 0 ? "PASS" : "WARN",
    name: "Git",
    detail: git.code === 0 ? git.stdout : `${commandFailure(git)} Git-dependent features will be unavailable.`,
  });
  const installs = executablePaths("deepcode");
  const real = (file: string) => {
    try {
      return fs.realpathSync(file);
    } catch {
      return file;
    }
  };
  const distinct = [...new Set(installs.map(real))];
  const current = process.argv[1] ? real(path.resolve(process.argv[1])) : undefined;
  checks.push({
    status:
      distinct.length > 1 || (distinct.length && current !== distinct[0]) ? "WARN" : installs.length ? "PASS" : "SKIP",
    name: "Deep Code on PATH",
    detail: installs.length
      ? `${installs.join(", ")}${distinct.length > 1 || current !== distinct[0] ? ". PATH may select a different installation. Compare these paths with the running entry point before updating." : ""}`
      : "No deepcode executable on PATH; this may be a source checkout or a direct invocation.",
  });
  for (const fileName of ["cli.json", "update-check.json"]) {
    const file = inspectJsonFile(path.join(options.home, ".deepcode", fileName));
    checks.push({
      status: file.status === "loaded" ? "PASS" : file.status === "missing" ? "SKIP" : "WARN",
      name: fileName,
      detail: `${file.path}: ${file.detail}${file.status === "invalid" || file.status === "unreadable" ? ". Normal startup ignores this file's read error." : ""}`,
    });
    if (
      fileName === "cli.json" &&
      file.value?.rawMode !== undefined &&
      !["lite", "normal"].includes(String(file.value.rawMode))
    )
      checks.push({
        status: "WARN",
        name: "CLI display setting",
        detail: `${file.path}: invalid rawMode; lite applies.`,
      });
  }
  return checks;
}

export type RegistryProbe = (registry: string) => Promise<DiagnosticCheck>;
export async function inspectRegistry(registry: string): Promise<DiagnosticCheck> {
  let url: URL;
  try {
    url = new URL(registry);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error();
    url.pathname = `${url.pathname.replace(/\/$/, "")}/@vegamo%2fdeepcode-cli/latest`;
  } catch {
    return {
      status: "WARN",
      name: "Update source",
      detail: `${registry}: invalid registry URL or embedded credentials. Check npm registry configuration.`,
    };
  }
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000), redirect: "error" });
    if (!response.ok) {
      await response.body?.cancel();
      return {
        status: "WARN",
        name: "Update source",
        detail: `${registry}: HTTP ${response.status}. Check registry access${response.status === 401 || response.status === 403 ? " and npm authentication" : ""}.`,
      };
    }
    // Public package metadata only; never read or forward npm authentication tokens.
    const reader = response.body?.getReader();
    let body = "";
    if (reader) {
      const decoder = new TextDecoder();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          body += decoder.decode(value, { stream: true });
          if (body.length > 65536)
            return {
              status: "WARN",
              name: "Update source",
              detail: `${registry}: unexpected oversized package metadata.`,
            };
        }
      } finally {
        await reader.cancel();
      }
    }
    const version: unknown = (JSON.parse(body) as { version?: unknown }).version;
    if (typeof version !== "string" || !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version))
      return { status: "WARN", name: "Update source", detail: `${registry}: invalid package version response.` };
    return { status: "PASS", name: "Update source", detail: `${registry}: latest version ${version}.` };
  } catch (error) {
    return {
      status: "WARN",
      name: "Update source",
      detail: `${registry}: ${error instanceof SyntaxError ? "Invalid package metadata." : describeNetworkError(error)}`,
    };
  }
}

export async function inspectUpdates(options: {
  home: string;
  run?: CommandRunner;
  registryProbe?: RegistryProbe;
}): Promise<DiagnosticCheck[]> {
  const run = options.run ?? runDoctorCommand;
  const npm = await run("npm", ["--version"]);
  if (npm.code !== 0)
    return [
      {
        status: "WARN",
        name: "npm",
        detail: `${commandFailure(npm)} npm is required for automatic updates. Install npm or repair PATH.`,
      },
    ];
  const checks: DiagnosticCheck[] = [{ status: "PASS", name: "npm", detail: npm.stdout }];
  const queries = [
    ["config", "get", "registry"],
    ["config", "get", "@vegamo:registry"],
    ["prefix", "-g"],
    ["root", "-g"],
    ["config", "get", "cache"],
  ];
  const results = await Promise.all(queries.map((args) => run("npm", args)));
  for (let index = 0; index < results.length; index++)
    if (results[index].code !== 0)
      checks.push({ status: "WARN", name: `npm ${queries[index].join(" ")}`, detail: commandFailure(results[index]) });
  const value = (index: number) =>
    results[index].code === 0 &&
    results[index].stdout &&
    results[index].stdout !== "undefined" &&
    results[index].stdout !== "null"
      ? results[index].stdout
      : undefined;
  const registry = value(1) ?? value(0);
  const prefix = value(2);
  const root = value(3);
  const cache = value(4);
  if (prefix) checks.push(checkWritable(prefix, "npm global prefix", false));
  if (root) {
    checks.push(checkWritable(path.join(root, "@vegamo/deepcode-cli"), "npm update destination", false));
    try {
      const current = fs.realpathSync(process.argv[1]);
      const destination = fs.realpathSync(path.join(root, "@vegamo/deepcode-cli"));
      if (!current.startsWith(destination + path.sep))
        checks.push({
          status: "WARN",
          name: "Update destination mismatch",
          detail: `npm install -g targets ${destination}, but this process runs ${current}. Updating npm's global installation may not update this copy.`,
        });
    } catch {
      checks.push({
        status: "WARN",
        name: "Global installation",
        detail: `${path.join(root, "@vegamo/deepcode-cli")}: no matching global installation found. This may be a source checkout or a temporary installation.`,
      });
    }
  }
  if (cache) checks.push(checkWritable(cache, "npm cache directory", false));
  const registryProbe = options.registryProbe ?? inspectRegistry;
  const registries = [...new Set([TENCENT_MIRROR_REGISTRY, ...(registry ? [registry] : [])])];
  checks.push(...(await Promise.all(registries.map(registryProbe))));
  checks.push({
    status: "PASS",
    name: "Update routing",
    detail: `Version checks try ${TENCENT_MIRROR_REGISTRY} first, then npm's configured registry. Installation uses ${registry ?? "the npm registry (could not determine its address)"}. Registry probes check public metadata without npm authentication.`,
  });
  const state = inspectJsonFile(path.join(options.home, ".deepcode/update-check.json"));
  if (state.value) {
    const pending = state.value.pending;
    if (
      pending &&
      typeof pending === "object" &&
      !Array.isArray(pending) &&
      typeof (pending as Record<string, unknown>).latestVersion === "string"
    ) {
      const version = (pending as Record<string, unknown>).latestVersion;
      checks.push({
        status: /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(String(version)) ? "PASS" : "WARN",
        name: "Pending update",
        detail: /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(String(version))
          ? `Version ${version}.`
          : "Invalid cached version; check update-check.json.",
      });
    } else if (pending != null)
      checks.push({ status: "WARN", name: "Update state", detail: "Invalid pending update in update-check.json." });
    const ignored = state.value.ignoredVersions;
    if (Array.isArray(ignored) && ignored.length)
      checks.push({
        status: "WARN",
        name: "Ignored updates",
        detail: `Updates have been ignored in ${state.path}. Review ignoredVersions if update prompts are missing.`,
      });
    else if (ignored !== undefined && !Array.isArray(ignored))
      checks.push({
        status: "WARN",
        name: "Update state",
        detail: "ignoredVersions must be an array in update-check.json.",
      });
  }
  checks.push({
    status: "SKIP",
    name: "Previous update failure",
    detail: `Past install failures are not recorded by Deep Code. These checks describe current conditions.${cache ? ` If the failure persists, inspect the npm log in ${path.join(cache, "_logs")}.` : ""}`,
  });
  return checks;
}
