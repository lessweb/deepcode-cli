import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { readRawMode, writeRawMode } from "../common/cli-config";

function setup(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deepcode-cli-config-"));
  t.mock.method(os, "homedir", () => root);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const directory = path.join(root, ".deepcode");
  const file = path.join(directory, "cli.json");
  return { directory, file };
}

test("reading a missing preference defaults to lite without creating files", (t) => {
  const { directory } = setup(t);
  assert.equal(readRawMode(), "lite");
  assert.equal(fs.existsSync(directory), false);
});

test("saving creates the directory, restores both modes and preserves other fields", (t) => {
  const { directory, file } = setup(t);
  writeRawMode("normal");
  assert.equal(readRawMode(), "normal");
  fs.writeFileSync(file, JSON.stringify({ rawMode: "normal", future: { enabled: true } }));
  writeRawMode("lite");
  writeRawMode("lite");
  assert.equal(readRawMode(), "lite");
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { rawMode: "lite", future: { enabled: true } });
  assert.deepEqual(fs.readdirSync(directory), ["cli.json"]);
});

test("invalid preferences fall back to lite without modifying the file", (t) => {
  const { directory, file } = setup(t);
  fs.mkdirSync(directory);
  for (const content of ["{", "null", "[]", "42", "{}", '{"rawMode":"raw-scrollback"}', '{"rawMode":false}']) {
    fs.writeFileSync(file, content);
    assert.equal(readRawMode(), "lite");
    assert.equal(fs.readFileSync(file, "utf8"), content);
  }
});

test("saving refuses to overwrite malformed or non-object configurations", (t) => {
  const { directory, file } = setup(t);
  fs.mkdirSync(directory);
  for (const content of ["{", "null", "[]", "42"]) {
    fs.writeFileSync(file, content);
    assert.throws(() => writeRawMode("normal"));
    assert.equal(fs.readFileSync(file, "utf8"), content);
  }
});

test("failed replacement preserves the saved preference and removes the temporary file", (t) => {
  const { directory, file } = setup(t);
  writeRawMode("normal");
  const before = fs.readFileSync(file, "utf8");
  t.mock.method(fs, "renameSync", () => {
    throw new Error("Write failed");
  });
  assert.throws(() => writeRawMode("lite"), /Write failed/);
  assert.equal(fs.readFileSync(file, "utf8"), before);
  assert.deepEqual(fs.readdirSync(directory), ["cli.json"]);
});
