#!/usr/bin/env node
import { createRequire } from "node:module";
import { setShellIfWindows } from "@vegamo/deepcode-core";
import { runHeadlessHttp } from "./index";

const require = createRequire(import.meta.url);

type PackageInfo = {
  version?: unknown;
};

const args = process.argv.slice(2);
const projectRoot = process.cwd();
configureWindowsShell();

try {
  await runHeadlessHttp({
    args,
    projectRoot,
    version: readVersion(),
  });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`deepcode server failed: ${message}\n`);
  process.exit(1);
}

function configureWindowsShell(): void {
  process.env.NoDefaultCurrentDirectoryInExePath = "1";
  try {
    setShellIfWindows();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`deepcode server: ${message}\n`);
    process.exit(1);
  }
}

function readVersion(): string {
  try {
    const pkg = require("../package.json") as PackageInfo;
    return typeof pkg.version === "string" ? pkg.version : "unknown";
  } catch {
    return "unknown";
  }
}
