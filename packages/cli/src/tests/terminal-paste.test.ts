import assert from "node:assert/strict";
import { PassThrough, Writable } from "node:stream";
import { test, type TestContext } from "node:test";
import { setTimeout } from "node:timers/promises";
import React, { useState } from "react";
import { render, Text } from "ink";
import { EMPTY_BUFFER, expandPasteMarkers, insertText } from "../ui/core/prompt-buffer";
import { usePasteHandling } from "../ui/hooks/usePasteHandling";
import { useTerminalInput, type InputKey } from "../ui/hooks/useTerminalInput";

const PASTE_START = "\u001B[200~";
const PASTE_END = "\u001B[201~";

async function harness(t: TestContext) {
  const events: { input: string; key: InputKey }[] = [];
  const submissions: string[] = [];
  let text = "";

  function Probe({ active = true }: { active?: boolean }) {
    const [buffer, setBuffer] = useState(EMPTY_BUFFER);
    const { handlePaste, pastesRef } = usePasteHandling(buffer, setBuffer, () => {});
    text = buffer.text;
    useTerminalInput(
      (input, key) => {
        events.push({ input, key });
        if (key.paste) handlePaste(input);
        else if (key.return) submissions.push(expandPasteMarkers(buffer.text, pastesRef.current));
        else if (input && !key.ctrl && !key.meta) setBuffer((state) => insertText(state, input));
      },
      { isActive: active }
    );
    return React.createElement(Text, null, buffer.text || "ready");
  }

  const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode() {}, ref() {}, unref() {} });
  const stdout = Object.assign(
    new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    }),
    { isTTY: true, columns: 80, rows: 24 }
  );
  const app = render(React.createElement(Probe), {
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
    await setTimeout(0);
    await app.waitUntilRenderFlush();
  }
  await flush();
  return {
    events,
    submissions,
    text: () => text,
    send: (chunk: string | Buffer) => stdin.emit("data", chunk),
    flush,
    async setActive(active: boolean) {
      app.rerender(React.createElement(Probe, { active }));
      await flush();
    },
    unmount: () => app.unmount(),
  };
}

test("paste markers can split at every start/end boundary", async (t) => {
  const h = await harness(t);
  for (let start = 1; start < PASTE_START.length; start++) {
    for (let end = 1; end < PASTE_END.length; end++) {
      const payload = `payload-${start}-${end}\n你好`;
      h.events.length = 0;
      h.send(PASTE_START.slice(0, start));
      h.send(PASTE_START.slice(start) + payload + PASTE_END.slice(0, end));
      h.send(PASTE_END.slice(end));
      h.send("x");
      h.send("\r");
      assert.equal(h.events.length, 3, `start=${start}, end=${end}`);
      assert.equal(h.events[0]?.input, payload);
      assert.equal(h.events[0]?.key.paste, true);
      assert.equal(h.events[1]?.input, "x");
      assert.equal(h.events[2]?.key.return, true);
    }
  }
});

test("a 1014-byte payload split at 1024 bytes collapses and remains editable and submittable", async (t) => {
  const h = await harness(t);
  const payload = JSON.stringify({ ciphertext: "a".repeat(997) });
  assert.equal(Buffer.byteLength(payload), 1014);
  const packet = Buffer.from(PASTE_START + payload + PASTE_END);
  h.send(packet.subarray(0, 1024));
  assert.equal(h.events.length, 0);
  h.send(packet.subarray(1024));
  await h.flush();
  assert.equal(h.text(), "[paste #1 1014 chars]");
  h.send("x");
  await h.flush();
  h.send("\r");
  assert.deepEqual(h.submissions, [payload + "x"]);
});

test("one-character chunks preserve pasted control characters and marker-like content", async (t) => {
  const h = await harness(t);
  const payload = `abc\r\n\t\u007F\u0003${PASTE_START}literal\u001B[20x201~`;
  for (const char of PASTE_START + payload + PASTE_END) h.send(char);
  assert.equal(h.events.length, 1);
  assert.equal(h.events[0]?.input, payload);
  assert.equal(h.events[0]?.key.paste, true);
});

test("coalesced input preserves text before a paste, consecutive pastes, and trailing Enter", async (t) => {
  const h = await harness(t);
  h.send(`before${PASTE_START}first${PASTE_END}${PASTE_START}${PASTE_END}${PASTE_START}second${PASTE_END}\r`);
  assert.deepEqual(
    h.events.map(({ input }) => input),
    ["before", "first", "second", "\r"]
  );
  assert.equal(h.events[1]?.key.paste, true);
  assert.equal(h.events[2]?.key.paste, true);
  assert.equal(h.events[3]?.key.return, true);
});

test("a delayed paste end stays buffered while standalone Esc remains responsive", async (t) => {
  const h = await harness(t);
  h.send(PASTE_START + "abc" + PASTE_END.slice(0, 4));
  await setTimeout(50);
  assert.equal(h.events.length, 0);
  h.send(PASTE_END.slice(4));
  assert.equal(h.events[0]?.input, "abc");
  h.send("\u001B");
  await setTimeout(50);
  assert.equal(h.events.length, 2);
  assert.equal(h.events[1]?.key.escape, true);
  h.send("\u001B[A");
  h.send("\u001Bb");
  assert.equal(h.events[2]?.key.upArrow, true);
  assert.equal(h.events[3]?.key.leftArrow, true);
  assert.equal(h.events[3]?.key.meta, true);
});

test("deactivating input discards an unfinished paste and cancels pending Esc", async (t) => {
  const h = await harness(t);
  h.send(PASTE_START + "unfinished");
  await h.setActive(false);
  await h.setActive(true);
  h.send("x");
  assert.equal(h.events[0]?.input, "x");
  h.events.length = 0;
  h.send("\u001B");
  await h.setActive(false);
  await setTimeout(50);
  assert.equal(h.events.length, 0);
});

test("unmounting input cancels pending Esc", async (t) => {
  const h = await harness(t);
  h.send("\u001B");
  h.unmount();
  await setTimeout(50);
  assert.equal(h.events.length, 0);
});
