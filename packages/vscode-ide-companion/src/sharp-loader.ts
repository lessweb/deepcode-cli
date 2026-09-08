import { execFileSync, spawn } from "node:child_process";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import { TENCENT_MIRROR_REGISTRY, type SharpLoader } from "@vegamo/deepcode-core";
import type sharp from "sharp";

type SharpModule = typeof sharp;

export type SharpLoaderOptions = {
  workspaceRoot: string;
  storageRoot: string;
  sharpVersion: string;
  notifyInstalling: <T>(task: (report: SharpInstallProgressReporter) => Promise<T>) => Promise<T>;
};

export type SharpInstallProgress = {
  percent: number;
  message: string;
};

type SharpInstallProgressReporter = (progress: SharpInstallProgress) => void;

type SharpLoaderDependencies = {
  findCliAnchors: (workspaceRoot: string) => string[];
  loadSharpFromAnchor: (anchor: string) => SharpModule | null;
  installSharp: (installRoot: string, version: string, report: SharpInstallProgressReporter) => Promise<void>;
};

export function createSharpLoader(
  options: SharpLoaderOptions,
  overrides: Partial<SharpLoaderDependencies> = {}
): SharpLoader {
  const dependencies: SharpLoaderDependencies = {
    findCliAnchors,
    loadSharpFromAnchor,
    installSharp,
    ...overrides,
  };
  const installRoot = path.join(options.storageRoot, "sharp", options.sharpVersion);
  const cacheAnchor = path.join(installRoot, "node_modules", "sharp", "package.json");
  let pending: ReturnType<SharpLoader> | undefined;

  return () => {
    if (!pending) {
      pending = loadSharp().catch((error) => {
        pending = undefined;
        throw error;
      });
    }
    return pending;
  };

  async function loadSharp(): ReturnType<SharpLoader> {
    for (const anchor of [...dependencies.findCliAnchors(options.workspaceRoot), cacheAnchor]) {
      const sharp = dependencies.loadSharpFromAnchor(anchor);
      if (sharp) {
        return sharp;
      }
    }

    return options.notifyInstalling(async (report) => {
      report({ percent: 10, message: "Preparing installation..." });
      await dependencies.installSharp(installRoot, options.sharpVersion, report);
      report({ percent: 95, message: "Verifying installation..." });
      const installed = dependencies.loadSharpFromAnchor(cacheAnchor);
      if (!installed) {
        throw new Error("Sharp was installed but could not be loaded.");
      }
      report({ percent: 100, message: "Installation complete." });
      return installed;
    });
  }
}

function findCliAnchors(workspaceRoot: string): string[] {
  const anchors = [path.join(workspaceRoot, "node_modules", "@vegamo", "deepcode-cli", "package.json")];
  const executableNames =
    process.platform === "win32" ? ["deepcode.cmd", "deepcode.exe", "deepcode.bat"] : ["deepcode"];
  for (const directory of (process.env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    for (const executableName of executableNames) {
      const executable = path.join(directory, executableName);
      if (!fs.existsSync(executable)) {
        continue;
      }
      try {
        anchors.push(fs.realpathSync(executable));
      } catch {
        anchors.push(executable);
      }
      if (process.platform === "win32") {
        anchors.push(path.join(directory, "node_modules", "@vegamo", "deepcode-cli", "package.json"));
      }
    }
  }

  try {
    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    const globalRoot = execFileSync(npm, ["root", "-g"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5_000,
      windowsHide: true,
    }).trim();
    if (globalRoot) {
      anchors.push(path.join(globalRoot, "@vegamo", "deepcode-cli", "package.json"));
    }
  } catch {
    // npm is optional when an existing CLI or cache supplies Sharp.
  }

  return [...new Set(anchors)];
}

function loadSharpFromAnchor(anchor: string): SharpModule | null {
  if (!fs.existsSync(anchor)) {
    return null;
  }
  try {
    const require = createRequire(anchor);
    const loaded = require(require.resolve("sharp")) as SharpModule | { default?: SharpModule };
    const sharp = typeof loaded === "function" ? loaded : loaded.default;
    return typeof sharp === "function" ? sharp : null;
  } catch {
    return null;
  }
}

export function buildSharpInstallArgs(installRoot: string, version: string): string[] {
  return [
    "install",
    "--no-save",
    "--no-package-lock",
    "--omit=dev",
    "--loglevel=http",
    "--registry",
    TENCENT_MIRROR_REGISTRY,
    "--prefix",
    installRoot,
    `sharp@${version}`,
  ];
}

async function installSharp(installRoot: string, version: string, report: SharpInstallProgressReporter): Promise<void> {
  fs.mkdirSync(installRoot, { recursive: true });
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  report({ percent: 20, message: "Downloading from npm mirror..." });

  await new Promise<void>((resolve, reject) => {
    const child = spawn(npm, buildSharpInstallArgs(installRoot, version), {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let percent = 20;
    let errorOutput = "";
    const reportActivity = (): void => {
      percent = Math.min(90, percent + 5);
      report({ percent, message: "Downloading and installing packages..." });
    };
    child.stdout.on("data", reportActivity);
    child.stderr.on("data", (chunk: Buffer) => {
      reportActivity();
      if (errorOutput.length < 8_192) {
        errorOutput += chunk.toString("utf8").slice(0, 8_192 - errorOutput.length);
      }
    });
    child.on("error", (error) => reject(new Error(`Failed to start npm: ${error.message}`, { cause: error })));
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      const detail = errorOutput.trim();
      reject(new Error(`npm install exited with code ${code ?? "unknown"}${detail ? `: ${detail}` : "."}`));
    });
  });
}
