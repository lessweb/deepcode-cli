/**
 * `deepcode login` — interactively save your DeepSeek API key to
 * ~/.deepcode/settings.json, writing a ready-to-use default config.
 *
 * This is a plain command-line script (no Ink/TUI): it reads the key from a
 * hidden prompt, merges it with the existing user settings, and writes the
 * result back. Run before the TUI is started in `cli.tsx`.
 */

import * as os from "node:os";
import { createInterface } from "node:readline";
import {
  buildLoginSettings,
  readSettings,
  writeSettings,
  getUserSettingsPath,
  DEFAULT_MODEL,
  DEFAULT_BASE_URL,
} from "@vegamo/deepcode-core";
import { writeStdout, writeStdoutLine, writeStderrLine } from "../utils/stdio-helpers";

export interface LoginOptions {
  /** Non-interactive API key; skips the prompt entirely (for CI/scripts). */
  apiKey?: string;
  /** Echo the key as it is typed instead of masking each char with `*`. */
  show: boolean;
}

/** Render an absolute path with the home directory collapsed to `~`. */
function formatHomePath(filePath: string): string {
  const home = os.homedir();
  return filePath.startsWith(home) ? `~${filePath.slice(home.length)}` : filePath;
}

/** Toggle stdin raw mode, tolerating non-TTY streams where it is unavailable. */
function setStdinRawMode(mode: boolean): void {
  const stdin = process.stdin as NodeJS.ReadStream & {
    setRawMode?: (mode: boolean) => void;
  };
  stdin.setRawMode?.(mode);
}

/**
 * Read a single line from stdin with no echo, masking each typed character
 * with `*`. Handles Backspace, Ctrl+U (clear line) and Ctrl+C (cancel).
 * Falls back to a plain readline prompt when stdin is not a TTY (e.g. piped),
 * where echo is naturally absent.
 */
function readHiddenLine(prompt: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const stdout = process.stdout;

    if (!stdin.isTTY) {
      // Piped stdin: don't echo the prompt (there is no one to read it),
      // just consume one line.
      const rl = createInterface({ input: stdin });
      rl.question(prompt, (answer) => {
        rl.close();
        resolve(answer);
      });
      rl.on("SIGINT", () => {
        rl.close();
        resolve(undefined);
      });
      return;
    }

    stdout.write(prompt);
    setStdinRawMode(true);
    let value = "";

    const onData = (buffer: Buffer): void => {
      for (const byte of buffer) {
        // Ctrl+C → cancel
        if (byte === 0x03) {
          cleanup();
          stdout.write("\r\n");
          resolve(undefined);
          return;
        }
        // Enter → submit
        if (byte === 0x0d || byte === 0x0a) {
          cleanup();
          stdout.write("\r\n");
          resolve(value);
          return;
        }
        // Backspace / Ctrl+H
        if (byte === 0x7f || byte === 0x08) {
          if (value.length > 0) {
            value = value.slice(0, -1);
            stdout.write("\b \b");
          }
          continue;
        }
        // Ctrl+U → clear the whole line
        if (byte === 0x15) {
          while (value.length > 0) {
            value = value.slice(0, -1);
            stdout.write("\b \b");
          }
          continue;
        }
        // Printable ASCII
        if (byte >= 0x20 && byte <= 0x7e) {
          value += String.fromCharCode(byte);
          stdout.write("*");
        }
      }
    };

    const cleanup = (): void => {
      stdin.removeListener("data", onData);
      setStdinRawMode(false);
    };

    stdin.on("data", onData);
  });
}

/** Read a single line with normal echo (for `--show` or piped stdin). */
function readVisibleLine(prompt: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
    rl.on("SIGINT", () => {
      rl.close();
      resolve(undefined);
    });
  });
}

async function promptForApiKey(show: boolean): Promise<string | undefined> {
  writeStdoutLine("Deep Code — Login");
  writeStdoutLine(`Your API key is stored in ${formatHomePath(getUserSettingsPath())}`);
  return show ? readVisibleLine("API key: ") : readHiddenLine("API key (hidden): ");
}

export async function runLogin(opts: LoginOptions): Promise<void> {
  let apiKey = opts.apiKey?.trim();

  if (!apiKey) {
    const entered = await promptForApiKey(opts.show);
    apiKey = entered?.trim();
  }

  if (!apiKey) {
    writeStderrLine("Login cancelled: no API key provided.");
    process.exitCode = 1;
    return;
  }

  const existing = readSettings();
  const next = buildLoginSettings(existing, apiKey);
  writeSettings(next);

  writeStdoutLine(`✓ API key saved to ${formatHomePath(getUserSettingsPath())}`);
  writeStdoutLine(`  model: ${next.env?.MODEL ?? DEFAULT_MODEL}`);
  writeStdoutLine(`  base URL: ${next.env?.BASE_URL ?? DEFAULT_BASE_URL}`);
  writeStdoutLine(`  Run \`deepcode\` to start.`);
}

export function printLoginHelp(): void {
  const settingsPath = formatHomePath(getUserSettingsPath());
  writeStdout(`Usage: deepcode login [options]

Save your DeepSeek API key to ${settingsPath}.

Interactively prompts for the API key (hidden by default) and writes a
ready-to-use default config: model=deepseek-v4-pro, base URL=api.deepseek.com,
thinking enabled, reasoning effort=max. Existing custom fields are preserved.

Options:
  --api-key <key>   Provide the key non-interactively (no prompt, for CI/scripts)
  -k <key>          Alias for --api-key
  --show            Show the key as you type it instead of masking with *
  -h, --help        Show this help

Examples:
  deepcode login                    Prompt for the key (hidden)
  deepcode login --show             Prompt and show the key while typing
  deepcode login --api-key sk-xxx   Write the key without prompting
  echo sk-xxx | deepcode login      Pipe the key via stdin
`);
}
