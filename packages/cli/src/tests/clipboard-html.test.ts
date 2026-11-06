import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { test, type TestContext } from "node:test";
import { readClipboardHtmlAsync } from "../ui/core/clipboard";

function mockReader(t: TestContext, platform: NodeJS.Platform, outputs: (string | Error)[]) {
  const descriptor = Object.getOwnPropertyDescriptor(process, "platform")!;
  Object.defineProperty(process, "platform", { value: platform });
  const calls: { command: string; args: string[]; options: childProcess.ExecFileOptions }[] = [];
  t.mock.method(
    childProcess,
    "execFile",
    (
      command: string,
      args: string[],
      options: childProcess.ExecFileOptions,
      callback: (error: Error | null, stdout: string) => void
    ) => {
      const output = outputs[calls.length] ?? new Error("missing helper");
      calls.push({ command, args, options });
      queueMicrotask(() => callback(output instanceof Error ? output : null, typeof output === "string" ? output : ""));
    }
  );
  syncBuiltinESMExports();
  t.after(() => {
    Object.defineProperty(process, "platform", descriptor);
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  return calls;
}

const HTML = '<p>中文 😀 <a href="https://example.com">链接</a></p>';

test("macOS explicitly reads public.html via AppKit", async (t) => {
  const calls = mockReader(t, "darwin", [HTML]);
  assert.equal(await readClipboardHtmlAsync(), HTML);
  assert.equal(calls[0].command, "osascript");
  assert.deepEqual(calls[0].args.slice(0, 3), ["-l", "JavaScript", "-e"]);
  assert.match(calls[0].args[3], /NSPasteboard\.generalPasteboard\.stringForType\("public.html"\)/);
});

test("Windows extracts the selected fragment using UTF-8 byte offsets", async (t) => {
  const template =
    "Version:1.0\r\nStartHTML:0000000000\r\nEndHTML:0000000000\r\nStartFragment:0000000000\r\nEndFragment:0000000000\r\n";
  const prefix = "<html><body>未选中的中文<!--StartFragment-->";
  const suffix = "<!--EndFragment-->未选中的尾部</body></html>";
  const startHTML = Buffer.byteLength(template);
  const startFragment = startHTML + Buffer.byteLength(prefix);
  const endFragment = startFragment + Buffer.byteLength(HTML);
  const header = template
    .replace(/StartHTML:\d+/, `StartHTML:${String(startHTML).padStart(10, "0")}`)
    .replace(/EndHTML:\d+/, `EndHTML:${String(endFragment + Buffer.byteLength(suffix)).padStart(10, "0")}`)
    .replace(/StartFragment:\d+/, `StartFragment:${String(startFragment).padStart(10, "0")}`)
    .replace(/EndFragment:\d+/, `EndFragment:${String(endFragment).padStart(10, "0")}`);
  const calls = mockReader(t, "win32", [header + prefix + HTML + suffix + "\0"]);
  assert.equal(await readClipboardHtmlAsync(), HTML);
  assert.equal(calls[0].command, "powershell");
  assert.ok(calls[0].args.includes("-STA"));
  assert.match(calls[0].args.at(-1)!, /UTF8Encoding/);
  assert.match(calls[0].args.at(-1)!, /TextDataFormat\]::Html/);
});

for (const [name, value, expected] of [
  [
    "offsets inside the header",
    `Version:1.0\r\nStartFragment:0\r\nEndFragment:11\r\n<!--StartFragment-->${HTML}<!--EndFragment-->`,
    HTML,
  ],
  ["missing offsets", `Version:1.0\r\n<html>before<!--StartFragment-->${HTML}<!--EndFragment-->after</html>`, HTML],
  [
    "invalid offsets",
    `Version:1.0\r\nStartFragment:9000\r\nEndFragment:9999\r\n<!--StartFragment-->${HTML}<!--EndFragment-->`,
    HTML,
  ],
  [
    "reversed offsets",
    `Version:1.0\r\nStartFragment:100\r\nEndFragment:20\r\n<!--StartFragment-->${HTML}<!--EndFragment-->`,
    HTML,
  ],
  [
    "HTML fallback",
    `Version:1.0\r\nStartHTML:-1\r\nEndHTML:-1\r\n<html><body>${HTML}</body></html>\0`,
    `<html><body>${HTML}</body></html>`,
  ],
  ["raw HTML", HTML, HTML],
  ["header only", "Version:1.0\r\nStartHTML:-1\r\nEndHTML:-1\r\n", null],
  ["empty fragment", "Version:1.0\r\n<!--StartFragment--><!--EndFragment-->", null],
] as const) {
  test(`Windows handles ${name}`, async (t) => {
    mockReader(t, "win32", [value]);
    assert.equal(await readClipboardHtmlAsync(), expected);
  });
}

test("Windows falls back to the HTML byte range when fragment offsets and markers are absent", async (t) => {
  const header = "Version:1.0\r\nStartHTML:0000000000\r\nEndHTML:0000000000\r\n";
  const value = header
    .replace(/StartHTML:\d+/, `StartHTML:${String(Buffer.byteLength(header)).padStart(10, "0")}`)
    .replace(/EndHTML:\d+/, `EndHTML:${String(Buffer.byteLength(header + HTML)).padStart(10, "0")}`);
  mockReader(t, "win32", [value + HTML + "\0"]);
  assert.equal(await readClipboardHtmlAsync(), HTML);
});

test("Linux reads text/html from xclip", async (t) => {
  const calls = mockReader(t, "linux", [HTML]);
  assert.equal(await readClipboardHtmlAsync(), HTML);
  assert.deepEqual(
    calls.map(({ command, args }) => [command, args]),
    [["xclip", ["-selection", "clipboard", "-t", "text/html", "-o"]]]
  );
});

for (const output of ["", " \n", new Error("ENOENT"), new Error("timeout"), new Error("maxBuffer exceeded")]) {
  test(`HTML read failure (${String(output)}) returns null`, async (t) => {
    const calls = mockReader(t, "darwin", [output]);
    assert.equal(await readClipboardHtmlAsync(), null);
    assert.equal(calls[0].options.timeout, 3000);
    assert.equal(calls[0].options.maxBuffer, 32 * 1024 * 1024);
    assert.equal(calls[0].options.encoding, "utf8");
  });
  test(`Linux falls back to wl-paste after ${String(output)}`, async (t) => {
    const calls = mockReader(t, "linux", [output, HTML]);
    assert.equal(await readClipboardHtmlAsync(), HTML);
    assert.deepEqual(
      calls.map(({ command }) => command),
      ["xclip", "wl-paste"]
    );
    assert.deepEqual(calls[1].args, ["--type", "text/html", "--no-newline"]);
  });
}

test("Linux returns null when both clipboard helpers fail", async (t) => {
  mockReader(t, "linux", []);
  assert.equal(await readClipboardHtmlAsync(), null);
});

test("unsupported platforms return null without spawning", async (t) => {
  const calls = mockReader(t, "freebsd", []);
  assert.equal(await readClipboardHtmlAsync(), null);
  assert.equal(calls.length, 0);
});
