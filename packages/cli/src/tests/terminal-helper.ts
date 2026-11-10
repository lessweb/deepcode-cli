import type { TestContext } from "node:test";
import { PassThrough, Writable } from "node:stream";
import { setTimeout } from "node:timers/promises";
import { stripTerminalControls } from "./terminal-output";
import type React from "react";
import { render } from "ink";

export async function terminal(t: TestContext, element: React.ReactElement, columns = 80) {
  let frame = "";
  let rawFrame = "";
  const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode() {}, ref() {}, unref() {} });
  const stdout = Object.assign(
    new Writable({
      write(chunk, _encoding, done) {
        // Title updates are terminal controls, not rendered frames.
        const text = stripTerminalControls(chunk.toString().replace(/\u001b\][^\u0007]*\u0007/g, ""));
        if (text.trim()) {
          frame = text;
          rawFrame = chunk.toString();
        }
        done();
      },
    }),
    { isTTY: true, columns, rows: 40 }
  );
  const app = render(element, {
    stdin: stdin as unknown as NodeJS.ReadStream,
    stdout: stdout as unknown as NodeJS.WriteStream,
    stderr: stdout as unknown as NodeJS.WriteStream,
    debug: true,
    patchConsole: false,
    exitOnCtrlC: false,
  });
  t.after(() => {
    app.unmount();
    app.cleanup();
  });
  async function flush() {
    await setTimeout(35);
    await app.waitUntilRenderFlush();
  }
  await flush();
  return {
    frame: () => frame,
    rawFrame: () => rawFrame,
    rerender: app.rerender,
    waitUntilExit: app.waitUntilExit,
    async send(input: string) {
      stdin.write(input);
      await flush();
    },
  };
}
