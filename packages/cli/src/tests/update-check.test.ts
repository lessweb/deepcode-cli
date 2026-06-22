import { test } from "node:test";
import assert from "node:assert/strict";
import { UPDATE_SUCCESS_MESSAGE, compareVersions, parseNpmViewVersion } from "../common/update-check";

test("compareVersions orders semantic versions", () => {
  assert.equal(compareVersions("0.1.4", "0.1.3"), 1);
  assert.equal(compareVersions("0.2.0", "0.10.0"), -1);
  assert.equal(compareVersions("1.0.0", "1.0.0"), 0);
  assert.equal(compareVersions("1.0.0", "1.0.0-beta.1"), 0);
});

test("parseNpmViewVersion parses npm view JSON and plain output", () => {
  assert.equal(parseNpmViewVersion('"0.1.4"\n'), "0.1.4");
  assert.equal(parseNpmViewVersion("0.1.5\n"), "0.1.5");
  assert.equal(parseNpmViewVersion("\n"), null);
});

test("UPDATE_SUCCESS_MESSAGE tells the user to restart Deep Code", () => {
  assert.equal(UPDATE_SUCCESS_MESSAGE, "🎉 Update ran successfully! Please restart Deep Code.");
});
