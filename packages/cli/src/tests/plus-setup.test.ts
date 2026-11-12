import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { checkPlusSubscription } from "@vegamo/deepcode-core";
import { runPlusSetup } from "../plus-setup";

function terminal(isTTY = true) {
  const input = Object.assign(new PassThrough(), { isTTY });
  const output = new PassThrough();
  const errorOutput = new PassThrough();
  let stdout = "";
  let stderr = "";
  output.on("data", (chunk) => {
    stdout += chunk;
  });
  errorOutput.on("data", (chunk) => {
    stderr += chunk;
  });
  return { input, output, errorOutput, stdout: () => stdout, stderr: () => stderr };
}

test("setup echoes input and saves normalized keys only after HTTP 200", async () => {
  for (const length of [24, 26]) {
    const streams = terminal();
    const key = `sk-${"a".repeat(length)}`;
    const saved: string[] = [];
    const result = runPlusSetup({
      ...streams,
      checkSubscription: (value, signal) =>
        checkPlusSubscription(value, signal, async () => {
          assert.equal(value, key);
          assert.deepEqual(saved, []);
          return { status: 200 };
        }),
      saveKey: (value) => {
        saved.push(value);
      },
    });
    streams.input.write(`  ${key}  \n`);
    assert.equal(await result, 0);
    assert.deepEqual(saved, [key]);
    assert.ok(streams.stdout().includes(key));
    assert.match(streams.stdout(), /API Key saved/);
    assert.equal(streams.stderr(), "");
  }
});

test("invalid formats do not probe or save", async () => {
  for (const key of ["", "invalid", `sk-${"a".repeat(25)}`]) {
    const streams = terminal();
    const result = runPlusSetup({
      ...streams,
      checkSubscription: async () => assert.fail("must not probe"),
      saveKey: () => assert.fail("must not save"),
    });
    streams.input.write(`${key}\n`);
    assert.equal(await result, 1);
    assert.match(streams.stderr(), /Invalid API Key format/);
  }
});

test("failed subscription and network checks never save", async () => {
  for (const status of [401, 403, 500, 302, "offline", "timeout"] as const) {
    const streams = terminal();
    const result = runPlusSetup({
      ...streams,
      checkSubscription: (key, signal) =>
        checkPlusSubscription(
          key,
          signal,
          async (_url, options) => {
            if (status === "offline") throw new Error("offline");
            if (status === "timeout")
              return new Promise((_resolve, reject) => {
                options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
              });
            return { status };
          },
          5
        ),
      saveKey: () => assert.fail("must not save"),
    });
    streams.input.write(`sk-${"a".repeat(24)}\n`);
    assert.equal(await result, 1);
    assert.match(streams.stderr(), status === 401 || status === 403 ? /cannot use DeepCode Plus/ : /Unable to verify/);
  }
});

test("non-TTY input fails before reading or checking", async () => {
  const streams = terminal(false);
  assert.equal(
    await runPlusSetup({
      ...streams,
      checkSubscription: async () => assert.fail("must not probe"),
      saveKey: () => assert.fail("must not save"),
    }),
    1
  );
  assert.match(streams.stderr(), /interactive terminal/);
  assert.equal(streams.stdout(), "");
});

test("Ctrl+C and EOF cancel input without saving and remove signal handlers", async () => {
  for (const input of ["\u0003", "\u0004"]) {
    const streams = terminal();
    const listeners = process.listenerCount("SIGINT");
    const result = runPlusSetup({
      ...streams,
      checkSubscription: async () => assert.fail("must not probe"),
      saveKey: () => assert.fail("must not save"),
    });
    streams.input.write(input);
    assert.equal(await result, 130);
    assert.equal(process.listenerCount("SIGINT"), listeners);
  }
});

test("Ctrl+C during verification cancels without saving", async () => {
  const streams = terminal();
  const result = runPlusSetup({
    ...streams,
    checkSubscription: async (_key, signal) => {
      process.emit("SIGINT");
      signal!.throwIfAborted();
      return "full ability";
    },
    saveKey: () => assert.fail("must not save"),
  });
  streams.input.write(`sk-${"a".repeat(24)}\n`);
  assert.equal(await result, 130);
});

test("save errors produce a concise failure and no success message", async () => {
  const streams = terminal();
  const result = runPlusSetup({
    ...streams,
    checkSubscription: async () => "full ability",
    saveKey: () => {
      throw new Error("EACCES");
    },
  });
  streams.input.write(`sk-${"a".repeat(24)}\n`);
  assert.equal(await result, 1);
  assert.match(streams.stderr(), /Unable to save/);
  assert.doesNotMatch(streams.stdout(), /API Key saved/);
});
