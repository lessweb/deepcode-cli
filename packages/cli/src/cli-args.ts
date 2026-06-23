/**
 * CLI argument parsing helpers.
 * Extracted from cli.tsx for testability.
 */

export function extractInitialPrompt(args: string[]): string | undefined {
  const promptIndex = args.findIndex((arg) => arg === "-p" || arg === "--prompt");
  if (promptIndex !== -1 && promptIndex + 1 < args.length) {
    return args[promptIndex + 1];
  }
  return undefined;
}

/**
 * Extract the --resume flag value.
 *
 * Returns:
 *   - `undefined` — `--resume` was not used
 *   - `true`       — `--resume` was used without a session ID (show session picker)
 *   - `string`     — `--resume <sessionId>` was used (resume specific session)
 */
export function extractResumeSessionId(args: string[]): string | true | undefined {
  const idx = args.findIndex((arg) => arg === "--resume");
  if (idx === -1) {
    return undefined;
  }
  if (idx + 1 < args.length && !args[idx + 1].startsWith("-")) {
    return args[idx + 1];
  }
  return true;
}
