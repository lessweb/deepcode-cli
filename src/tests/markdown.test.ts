import { test } from "node:test";
import assert from "node:assert/strict";
import { renderMarkdown } from "../ui";

function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\[[0-9;]*m/g, "");
}

test("renderMarkdown returns empty string for empty input", () => {
  assert.equal(renderMarkdown(""), "");
});

test("renderMarkdown preserves heading text", () => {
  const result = stripAnsi(renderMarkdown("# Title"));
  assert.equal(result.includes("Title"), true);
  assert.equal(result.includes("#"), true);
});

test("renderMarkdown preserves code fences with language tag", () => {
  const result = stripAnsi(renderMarkdown("```js\nconsole.log(1);\n```"));
  assert.equal(result.includes("[js]"), true);
  assert.equal(result.includes("console.log(1);"), true);
});

test("renderMarkdown styles inline code without removing it", () => {
  const result = stripAnsi(renderMarkdown("Use `npm install` first."));
  assert.equal(result.includes("npm install"), true);
});

test("renderMarkdown keeps bullet markers", () => {
  const result = stripAnsi(renderMarkdown("- item one\n- item two"));
  assert.equal(result.includes("- item one"), true);
  assert.equal(result.includes("- item two"), true);
});

test("renderMarkdown handles plain text unchanged in stripped form", () => {
  const text = "hello world\nthis is a sentence";
  const result = stripAnsi(renderMarkdown(text));
  assert.equal(result, text);
});
