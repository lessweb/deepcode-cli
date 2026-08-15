import { test } from "node:test";
import assert from "node:assert/strict";
import { parseServerOptions, readArgValue } from "../services/server-options";

test("parseServerOptions uses local defaults", () => {
  assert.deepEqual(parseServerOptions([]), { host: "127.0.0.1", port: 8787, authDisabled: false });
});

test("parseServerOptions accepts inline and separated option values", () => {
  assert.deepEqual(parseServerOptions(["--host=localhost", "--port", "9000", "--no-auth"]), {
    host: "localhost",
    port: 9000,
    authDisabled: true,
  });
  assert.equal(readArgValue(["--project-root", "/tmp/work"], "--project-root"), "/tmp/work");
});

test("parseServerOptions rejects invalid ports and unsafe binds", () => {
  assert.throws(() => parseServerOptions(["--port", "0"]), /Invalid --port value/u);
  assert.throws(() => parseServerOptions(["--host", "0.0.0.0"]), /requires --unsafe-bind/u);
  assert.equal(parseServerOptions(["--host", "0.0.0.0", "--unsafe-bind"]).host, "0.0.0.0");
});
