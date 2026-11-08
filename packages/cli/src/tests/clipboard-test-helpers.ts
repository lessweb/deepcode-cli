import { PassThrough } from "node:stream";
import type { TestContext } from "node:test";

export function isolateSshEnvironment(t: TestContext): void {
  const original = process.env;
  process.env = { ...original };
  delete process.env.SSH_CONNECTION;
  delete process.env.SSH_CLIENT;
  delete process.env.SSH_TTY;
  t.after(() => {
    process.env = original;
  });
}

export function mockClipboardTerminal(t: TestContext, isTTY = true) {
  const output = Object.assign(new PassThrough(), { isTTY, columns: 100, rows: 30 });
  const writes: string[] = [];
  output.on("data", (chunk: Buffer) => writes.push(chunk.toString("utf8")));
  t.mock.getter(process, "stdout", () => output as unknown as NodeJS.WriteStream);
  return { output, writes };
}
