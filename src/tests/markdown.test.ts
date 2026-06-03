import { test } from "node:test";
import assert from "node:assert/strict";
import { renderMarkdown, renderMarkdownSegments } from "../ui";

function stripAnsi(text: string): string {
  return text.replace(/\[[0-9;]*m/g, "");
}

function visualWidth(text: string): number {
  let width = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    width +=
      ch.length >= 2 ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xff00 && code <= 0xffe6)
        ? 2
        : 1;
  }
  return width;
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

test("renderMarkdown preserves underscores inside inline code", () => {
  const source =
    "Use `redo_completed_tasks2_1min`, replace `execute_query` with `select_one`/`select_all`, and check `ocr_result`.";
  const result = stripAnsi(renderMarkdown(source));
  assert.equal(
    result,
    "Use redo_completed_tasks2_1min, replace execute_query with select_one/select_all, and check ocr_result."
  );
});

test("renderMarkdown preserves underscores in plain identifiers", () => {
  const result = stripAnsi(renderMarkdown("Check redo_completed_tasks2_1min and ocr_result values."));
  assert.equal(result, "Check redo_completed_tasks2_1min and ocr_result values.");
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

test("renderMarkdownSegments renders CJK table cells within the requested width", () => {
  const table = [
    "| 编号 | 状态 | 任务 | 备注 |",
    "|---|---|---|---|",
    "| 1 | ✅ | 写代码 | 这是一个很长很长的中文备注用于验证表格在终端宽度不足时是否能够自动换行而不是溢出 |",
  ].join("\n");

  const segment = renderMarkdownSegments(table, 60).find((item) => item.kind === "table");
  assert.ok(segment);
  const lines = stripAnsi(segment.body).split("\n");
  assert.equal(lines[0].startsWith("┌"), true);
  assert.equal(lines.at(-1)?.startsWith("└"), true);
  assert.equal(
    lines.every((line) => visualWidth(line) <= 60),
    true
  );
  assert.equal(lines.length > 4, true);
});

test("renderMarkdown preserves empty table cells", () => {
  const result = stripAnsi(renderMarkdown("| A | B | C |\n|---|---|---|\n|x||z|", 80));
  const bodyRow = result.split("\n").find((line) => line.includes("x") && line.includes("z"));
  assert.ok(bodyRow);
  assert.equal((bodyRow.match(/│/g) ?? []).length, 4);
});

test("renderMarkdown keeps text separated from rendered table blocks", () => {
  const result = stripAnsi(renderMarkdown("Before\n| A | B |\n|---|---|\n| 1 | 2 |\nAfter", 40));
  assert.equal(result.includes("Before\n┌"), true);
  assert.equal(result.includes("┘\nAfter"), true);
});

test("renderMarkdown does not render tables inside code fences", () => {
  const result = stripAnsi(renderMarkdown("```md\n| A | B |\n|---|---|\n| 1 | 2 |\n```", 40));
  assert.equal(result.includes("| A | B |"), true);
  assert.equal(result.includes("┌"), false);
});
