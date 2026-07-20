/**
 * Server option parsing helpers.
 *
 * Summary:
 * Parses argument arrays accepted by the standalone local server package and
 * preserves the local-only default binding policy.
 *
 * Exports:
 * - parseServerOptions(args: string[]): ParsedServerOptions
 * - readArgValue(args: string[], name: string): string | undefined
 * - type ParsedServerOptions
 */
export type ParsedServerOptions = {
  host: string;
  port: number;
  authDisabled: boolean;
};

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8787;

export function parseServerOptions(args: string[]): ParsedServerOptions {
  const host = readArgValue(args, "--host") ?? DEFAULT_HOST;
  const rawPort = readArgValue(args, "--port") ?? String(DEFAULT_PORT);
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid --port value: ${rawPort}`);
  }
  if ((host === "0.0.0.0" || host === "::") && !args.includes("--unsafe-bind")) {
    throw new Error("Binding outside localhost requires --unsafe-bind.");
  }
  return { host, port, authDisabled: args.includes("--no-auth") };
}

export function readArgValue(args: string[], name: string): string | undefined {
  const prefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length);
  }
  const index = args.indexOf(name);
  return index !== -1 && index + 1 < args.length ? args[index + 1] : undefined;
}
