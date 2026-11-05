import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { syncBuiltinESMExports } from "node:module";
import { PassThrough } from "node:stream";
import { test, type TestContext } from "node:test";
import { writeClipboardTextAsync } from "../ui/core/clipboard";

type Outcome = "success" | "failure" | "missing" | "pipe-error" | "timeout" | "throw";

function mockWriter(t: TestContext, platform: NodeJS.Platform, outcomes: Outcome[] = ["success"]) {
  const descriptor = Object.getOwnPropertyDescriptor(process, "platform")!;
  Object.defineProperty(process, "platform", { value: platform });
  const calls: { command: string; args: string[]; text: string; killed: boolean }[] = [];
  t.mock.method(childProcess, "spawn", (command: string, args: string[]) => {
    const outcome = outcomes[calls.length] ?? "failure";
    const call = { command, args, text: "", killed: false };
    calls.push(call);
    if (outcome === "throw") throw new Error("spawn failed");
    const stdin = new PassThrough();
    stdin.on("data", (chunk: Buffer) => (call.text += chunk.toString("utf8")));
    const child = Object.assign(new EventEmitter(), {
      stdin,
      kill(signal: string) {
        assert.equal(signal, "SIGKILL");
        call.killed = true;
        return true;
      },
    });
    queueMicrotask(() => {
      if (outcome === "missing") child.emit("error", new Error("ENOENT"));
      else if (outcome === "pipe-error") stdin.emit("error", new Error("EPIPE"));
      else if (outcome !== "timeout") child.emit("exit", outcome === "success" ? 0 : 1);
    });
    return child;
  });
  syncBuiltinESMExports();
  t.after(() => {
    Object.defineProperty(process, "platform", descriptor);
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  return calls;
}

const TEXT = "  中文 😀\n'quoted' `literal` $(literal)\r\nlast line\n";

for (const [platform, command] of [
  ["darwin", "pbcopy"],
  ["linux", "wl-copy"],
  ["win32", "powershell"],
] as const) {
  test(`${platform}: copies exact UTF-8 text through stdin`, async (t) => {
    const calls = mockWriter(t, platform);
    assert.equal(await writeClipboardTextAsync(TEXT), true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, command);
    assert.equal(calls[0].text, TEXT);
    assert.ok(!calls[0].args.join(" ").includes(TEXT));
    assert.equal(calls[0].killed, false);
    if (platform === "win32") {
      assert.match(calls[0].args.at(-1)!, /UTF8Encoding/);
      assert.match(calls[0].args.at(-1)!, /ReadToEnd/);
    }
  });
}

for (const outcome of ["failure", "missing", "pipe-error", "throw"] as const) {
  test(`clipboard ${outcome} returns false`, async (t) => {
    mockWriter(t, "darwin", [outcome]);
    assert.equal(await writeClipboardTextAsync(TEXT), false);
  });
  test(`Linux falls back to xclip after ${outcome}`, async (t) => {
    const calls = mockWriter(t, "linux", [outcome, "success"]);
    assert.equal(await writeClipboardTextAsync(TEXT), true);
    assert.deepEqual(
      calls.map((call) => call.command),
      ["wl-copy", "xclip"]
    );
    assert.deepEqual(calls[1].args, ["-selection", "clipboard", "-in"]);
    assert.equal(calls[1].text, TEXT);
  });
}

test("clipboard timeout kills the helper and returns false", async (t) => {
  const calls = mockWriter(t, "darwin", ["timeout"]);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const copying = writeClipboardTextAsync(TEXT);
  t.mock.timers.tick(3000);
  assert.equal(await copying, false);
  assert.equal(calls[0].killed, true);
});

test("Linux reports failure when both clipboard helpers are missing", async (t) => {
  const calls = mockWriter(t, "linux", ["missing", "missing"]);
  assert.equal(await writeClipboardTextAsync(TEXT), false);
  assert.equal(calls.length, 2);
});

test("empty input leaves the clipboard untouched", async (t) => {
  const calls = mockWriter(t, "darwin");
  assert.equal(await writeClipboardTextAsync(""), false);
  assert.equal(calls.length, 0);
  assert.equal(await writeClipboardTextAsync(" \n"), true);
  assert.equal(calls[0].text, " \n");
});

test("unsupported platforms report failure without spawning", async (t) => {
  const calls = mockWriter(t, "freebsd");
  assert.equal(await writeClipboardTextAsync(TEXT), false);
  assert.equal(calls.length, 0);
});
