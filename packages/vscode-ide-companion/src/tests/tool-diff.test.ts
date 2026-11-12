import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { test } from "node:test";
import { prepareToolDiffContent } from "../tool-diff";

class Element {
  className = "";
  children: Element[] = [];
  private text = "";
  properties: Record<string, string> = {};
  style = {
    setProperty: (key: string, value: string) => {
      this.properties[key] = value;
    },
  };
  set textContent(value: string) {
    this.text = value;
  }
  get textContent(): string {
    return this.text + this.children.map((child) => child.textContent).join("");
  }
  appendChild(child: Element): void {
    this.children.push(child);
  }
}

function createRenderer(workspaceRoot = "/home/user/project", userHome = "/home/user") {
  const html = fs.readFileSync(new URL("../../resources/webview.html", import.meta.url), "utf8");
  const source = html.slice(
    html.indexOf("      function formatDisplayPath("),
    html.indexOf("      function addToolParamsTooltip(")
  );
  const context = {
    workspaceRoot,
    userHome,
    document: {
      createElement: () => new Element(),
      createTextNode: (text: string) => {
        const node = new Element();
        node.textContent = text;
        return node;
      },
    },
    formatDisplayPath: undefined as unknown as (path: string) => string,
    renderDiffPreview: undefined as unknown as (metadata: unknown) => Element | null,
  };
  vm.runInNewContext(source, context);
  return context;
}

for (const name of ["edit", "write"]) {
  test(`webview ${name} renders legacy diffs with full counts, paths and separate line numbers`, () => {
    const content = JSON.stringify({
      name,
      ok: true,
      metadata: {
        file_path: "/home/user/project/src/file.ts",
        diff_preview: "--- a/file\n+++ b/file\n@@ -99,1 +99,2 @@\n before\n-old\n+<new>\n+\n after\n...",
      },
    });
    const metadata = JSON.parse(prepareToolDiffContent("tool", content)!).metadata;
    const section = createRenderer().renderDiffPreview(metadata)!;
    assert.equal(section.children[0].textContent, "└ src/file.ts · +2 -1");
    const list = section.children[1];
    assert.equal(list.properties["--diff-number-width"], "3ch");
    assert.deepEqual(
      list.children.map((row) => row.children[0].textContent),
      ["98", "99", "99", "100", "101", ""]
    );
    assert.equal(list.children[2].children[2].textContent, "<new>");
    assert.equal(list.children[3].children[2].textContent, "");
    assert.ok(list.children.every((row) => row.children[0].className === "diff-line-number"));
    assert.equal(list.children.at(-1)?.children[2].textContent, "...");
  });
}

test("webview formats home and workspace paths using directory boundaries", () => {
  const { formatDisplayPath: format } = createRenderer();
  assert.equal(format("/home/user/project/a.ts"), "a.ts");
  assert.equal(format("/home/user/project-other/a.ts"), "~/project-other/a.ts");
  assert.equal(format("/home/user/other/a.ts"), "~/other/a.ts");
  assert.equal(format("/home/user-other/a.ts"), "/home/user-other/a.ts");
  assert.equal(format("/etc/a.ts"), "/etc/a.ts");
  const windows = createRenderer("C:\\Users\\test\\project", "C:\\Users\\test");
  assert.equal(windows.formatDisplayPath("C:\\Users\\test\\project\\a.ts"), "a.ts");
  assert.equal(windows.formatDisplayPath("C:\\Users\\test\\other\\a.ts"), "~/other/a.ts");
});

test("tool diff preparation preserves new metadata and leaves failures and unrelated messages alone", () => {
  const metadata = {
    file_path: "/tmp/file",
    diff_details: { added: 100, removed: 0, lines: [{ kind: "added", content: "new", lineNumber: 1 }] },
  };
  const content = JSON.stringify({ name: "write", ok: true, metadata });
  assert.deepEqual(JSON.parse(prepareToolDiffContent("tool", content)!).metadata, metadata);
  assert.equal(prepareToolDiffContent("assistant", content), content);
  assert.equal(prepareToolDiffContent("tool", "invalid"), "invalid");
  const failed = JSON.stringify({ name: "write", ok: false, metadata });
  assert.equal(prepareToolDiffContent("tool", failed), failed);
  assert.equal(createRenderer().renderDiffPreview({ diff_details: { lines: [] } }), null);
});
