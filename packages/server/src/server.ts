#!/usr/bin/env node
import * as path from "node:path";
import { createRequire } from "node:module";
import { setShellIfWindows } from "@vegamo/deepcode-core";
import { runHeadlessHttp } from "./index";
import { readArgValue } from "./services/server-options";

const require = createRequire(import.meta.url);

type PackageInfo = {
  version?: unknown;
};

const args = process.argv.slice(2);
const version = readVersion();

if (args.includes("--version") || args.includes("-v")) {
  process.stdout.write(`${version}\n`);
  process.exit(0);
}

if (args.includes("--help") || args.includes("-h")) {
  process.stdout.write(buildHelpText());
  process.exit(0);
}

const projectRoot = path.resolve(readArgValue(args, "--project-root") ?? process.cwd());
configureWindowsShell();

try {
  await runHeadlessHttp({ args, projectRoot, version });
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

function buildHelpText(): string {
  return [
    "deepcode-server - Deep Code local HTTP/SSE runtime server",
    "",
    "Usage:",
    "  deepcode-server [--host <host>] [--port <port>] [--project-root <path>]",
    "  deepcode-server --version",
    "  deepcode-server --help",
    "",
    "Options:",
    "  --host <host>          Bind address. Defaults to 127.0.0.1.",
    "  --port <port>          Bind port. Defaults to 8787.",
    "  --project-root <path>  Deep Code project root. Defaults to current working directory.",
    "  --no-auth              Turn off local token auth for trusted local development.",
    "  --unsafe-bind          Allow non-local bind addresses.",
    "  --version, -v          Print the version.",
    "  --help, -h             Show this help.",
    "",
  ].join("\n");
}
