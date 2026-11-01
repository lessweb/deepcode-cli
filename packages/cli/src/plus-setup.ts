import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { checkPlusSubscription, normalizePlusApiKey, writeDeepcodePlusApiKey } from "@vegamo/deepcode-core";

type SetupInput = Readable & { isTTY?: boolean };

export function promptPlusApiKey(
  input: SetupInput,
  output: Writable,
  signal: AbortSignal
): Promise<string | undefined> {
  if (signal.aborted) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const readline = createInterface({ input, output, terminal: input.isTTY === true });
    const cancel = () => readline.close();
    signal.addEventListener("abort", cancel, { once: true });
    readline.on("SIGINT", cancel);
    readline.once("close", () => {
      signal.removeEventListener("abort", cancel);
      resolve(undefined);
    });
    readline.question("DeepCode Plus API Key: ", (answer) => {
      resolve(answer);
      readline.close();
    });
  });
}

export async function runPlusSetup(
  dependencies: {
    input?: SetupInput;
    output?: Writable;
    errorOutput?: Writable;
    checkSubscription?: typeof checkPlusSubscription;
    saveKey?: (apiKey: string) => void;
  } = {}
): Promise<number> {
  const input = dependencies.input ?? process.stdin;
  const output = dependencies.output ?? process.stdout;
  const errorOutput = dependencies.errorOutput ?? process.stderr;
  const fail = (message: string) => errorOutput.write(`${message}\n`);
  if (!input.isTTY) {
    fail("deepcode --plus requires an interactive terminal (TTY).");
    return 1;
  }

  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.on("SIGINT", cancel);
  try {
    const answer = await promptPlusApiKey(input, output, controller.signal);
    if (answer === undefined || controller.signal.aborted) return 130;
    let key: string;
    try {
      key = normalizePlusApiKey(answer)!;
    } catch {
      fail("Invalid API Key format.");
      return 1;
    }

    const status = await (dependencies.checkSubscription ?? checkPlusSubscription)(key, controller.signal);
    if (controller.signal.aborted) return 130;
    if (status !== "full ability") {
      fail(
        status === "api only"
          ? "This API Key cannot use DeepCode Plus."
          : "Unable to verify the API Key. Please try again later."
      );
      return 1;
    }
    try {
      (dependencies.saveKey ?? writeDeepcodePlusApiKey)(key);
    } catch {
      fail("Unable to save the API Key. Check ~/.deepcode-plus/settings.json and its permissions.");
      return 1;
    }
    output.write("DeepCode Plus API Key saved.\n");
    return 0;
  } catch {
    if (controller.signal.aborted) return 130;
    fail("Unable to verify the API Key. Please try again later.");
    return 1;
  } finally {
    process.removeListener("SIGINT", cancel);
  }
}
