import { spawn } from "child_process";
import React from "react";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { render, type Instance } from "ink";
import chalk from "chalk";
import { UpdatePrompt, type UpdatePromptChoice } from "./ui/UpdatePrompt";

export type PackageInfo = {
  name: string;
  version: string;
};

type UpdateState = {
  pending?: {
    currentVersion: string;
    latestVersion: string;
    packageName: string;
    checkedAt: string;
  } | null;
  ignoredVersions?: string[];
};

const UPDATE_STATE_FILE = "update-check.json";
const NPM_VIEW_TIMEOUT_MS = 5000;
const MAX_NPM_VIEW_OUTPUT_CHARS = 64 * 1024;
const TENCENT_MIRROR_REGISTRY = "https://mirrors.cloud.tencent.com/npm/";

export async function promptForPendingUpdate(packageInfo: PackageInfo): Promise<{ installed: boolean }> {
  const state = readUpdateState();
  const pending = state.pending;
  if (!pending) {
    return { installed: false };
  }

  if (compareVersions(packageInfo.version, pending.latestVersion) >= 0) {
    writeUpdateState({ ...state, pending: null });
    return { installed: false };
  }

  if (state.ignoredVersions?.includes(pending.latestVersion)) {
    writeUpdateState({ ...state, pending: null });
    return { installed: false };
  }

  const installSpec = `${pending.packageName}@${pending.latestVersion}`;
  const installCommand = `npm install -g ${installSpec}`;
  const choice = await promptUpdateChoice({
    currentVersion: packageInfo.version,
    latestVersion: pending.latestVersion,
    installCommand
  });

  if (choice === "install") {
    const ok = await runNpmInstallGlobal(installSpec);
    if (ok) {
      writeUpdateState({ ...state, pending: null });
      process.stdout.write(`\n${chalk.red("Deep Code has been updated. Please restart the CLI to use the new version.")}\n\n`);
    }
    return { installed: ok };
  }

  if (choice === "ignore-version") {
    const ignoredVersions = Array.from(new Set([...(state.ignoredVersions ?? []), pending.latestVersion]));
    writeUpdateState({ ...state, pending: null, ignoredVersions });
    return { installed: false };
  }

  writeUpdateState({ ...state, pending: null });
  return { installed: false };
}

export async function checkForNpmUpdate(packageInfo: PackageInfo): Promise<void> {
  if (!packageInfo.name || !packageInfo.version) {
    return;
  }

  try {
    const latestVersion = await fetchLatestNpmVersion(packageInfo.name);
    if (!latestVersion || compareVersions(latestVersion, packageInfo.version) <= 0) {
      clearPendingUpdate();
      return;
    }

    const state = readUpdateState();
    if (state.ignoredVersions?.includes(latestVersion)) {
      clearPendingUpdate(state);
      return;
    }

    writeUpdateState({
      ...state,
      pending: {
        currentVersion: packageInfo.version,
        latestVersion,
        packageName: packageInfo.name,
        checkedAt: new Date().toISOString()
      }
    });
  } catch {
    // Update checks must never affect CLI startup or normal operation.
  }
}

export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  const width = Math.max(left.length, right.length);
  for (let index = 0; index < width; index += 1) {
    const leftPart = left[index] ?? 0;
    const rightPart = right[index] ?? 0;
    if (leftPart > rightPart) {
      return 1;
    }
    if (leftPart < rightPart) {
      return -1;
    }
  }
  return 0;
}

export function getUpdateStatePath(): string {
  return path.join(os.homedir(), ".deepcode", UPDATE_STATE_FILE);
}

async function promptUpdateChoice({
  currentVersion,
  latestVersion,
  installCommand
}: {
  currentVersion: string;
  latestVersion: string;
  installCommand: string;
}): Promise<"install" | "ignore-once" | "ignore-version"> {
  return new Promise<UpdatePromptChoice>((resolve) => {
    let selected = false;
    let instance: Instance | null = null;
    const handleSelect = (choice: UpdatePromptChoice): void => {
      if (selected) {
        return;
      }
      selected = true;
      resolve(choice);
      instance?.unmount();
    };

    instance = render(
      React.createElement(UpdatePrompt, {
        currentVersion,
        latestVersion,
        installCommand,
        onSelect: handleSelect
      }),
      { exitOnCtrlC: false }
    );
  });
}

async function runNpmInstallGlobal(installSpec: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("npm", ["install", "-g", installSpec], {
      stdio: "inherit",
      shell: process.platform === "win32"
    });
    child.on("error", (error) => {
      process.stderr.write(`Failed to start npm install: ${error.message}\n`);
      resolve(false);
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve(true);
        return;
      }
      process.stderr.write(`npm install exited with code ${code ?? "unknown"}.\n`);
      resolve(false);
    });
  });
}

async function fetchLatestNpmVersion(packageName: string): Promise<string | null> {
  // Try Tencent mirror first for faster access in mainland China.
  const mirrorResult = await runNpmViewLatestVersion(packageName, TENCENT_MIRROR_REGISTRY, NPM_VIEW_TIMEOUT_MS);
  if (mirrorResult.ok) {
    return parseNpmViewVersion(mirrorResult.stdout);
  }

  // Fall back to the official npm registry.
  const result = await runNpmViewLatestVersion(packageName, undefined, NPM_VIEW_TIMEOUT_MS);
  if (!result.ok) {
    return null;
  }
  return parseNpmViewVersion(result.stdout);
}

function runNpmViewLatestVersion(
  packageName: string,
  registry: string | undefined,
  timeoutMs: number
): Promise<{ ok: true; stdout: string } | { ok: false }> {
  return new Promise((resolve) => {
    const args = ["view", packageName, "dist-tags.latest", "--json"];
    if (registry) {
      args.push("--registry", registry);
    }
    const child = spawn("npm", args, {
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32"
    });

    let stdout = "";
    let settled = false;
    const finish = (result: { ok: true; stdout: string } | { ok: false }): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      child.kill();
      finish({ ok: false });
    }, timeoutMs);

    child.stdout?.on("data", (chunk: string | Buffer) => {
      if (stdout.length >= MAX_NPM_VIEW_OUTPUT_CHARS) {
        return;
      }
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      stdout += text.slice(0, MAX_NPM_VIEW_OUTPUT_CHARS - stdout.length);
    });

    child.on("error", () => finish({ ok: false }));
    child.on("close", (code) => {
      finish(code === 0 ? { ok: true, stdout } : { ok: false });
    });
  });
}

export function parseNpmViewVersion(output: string): string | null {
  const trimmed = output.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return typeof parsed === "string" && parsed.trim() ? parsed.trim() : null;
  } catch {
    return trimmed.split(/\r?\n/)[0]?.trim() || null;
  }
}

function readUpdateState(): UpdateState {
  const statePath = getUpdateStatePath();
  if (!fs.existsSync(statePath)) {
    return {};
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, "utf8")) as UpdateState;
    return {
      pending: parsed.pending ?? null,
      ignoredVersions: Array.isArray(parsed.ignoredVersions)
        ? parsed.ignoredVersions.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        : []
    };
  } catch {
    return {};
  }
}

function writeUpdateState(state: UpdateState): void {
  const statePath = getUpdateStatePath();
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function clearPendingUpdate(state = readUpdateState()): void {
  if (!state.pending) {
    return;
  }
  writeUpdateState({ ...state, pending: null });
}

function parseVersion(value: string): number[] {
  return value
    .split("-", 1)[0]
    .split(".")
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0));
}
