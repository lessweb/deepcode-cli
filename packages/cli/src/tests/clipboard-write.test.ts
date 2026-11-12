import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { syncBuiltinESMExports } from "node:module";
import { PassThrough } from "node:stream";
import { test, type TestContext } from "node:test";
import { writeClipboardTextAsync } from "../ui/core/clipboard";
import { isolateSshEnvironment, mockClipboardTerminal } from "./clipboard-test-helpers";

type Outcome = "success" | "failure" | "missing" | "pipe-error" | "timeout" | "throw";

function mockWriter(t: TestContext, platform: NodeJS.Platform, outcomes: Outcome[] = ["success"]) {
  isolateSshEnvironment(t);
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

for (const variable of ["SSH_CONNECTION", "SSH_CLIENT", "SSH_TTY"]) {
  test(`${variable}: sends exact UTF-8 text via OSC 52 without a helper`, async (t) => {
    const calls = mockWriter(t, "darwin");
    const { writes } = mockClipboardTerminal(t);
    process.env[variable] = "ssh-test";
    assert.equal(await writeClipboardTextAsync(TEXT), true);
    assert.deepEqual(writes, [`\x1b]52;c;${Buffer.from(TEXT).toString("base64")}\x07`]);
    assert.equal(calls.length, 0);
  });
}

test("SSH does not copy empty input or write to redirected stdout", async (t) => {
  const calls = mockWriter(t, "linux");
  const { output, writes } = mockClipboardTerminal(t, false);
  process.env.SSH_TTY = "/dev/pts/0";
  assert.equal(await writeClipboardTextAsync(TEXT), false);
  output.isTTY = true;
  assert.equal(await writeClipboardTextAsync(""), false);
  assert.deepEqual(writes, []);
  assert.equal(calls.length, 0);
  assert.equal(await writeClipboardTextAsync(" \n"), true);
  assert.deepEqual(writes, ["\x1b]52;c;IAo=\x07"]);
});

for (const outcome of ["throw", "callback-error", "event-error", "backpressure"] as const) {
  test(`SSH handles ${outcome} without falling back to a helper`, async (t) => {
    const calls = mockWriter(t, "darwin");
    const { output } = mockClipboardTerminal(t);
    process.env.SSH_CLIENT = "ssh-test";
    let complete!: (error?: Error) => void;
    t.mock.method(output, "write", (_chunk: string, callback: (error?: Error) => void) => {
      if (outcome === "throw") throw new Error("write failed");
      complete = callback;
      return false;
    });
    let settled = false;
    const pending = writeClipboardTextAsync(TEXT).then((value) => {
      settled = true;
      return value;
    });
    if (outcome !== "throw") {
      await Promise.resolve();
      assert.equal(settled, false);
      if (outcome === "event-error") output.emit("error", new Error("write failed"));
      else if (outcome === "callback-error") {
        complete(new Error("write failed"));
        output.emit("error", new Error("write failed"));
      } else complete();
    }
    assert.equal(await pending, outcome === "backpressure");
    assert.equal(calls.length, 0);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(output.listenerCount("error"), 0);
  });
}
