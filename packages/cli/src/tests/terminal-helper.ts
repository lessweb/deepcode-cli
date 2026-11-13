import type { TestContext } from "node:test";
import { PassThrough, Writable } from "node:stream";
import { setTimeout } from "node:timers/promises";
import { stripTerminalControls } from "./terminal-output";
import type React from "react";
import { render } from "ink";
import xterm from "@xterm/headless";

export async function terminal(
  t: TestContext,
  element: React.ReactElement,
  columns = 80,
  options?: { rows: number; incrementalRendering?: boolean }
) {
  const screen = options
    ? new xterm.Terminal({ cols: columns, rows: options.rows, allowProposedApi: true, convertEol: true })
    : null;
  let frame = "";
  let rawFrame = "";
  let rawMode = false;
  const stdin = Object.assign(new PassThrough(), {
    isTTY: true,
    setRawMode(value: boolean) {
      rawMode = value;
    },
    ref() {},
    unref() {},
  });
  const stdout = Object.assign(
    new Writable({
      write(chunk, _encoding, done) {
        screen?.write(chunk.toString());
        // Title updates are terminal controls, not rendered frames.
        const text = stripTerminalControls(chunk.toString().replace(/\u001b\][^\u0007]*\u0007/g, ""));
        if (text.trim()) {
          frame = text;
          rawFrame = chunk.toString();
        }
        done();
      },
    }),
    { isTTY: true, columns, rows: options?.rows ?? 40 }
  );
  const app = render(element, {
    stdin: stdin as unknown as NodeJS.ReadStream,
    stdout: stdout as unknown as NodeJS.WriteStream,
    stderr: stdout as unknown as NodeJS.WriteStream,
    debug: !screen,
    interactive: true,
    incrementalRendering: options?.incrementalRendering,
    patchConsole: false,
    exitOnCtrlC: false,
  });
  t.after(() => {
    app.unmount();
    app.cleanup();
    screen?.dispose();
  });
  async function flush() {
    await setTimeout(35);
    await app.waitUntilRenderFlush();
    if (screen) await new Promise<void>((resolve) => screen.write("", resolve));
  }
  await flush();
  return {
    frame: () => frame,
    rawFrame: () => rawFrame,
    rawMode: () => rawMode,
    screen,
    rerender: app.rerender,
    waitUntilExit: app.waitUntilExit,
    async send(input: string) {
      stdin.write(input);
      await flush();
    },
  };
}
