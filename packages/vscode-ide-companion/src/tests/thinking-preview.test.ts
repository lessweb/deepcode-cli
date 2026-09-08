import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { test } from "node:test";

type FitPreview = (text: string, width: number, measure: (text: string) => number) => string;
const window: { fitThinkingPreview?: FitPreview } = {};
vm.runInNewContext(fs.readFileSync(new URL("../../resources/thinking-preview.js", import.meta.url), "utf8"), {
  window,
  Intl,
});
const fit = window.fitThinkingPreview!;
const measure = (text: string) => Array.from(text).length;

test("webview preview preserves brackets and keeps the latest text within the measured width", () => {
  assert.equal(fit("hello", 7, measure), "[hello]");
  assert.equal(fit("older latest", 11, measure), "[...latest]");
  assert.equal(fit("hello", 5, measure), "");
  assert.equal(fit("", 100, measure), "");
  assert.equal(fit("hello", 0, measure), "");
  assert.equal(fit("<b>text</b>", 100, measure), "[<b>text</b>]");
});

test("webview preview never splits a grapheme when fitting a narrow space", () => {
  const suffix = "👨‍👩‍👧‍👦é";
  const text = "older text 中文" + suffix;
  for (let width = 1; width < 50; width++) {
    const result = fit(text, width, measure);
    assert.ok(measure(result) <= width);
    if (result.startsWith("[...")) {
      const tail = result.slice(4, -1);
      const segments = Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text));
      assert.ok(segments.some((part) => text.slice(part.index) === tail));
    }
  }
  assert.equal(fit(text, measure(suffix) + 5, measure), `[...${suffix}]`);
});
