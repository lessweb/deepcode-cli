import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { test } from "node:test";
import { setTimeout } from "node:timers/promises";
import { stripVTControlCharacters } from "node:util";
import React from "react";
import { render } from "ink";
import stringWidth from "string-width";
import { StatusLine } from "../ui/components/status-line";

test("model status stays on one physical line while the spinner updates and the terminal shrinks", async () => {
  const frames: string[] = [];
  const output = Object.assign(
    new Writable({
      write(chunk, _encoding, callback) {
        const frame = stripVTControlCharacters(chunk.toString()).trimEnd();
        if (frame) frames.push(frame);
        callback();
      },
    }),
    { columns: 120, rows: 24, isTTY: true }
  );
  const text = "status: processing · 81.1K/1M [▓░░░░░░░░░░░░░░░] 8% · deepseek-v4-flash max 中文👋";
  const app = render(React.createElement(StatusLine, { busy: true, text, width: output.columns }), {
    stdout: output as unknown as NodeJS.WriteStream,
    debug: true,
    patchConsole: false,
    exitOnCtrlC: false,
  });
  try {
    for (const width of [120, 79, 65, 40, 120]) {
      frames.length = 0;
      output.columns = width;
      output.emit("resize");
      app.rerender(React.createElement(StatusLine, { busy: true, text, width }));
      await app.waitUntilRenderFlush();
      // A resize can flush the previous props before React commits the new width.
      const resizedFrame = frames.at(-1);
      frames.length = 0;
      if (resizedFrame) frames.push(resizedFrame);
      await setTimeout(100);
      await app.waitUntilRenderFlush();
      assert.ok(frames.length > 0);
      for (const frame of frames) {
        assert.equal(frame.split("\n").length, 1, frame);
        assert.ok(stringWidth(frame) <= width, frame);
      }
    }
  } finally {
    app.unmount();
    app.cleanup();
  }
});
