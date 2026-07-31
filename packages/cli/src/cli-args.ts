/**
 * CLI argument parsing helpers.
 * Uses yargs for robust argument parsing and validation.
 */

import type { Argv } from "yargs";
import Yargs from "yargs";
import { getCliVersion } from "./utils/version";
import { writeStderrLine } from "./utils/stdio-helpers";
import { hideBin } from "yargs/helpers";

// UUID v4 regex pattern for validation
const SESSION_ID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Validates if a string is a valid session ID format.
 */
export function isValidSessionId(value: string): boolean {
  return SESSION_ID_REGEX.test(value);
}

export interface ParsedCliArgs {
  /** Prompt text from -p / --prompt */
  prompt: string | undefined;
  /** Run one prompt without starting the interactive TUI. */
  exec: boolean;
  /**
   * Resume session identifier:
   *   - `undefined` — --resume was not used
   *   - `true`       — --resume was used without a session ID (show picker)
   *   - `string`     — --resume <sessionId> was used
   */
  resume: string | true | undefined;
  /** Fork source session. Bare --fork selects the most recent project session. */
  fork: string | true | undefined;
  /** True when --version / -v was passed */
  version: boolean;
  /** True when --help / -h was passed */
  help: boolean;
  /** True when --last / -l was passed (resume the most recent session for the current project) */
  last: boolean;
}

const EPILOG = [
  "Configuration:",
  "  ~/.deepcode/settings.json    User-level API key, model, base URL",
  "  ./.deepcode/settings.json    Project-level settings",
  "  ./.deepcode/skills/*/SKILL.md Project-level native skills",
  "  ./.agents/skills/*/SKILL.md   Project-level interoperable skills",
  "  ~/.deepcode/skills/*/SKILL.md User-level native skills",
  "  ~/.agents/skills/*/SKILL.md   User-level interoperable skills",
  "",
  "Inside the TUI:",
  "  enter            Send the prompt",
  "  shift+enter      Insert a newline",
  "  shift+tab        Cycle Plan Mode for the next submitted prompt",
  "  home/end         Move within the current line",
  "  alt+left/right   Move by word",
  "  ctrl+w           Delete the previous word",
  "  ctrl+v           Paste an image from the clipboard",
  "  ctrl+x           Clear pasted images",
  "  esc              Interrupt the current model turn",
  "  /                Open the skills/commands menu",
  "  /skills          List available skills",
  "  /model           Select model, thinking mode and effort control",
  "  /plan            Switch the input to Plan Mode",
  "  /new             Start a fresh conversation",
  "  /init            Initialize an AGENTS.md file with instructions for LLM",
  "  /resume          Pick a previous conversation to continue",
  "  /fork            Fork the current conversation",
  "  /continue        Continue the active conversation, or resume one if empty",
  "  /undo            Restore code and/or conversation to a previous point",
  "  /mcp             Show MCP server status and available tools",
  "  /raw             Toggle display mode for viewing or collapsing reasoning content",
  "  /exit            Quit",
  "  ctrl+d twice     Quit",
].join("\n");

async function configureYargs(argv?: string[]) {
  const rawArgv = argv ?? hideBin(process.argv);
  const yargsInstance = Yargs(rawArgv)
    .locale("en")
    .scriptName("deepcode")
    .usage("Usage: $0 [options] [command]\n\nDeep Code - Launch the interactive CLI or run one prompt with --exec")
    .command("$0 [query..]", "Launch Deep Code CLI", (yargsInstance: Argv) =>
      yargsInstance
        .option("prompt", {
          alias: "p",
          type: "string",
          describe: "Submit a prompt on launch",
        })
        .option("exec", {
          alias: "x",
          type: "boolean",
          default: false,
          describe: "Run one prompt non-interactively (requires --prompt)",
        })
        .option("resume", {
          alias: "r",
          type: "string",
          describe: "Resume a specific session by its ID. Use without an ID to show session picker.",
        })
        .option("fork", {
          alias: "f",
          type: "string",
          describe: "Fork a specific session by its ID. Use without an ID to fork the most recent session.",
        })
        .option("last", {
          alias: "l",
          type: "boolean",
          default: false,
          describe: "Resume the most recent session for the current project directory.",
        })
        .check((argv: { [x: string]: unknown }) => {
          const query = argv["query"] as string | string[] | undefined;
          const hasPositionalQuery = Array.isArray(query) ? query.length > 0 : !!query;
          const prompt = argv["prompt"] as string | undefined;
          const exec = argv["exec"] === true;

          if (prompt && hasPositionalQuery) {
            return "Cannot use both a positional prompt and the --prompt (-p) flag together";
          }
          // bare --resume conflicts with --prompt
          if (argv["resume"] === "" && prompt) {
            return "Cannot use --resume without a session ID together with --prompt.\nUse --resume <sessionId> -p <prompt> to resume a session and send a prompt.";
          }
          // --last conflicts with --resume
          if (argv["last"] === true && argv["resume"] !== undefined) {
            return "Cannot use --last together with --resume. Use --last to resume the most recent session, or --resume <sessionId> for a specific session.";
          }
          if (argv["fork"] !== undefined && argv["resume"] !== undefined) {
            return "Cannot use --fork together with --resume.";
          }
          if (argv["last"] === true && argv["fork"] !== undefined) {
            return "Cannot use --last together with --fork.";
          }
          // validate --resume <sessionId> format if provided
          if (argv["resume"] && argv["resume"] !== "" && !isValidSessionId(argv["resume"] as string)) {
            return `Invalid session ID: "${argv["resume"]}". Must be a valid UUID (e.g., "123e4567-e89b-12d3-a456-426614174000").`;
          }
          if (argv["fork"] && argv["fork"] !== "" && !isValidSessionId(argv["fork"] as string)) {
            return `Invalid session ID: "${argv["fork"]}". Must be a valid UUID (e.g., "123e4567-e89b-12d3-a456-426614174000").`;
          }
          // empty prompt is meaningless
          if (prompt !== undefined && prompt.trim() === "") {
            return "--prompt / -p requires a non-empty value.";
          }
          if (exec && (prompt === undefined || prompt.trim() === "")) {
            return "--exec / -x requires a non-empty --prompt / -p value.";
          }
          if (exec && argv["resume"] === "") {
            return "--exec cannot use --resume without a session ID.\nUse --exec --resume <sessionId> --prompt <prompt>.";
          }
          return true;
        })
    )
    .example("deepcode", "Launch the interactive TUI in the current directory")
    .example("deepcode -p <prompt>", "Launch the TUI and submit a prompt")
    .example("deepcode -x -p <prompt>", "Run one prompt without launching the TUI")
    .example("deepcode -r, --resume [sessionId]", "Resume a session or show session picker")
    .example("deepcode -f, --fork [sessionId]", "Fork a session or the most recent session")
    .example('cat error.log | deepcode -x -p "Explain this error"', "Use piped stdin as additional context")
    .epilog(EPILOG)
    .strict()
    .demandCommand(0, 0)
    .wrap(Math.min(process.stdout.columns || 80, 120));
  yargsInstance
    .version(await getCliVersion())
    .alias("v", "version")
    .help()
    .alias("h", "help");
  yargsInstance.wrap(yargsInstance.terminalWidth());
  return yargsInstance;
}

/**
 * Parse CLI arguments with validation.
 *
 * On validation failure the `.fail()` handler prints the error, shows help,
 * and calls `process.exit(1)`, so this function always either returns a
 * valid `ParsedCliArgs` or terminates the process.
 */
export async function parseArguments(argv?: string[]): Promise<ParsedCliArgs> {
  const y = (await configureYargs(argv)).exitProcess(false).fail((msg, _err, yargs) => {
    writeStderrLine(msg || _err?.message || "Unknown error");
    yargs.showHelp();
    process.exit(1);
  });

  const parsed = y.parseSync() as Record<string, unknown>;

  const resumeRaw = parsed.resume as string | undefined;
  let resume: ParsedCliArgs["resume"];
  if (resumeRaw === undefined) {
    resume = undefined;
  } else if (resumeRaw === "") {
    resume = true;
  } else {
    resume = resumeRaw;
  }

  const forkRaw = parsed.fork as string | undefined;
  let fork: ParsedCliArgs["fork"];
  if (forkRaw === undefined) {
    fork = undefined;
  } else if (forkRaw === "") {
    fork = true;
  } else {
    fork = forkRaw;
  }

  return {
    prompt: parsed.prompt as string | undefined,
    exec: parsed.exec === true,
    resume,
    fork,
    version: parsed.version === true,
    help: parsed.help === true,
    last: parsed.last === true,
  };
}
