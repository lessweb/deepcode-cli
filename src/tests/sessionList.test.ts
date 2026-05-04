import { test } from "node:test";
import assert from "node:assert/strict";
import { formatSessionTitle } from "../ui";

test("formatSessionTitle replaces newlines with spaces", () => {
  assert.equal(formatSessionTitle("first line\nsecond line\r\nthird"), "first line second line third");
});

test("formatSessionTitle truncates after normalizing whitespace", () => {
  assert.equal(formatSessionTitle("one\n two   three", 10), "one two th…");
});
