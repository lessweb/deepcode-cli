import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { setTimeout as delay } from "node:timers/promises";
import type { ProcessTimeoutControl, ToolExecutionContext } from "../tools/executor";
import { handleBashTool } from "../tools/bash-handler";
import { handleEditTool } from "../tools/edit-handler";
import { handleReadTool } from "../tools/read-handler";
import { handleUpdatePlanTool } from "../tools/update-plan-handler";
import { handleWriteTool } from "../tools/write-handler";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("Bash streams stdout and stderr before command completion", async () => {
  const workspace = createTempWorkspace();
  const chunks: string[] = [];
  let completed = false;

  const resultPromise = handleBashTool(
    {
      command: "printf 'first\\n'; sleep 1; printf 'second\\n'; printf 'err\\n' >&2",
    },
    createContext("bash-live-output", workspace, {
      onProcessStdout: (_pid, chunk) => {
        chunks.push(chunk);
      },
    })
  ).finally(() => {
    completed = true;
  });

  await waitFor(() => chunks.join("").includes("first"), 1500);

  assert.equal(completed, false);

  const result = await resultPromise;
  const streamedOutput = chunks.join("");
  assert.equal(result.ok, true);
  assert.match(streamedOutput, /first/);
  assert.match(streamedOutput, /second/);
  assert.match(streamedOutput, /err/);
});

test("Bash terminates commands that exceed the configured timeout", async () => {
  const workspace = createTempWorkspace();
  const exitedPids: Array<string | number> = [];

  const result = await handleBashTool(
    {
      command: "printf 'start\\n'; sleep 5; printf 'done\\n'",
    },
    createContext("bash-timeout", workspace, {
      bashTimeoutMs: 100,
      bashMinTimeoutMs: 1,
      onProcessExit: (pid) => {
        exitedPids.push(pid);
      },
    })
  );

  assert.equal(result.ok, false);
  assert.equal(result.error, "Command timed out.");
  assert.equal(result.metadata?.timedOut, true);
  assert.equal(result.metadata?.timeoutMs, 100);
  assert.doesNotMatch(result.output ?? "", /done/);
  assert.equal(exitedPids.length, 1);
});

test("Bash timeout control can extend the active command deadline", async () => {
  const workspace = createTempWorkspace();
  let timeoutControl: ProcessTimeoutControl | null = null;

  const result = await handleBashTool(
    {
      command: "sleep 0.2; printf 'done\\n'",
    },
    createContext("bash-timeout-extend", workspace, {
      bashTimeoutMs: 100,
      bashMinTimeoutMs: 1,
      onProcessTimeoutControl: (_pid, control) => {
        if (control) {
          timeoutControl = control;
          control.setTimeoutMs(1000);
        }
      },
    })
  );

  assert.ok(timeoutControl);
  assert.equal(result.ok, true);
  assert.match(result.output ?? "", /done/);
  assert.equal(result.metadata?.timedOut, false);
  assert.equal(result.metadata?.timeoutMs, 1000);
});

test("UpdatePlan accepts a markdown task list string", async () => {
  const workspace = createTempWorkspace();
  const plan = ["## Task List", "", "- [>] Inspect current behavior", "- [ ] Implement UpdatePlan"].join("\n");

  const result = await handleUpdatePlanTool({ plan }, createContext("update-plan", workspace));

  assert.equal(result.ok, true);
  assert.equal(result.name, "UpdatePlan");
  assert.equal(result.output, "Plan updated.");
  assert.equal(result.metadata?.plan, plan);
});

test("UpdatePlan rejects non-string plan payloads", async () => {
  const workspace = createTempWorkspace();

  const result = await handleUpdatePlanTool(
    { plan: [{ step: "Inspect current behavior", status: "in_progress" }] },
    createContext("update-plan-invalid", workspace)
  );

  assert.equal(result.ok, false);
  assert.equal(result.name, "UpdatePlan");
  assert.match(result.error ?? "", /InputValidationError/);
});

test("Read returns snippet metadata and Edit can scope replacements by snippet_id", async () => {
  const workspace = createTempWorkspace();
  const filePath = path.join(workspace, "sample.txt");
  fs.writeFileSync(filePath, ["alpha", "target = 1", "omega", "beta", "target = 1", "done"].join("\n"), "utf8");

  const sessionId = "snippet-scope";
  const readResult = await handleReadTool(
    { file_path: filePath, offset: 4, limit: 2 },
    createContext(sessionId, workspace)
  );

  assert.equal(readResult.ok, true);
  const snippet = (readResult.metadata?.snippet ?? null) as { id: string; startLine: number; endLine: number } | null;
  assert.ok(snippet);
  assert.equal(snippet?.startLine, 4);
  assert.equal(snippet?.endLine, 5);

  const editResult = await handleEditTool(
    {
      snippet_id: snippet?.id,
      old_string: "target = 1",
      new_string: "target = 2",
    },
    createContext(sessionId, workspace)
  );

  assert.equal(editResult.ok, true);
  assert.equal(editResult.metadata?.file_path, filePath);
  assert.equal(editResult.metadata?.read_scope_type, "snippet");
  assert.equal(editResult.metadata?.cache_refreshed, true);
  assert.equal(editResult.metadata?.line_endings, "LF");
  assert.match(String(editResult.metadata?.diff_preview ?? ""), /\+target = 2/);
  assert.equal(
    fs.readFileSync(filePath, "utf8"),
    ["alpha", "target = 1", "omega", "beta", "target = 2", "done"].join("\n")
  );
});

test("Read returns full-file snippet ids with a semantic prefix", async () => {
  const workspace = createTempWorkspace();
  const filePath = path.join(workspace, "full.txt");
  fs.writeFileSync(filePath, "alpha\nbeta\n", "utf8");

  const firstSnippet = await readSnippet(filePath, "full-file-snippet", workspace);
  const secondSnippet = await readSnippet(filePath, "full-file-snippet", workspace);

  assert.equal(firstSnippet.id, "full_file_0");
  assert.equal(secondSnippet.id, "full_file_1");
});

test("Edit returns candidate match snippets when old_string is not unique", async () => {
  const workspace = createTempWorkspace();
  const filePath = path.join(workspace, "duplicate.txt");
  fs.writeFileSync(filePath, ["city", "city", "salary"].join("\n"), "utf8");

  const sessionId = "candidate-matches";
  const snippet = await readSnippet(filePath, sessionId, workspace);

  const editResult = await handleEditTool(
    {
      snippet_id: snippet.id,
      old_string: "city",
      new_string: "location",
    },
    createContext(sessionId, workspace)
  );

  assert.equal(editResult.ok, false);
  assert.equal(editResult.error, "old_string is not unique; use snippet_id, replace_all, or provide more context.");
  const candidates = (editResult.metadata?.candidates ?? []) as Array<{
    snippet_id: string;
    start_line: number;
    end_line: number;
    preview: string;
  }>;
  assert.equal(candidates.length, 2);
  assert.ok(candidates[0]?.snippet_id);
  assert.equal(candidates[0]?.start_line, 1);
  assert.match(candidates[0]?.preview ?? "", /city/);
});

test("Edit reports missing old_string without closest-match metadata when no LLM is configured", async () => {
  const workspace = createTempWorkspace();
  const filePath = path.join(workspace, "closest.ts");
  fs.writeFileSync(
    filePath,
    [
      "const before = true;",
      "function computeSubtotal(value: number) {",
      "  return value;",
      "}",
      "const after = true;",
    ].join("\n"),
    "utf8"
  );

  const sessionId = "closest-match-context";
  const fullSnippet = await readSnippet(filePath, sessionId, workspace);

  const closeResult = await handleEditTool(
    {
      snippet_id: fullSnippet.id,
      old_string: "function computeTotal(value: number) {",
      new_string: "function computeTotal(input: number) {",
    },
    createContext(sessionId, workspace)
  );

  assert.equal(closeResult.ok, false);
  assert.equal(closeResult.error, "old_string not found in file.");
  assert.equal(closeResult.metadata?.closest_match, undefined);

  const lowResult = await handleEditTool(
    {
      snippet_id: fullSnippet.id,
      old_string: 'query: string = Field(description="search query")',
      new_string: "query: string",
    },
    createContext(sessionId, workspace)
  );

  assert.equal(lowResult.ok, false);
  assert.equal(lowResult.error, "old_string not found in file.");
  assert.equal(lowResult.metadata?.closest_match, undefined);

  const partialRead = await handleReadTool(
    { file_path: filePath, offset: 2, limit: 2 },
    createContext(sessionId, workspace)
  );
  const snippet = (partialRead.metadata?.snippet ?? null) as { id: string } | null;
  assert.ok(snippet);

  const scopedCloseResult = await handleEditTool(
    {
      snippet_id: snippet.id,
      old_string: "function computeTotal(value: number) {",
      new_string: "function computeTotal(input: number) {",
    },
    createContext(sessionId, workspace)
  );

  assert.equal(scopedCloseResult.ok, false);
  assert.equal(scopedCloseResult.error, "old_string not found in file.");
  assert.equal(scopedCloseResult.metadata?.closest_match, undefined);
});

test("Edit appends an LLM diagnosis when old_string is not found", async () => {
  const workspace = createTempWorkspace();
  const filePath = path.join(workspace, "diagnose.ts");
  fs.writeFileSync(
    filePath,
    [
      "const beforeOne = true;",
      "const beforeTwo = true;",
      "function computeSubtotal(value: number) {",
      "  return value;",
      "}",
      "const afterOne = true;",
      "const afterTwo = true;",
      "const afterThree = true;",
    ].join("\n"),
    "utf8"
  );

  const sessionId = "llm-not-found-diagnosis";
  const readResult = await handleReadTool(
    { file_path: filePath, offset: 3, limit: 2 },
    createContext(sessionId, workspace)
  );
  const snippet = (readResult.metadata?.snippet ?? null) as { id: string } | null;
  assert.ok(snippet);

  let llmCalls = 0;
  let prompt = "";
  const editResult = await handleEditTool(
    {
      snippet_id: snippet.id,
      old_string: "function computeTotal(value: number) {\n  return value;",
      new_string: "function computeTotal(input: number) {\n  return input;",
    },
    createContext(sessionId, workspace, {
      createOpenAIClient: () => ({
        client: {
          chat: {
            completions: {
              create: async (request: { messages?: Array<{ content?: string }> }) => {
                llmCalls += 1;
                prompt = String(request.messages?.[1]?.content ?? "");
                return {
                  choices: [
                    {
                      message: {
                        content:
                          "<response><reason><![CDATA[The requested function name is computeTotal, but the snippet contains computeSubtotal.]]></reason></response>",
                      },
                    },
                  ],
                };
              },
            },
          },
        } as any,
        model: "test-model",
        thinkingEnabled: false,
      }),
    })
  );

  assert.equal(editResult.ok, false);
  assert.equal(llmCalls, 1);
  assert.equal(
    editResult.error,
    "old_string not found in file. The requested function name is computeTotal, but the snippet contains computeSubtotal."
  );
  assert.equal(editResult.metadata?.closest_match, undefined);
  assert.match(prompt, /<content_before_snippet><!\[CDATA\[const beforeOne = true;\nconst beforeTwo = true;\]\]>/);
  assert.match(prompt, /<snippet_text><!\[CDATA\[function computeSubtotal\(value: number\) \{\n {2}return value;\n/);
  assert.match(prompt, /<content_after_snippet><!\[CDATA\[\}\nconst afterOne = true;\]\]>/);
  assert.doesNotMatch(prompt, /const afterTwo = true/);
});

test("Edit keeps the base not-found error when the LLM diagnosis is unavailable", async () => {
  const workspace = createTempWorkspace();
  const filePath = path.join(workspace, "invalid-diagnosis.ts");
  fs.writeFileSync(filePath, "const existing = true;\n", "utf8");

  const sessionId = "invalid-llm-not-found-diagnosis";
  const snippet = await readSnippet(filePath, sessionId, workspace);

  const editResult = await handleEditTool(
    {
      snippet_id: snippet.id,
      old_string: "const missing = true;",
      new_string: "const missing = false;",
    },
    createContext(sessionId, workspace, {
      createOpenAIClient: () => ({
        client: {
          chat: {
            completions: {
              create: async () => ({
                choices: [{ message: { content: "<response></response>" } }],
              }),
            },
          },
        } as any,
        model: "test-model",
        thinkingEnabled: false,
      }),
    })
  );

  assert.equal(editResult.ok, false);
  assert.equal(editResult.error, "old_string not found in file.");
  assert.equal(editResult.metadata?.closest_match, undefined);
});

test("Edit allows outdated snippet matches but reports outdated snippet when no match is found", async () => {
  const workspace = createTempWorkspace();
  const filePath = path.join(workspace, "snippet-outdated.txt");
  fs.writeFileSync(filePath, ["alpha = 1", "beta = 1", "gamma = 1"].join("\n"), "utf8");

  const sessionId = "outdated-snippet-miss";
  const readResult = await handleReadTool({ file_path: filePath }, createContext(sessionId, workspace));
  const snippet = (readResult.metadata?.snippet ?? null) as { id: string } | null;
  assert.ok(snippet);

  const firstEdit = await handleEditTool(
    {
      snippet_id: snippet.id,
      old_string: "alpha = 1",
      new_string: "alpha = 2",
    },
    createContext(sessionId, workspace)
  );
  assert.equal(firstEdit.ok, true);

  const secondEdit = await handleEditTool(
    {
      snippet_id: snippet.id,
      old_string: "beta = 1",
      new_string: "beta = 2",
    },
    createContext(sessionId, workspace)
  );
  assert.equal(secondEdit.ok, true);
  assert.equal(fs.readFileSync(filePath, "utf8"), ["alpha = 2", "beta = 2", "gamma = 1"].join("\n"));

  const missingEdit = await handleEditTool(
    {
      snippet_id: snippet.id,
      old_string: "delta = 1",
      new_string: "delta = 2",
    },
    createContext(sessionId, workspace)
  );

  assert.equal(missingEdit.ok, false);
  assert.equal(
    missingEdit.error,
    "old_string was not found in this snippet scope. The file has changed since this snippet was created. Read the file again before editing."
  );
  const outdatedScope = (missingEdit.metadata?.scope ?? {}) as { snippet_id?: string };
  assert.equal(outdatedScope.snippet_id, snippet.id);

  const freshRead = await handleReadTool({ file_path: filePath }, createContext(sessionId, workspace));
  const freshSnippet = (freshRead.metadata?.snippet ?? null) as { id: string } | null;
  assert.ok(freshSnippet);

  const freshMissingEdit = await handleEditTool(
    {
      snippet_id: freshSnippet.id,
      old_string: "delta = 1",
      new_string: "delta = 2",
    },
    createContext(sessionId, workspace)
  );

  assert.equal(freshMissingEdit.ok, false);
  assert.equal(freshMissingEdit.error, "old_string not found in file.");
});

test("Edit reports outdated snippet when a later Write changes the file and snippet matching fails", async () => {
  const workspace = createTempWorkspace();
  const filePath = path.join(workspace, "write-outdated.txt");
  fs.writeFileSync(filePath, ["alpha = 1", "beta = 1"].join("\n"), "utf8");

  const sessionId = "write-outdated-snippet";
  const readResult = await handleReadTool({ file_path: filePath }, createContext(sessionId, workspace));
  const snippet = (readResult.metadata?.snippet ?? null) as { id: string } | null;
  assert.ok(snippet);

  const writeResult = await handleWriteTool(
    {
      file_path: filePath,
      content: ["alpha = 2", "gamma = 2"].join("\n"),
    },
    createContext(sessionId, workspace)
  );

  assert.equal(writeResult.ok, true);

  const editResult = await handleEditTool(
    {
      snippet_id: snippet.id,
      old_string: "beta = 1",
      new_string: "beta = 2",
    },
    createContext(sessionId, workspace)
  );

  assert.equal(editResult.ok, false);
  assert.equal(
    editResult.error,
    "old_string was not found in this snippet scope. The file has changed since this snippet was created. Read the file again before editing."
  );
});

test("replace_all requires expected_occurrences for broad short-fragment replacements", async () => {
  const workspace = createTempWorkspace();
  const filePath = path.join(workspace, "openapi.yaml");
  const fragment = "        schema:\n          type: string";
  fs.writeFileSync(filePath, [fragment, fragment, fragment].join("\n---\n"), "utf8");

  const sessionId = "replace-all-guard";
  const snippet = await readSnippet(filePath, sessionId, workspace);

  const blockedResult = await handleEditTool(
    {
      snippet_id: snippet.id,
      old_string: fragment,
      new_string: "        schema:\n          type: array",
      replace_all: true,
    },
    createContext(sessionId, workspace)
  );

  assert.equal(blockedResult.ok, false);
  assert.match(blockedResult.error ?? "", /provide expected_occurrences to confirm this broader replacement/);

  const allowedResult = await handleEditTool(
    {
      snippet_id: snippet.id,
      old_string: fragment,
      new_string: "        schema:\n          type: array",
      replace_all: true,
      expected_occurrences: 3,
    },
    createContext(sessionId, workspace)
  );

  assert.equal(allowedResult.ok, true);
  assert.equal(
    fs.readFileSync(filePath, "utf8"),
    [
      "        schema:\n          type: array",
      "        schema:\n          type: array",
      "        schema:\n          type: array",
    ].join("\n---\n")
  );
});

test("Edit accepts a unique loose-escape match when only escaping differs", async () => {
  const workspace = createTempWorkspace();
  const filePath = path.join(workspace, "query.py");
  fs.writeFileSync(filePath, "params['city_json'] = f'\"{city}\"'\n", "utf8");

  const sessionId = "closest-match";
  const snippet = await readSnippet(filePath, sessionId, workspace);

  const editResult = await handleEditTool(
    {
      snippet_id: snippet.id,
      old_string: "params['city_json'] = f'\\\\\"{city}\\\\\"'",
      new_string: "params['city_json'] = city",
    },
    createContext(sessionId, workspace, {
      createOpenAIClient: () => ({
        client: {
          chat: {
            completions: {
              create: async () => ({
                choices: [
                  {
                    message: {
                      content:
                        "<response>" +
                        "<corrected_old_string><![CDATA[params['city_json'] = f'\"{city}\"']]></corrected_old_string>" +
                        "<corrected_new_string><![CDATA[params['city_json'] = city]]></corrected_new_string>" +
                        "</response>",
                    },
                  },
                ],
              }),
            },
          },
        } as any,
        model: "test-model",
        thinkingEnabled: false,
      }),
    })
  );

  assert.equal(editResult.ok, true);
  assert.equal(editResult.metadata?.matched_via, "llm_escape_correction");
  assert.equal(fs.readFileSync(filePath, "utf8"), "params['city_json'] = city\n");
});

test("Edit accepts a unique loose-escape match for over-escaped unicode sequences", async () => {
  const workspace = createTempWorkspace();
  const filePath = path.join(workspace, "keys.ts");
  fs.writeFileSync(filePath, 'const sequence = "\\u001B[13;2~";\n', "utf8");

  const sessionId = "unicode-loose-escape";
  const snippet = await readSnippet(filePath, sessionId, workspace);

  let llmCalls = 0;
  const editResult = await handleEditTool(
    {
      snippet_id: snippet.id,
      old_string: 'const sequence = "\\\\u001B[13;2~";',
      new_string: 'const sequence = "\\\\u001B[13;130u";',
    },
    createContext(sessionId, workspace, {
      createOpenAIClient: () => ({
        client: {
          chat: {
            completions: {
              create: async (request: { messages?: Array<{ content?: string }> }) => {
                llmCalls += 1;
                assert.match(String(request.messages?.[1]?.content ?? ""), /<matched_text><!\[CDATA\[/);
                return {
                  choices: [
                    {
                      message: {
                        content:
                          "<response>" +
                          '<corrected_old_string><![CDATA[const sequence = "\\u001B[13;2~";]]></corrected_old_string>' +
                          '<corrected_new_string><![CDATA[const sequence = "\\u001B[13;130u";]]></corrected_new_string>' +
                          "</response>",
                      },
                    },
                  ],
                };
              },
            },
          },
        } as any,
        model: "test-model",
        thinkingEnabled: false,
      }),
    })
  );

  assert.equal(editResult.ok, true);
  assert.equal(llmCalls, 1);
  assert.equal(editResult.metadata?.matched_via, "llm_escape_correction");
  assert.equal(fs.readFileSync(filePath, "utf8"), 'const sequence = "\\u001B[13;130u";\n');
});

test("Edit corrects newString escaping in loose_escape fallback when LLM correction is unavailable", async () => {
  const workspace = createTempWorkspace();
  const filePath = path.join(workspace, "latex.tex");
  // LaTeX file with single-backslash commands
  fs.writeFileSync(filePath, String.raw`\alpha + \beta = \gamma` + "\n", "utf8");

  const sessionId = "loose-escape-newstring-fix";
  const snippet = await readSnippet(filePath, sessionId, workspace);

  // Simulate LLM over-escaping (doubled backslashes), no LLM client available for correction
  const editResult = await handleEditTool(
    {
      snippet_id: snippet.id,
      old_string: String.raw`\\alpha + \\beta`,
      new_string: String.raw`\\delta + \\epsilon`,
    },
    createContext(sessionId, workspace)
  );

  assert.equal(editResult.ok, true);
  assert.equal(editResult.metadata?.matched_via, "loose_escape");
  assert.equal(fs.readFileSync(filePath, "utf8"), String.raw`\delta + \epsilon = \gamma` + "\n");
});

test("Edit corrects newString escaping in loose_escape fallback for over-escaped LaTeX accent", async () => {
  const workspace = createTempWorkspace();
  const filePath = path.join(workspace, "latex2.tex");
  // LaTeX accent command: H\"{o}tel — backslash before double-quote
  fs.writeFileSync(filePath, String.raw`H\"{o}tel is nice` + "\n", "utf8");

  const sessionId = "loose-escape-accent";
  const snippet = await readSnippet(filePath, sessionId, workspace);

  // LLM over-escaped both the backslash AND the quote: H\\\"{o}tel
  const editResult = await handleEditTool(
    {
      snippet_id: snippet.id,
      old_string: String.raw`H\\\"{o}tel`,
      new_string: String.raw`M\\\"{u}nchen`,
    },
    createContext(sessionId, workspace)
  );

  assert.equal(editResult.ok, true);
  assert.equal(editResult.metadata?.matched_via, "loose_escape");
  assert.equal(fs.readFileSync(filePath, "utf8"), String.raw`M\"{u}nchen is nice` + "\n");
});

test("Edit strips accidental read-result tabs after newlines when that creates a unique match", async () => {
  const workspace = createTempWorkspace();
  const filePath = path.join(workspace, "tabs.ts");
  fs.writeFileSync(filePath, ["function demo() {", "  return 1;", "}"].join("\n") + "\n", "utf8");

  const sessionId = "line-leading-tab-correction";
  const snippet = await readSnippet(filePath, sessionId, workspace);

  const editResult = await handleEditTool(
    {
      snippet_id: snippet.id,
      old_string: "function demo() {\n\t  return 1;\n\t}",
      new_string: "function demo() {\n\t  return 2;\n\t}",
    },
    createContext(sessionId, workspace)
  );

  assert.equal(editResult.ok, true);
  assert.equal(editResult.metadata?.matched_via, "line_leading_tab_correction");
  assert.equal(fs.readFileSync(filePath, "utf8"), ["function demo() {", "  return 2;", "}"].join("\n") + "\n");
});

test("Write repairs JSON object content for .json files", async () => {
  const workspace = createTempWorkspace();
  const filePath = path.join(workspace, "package.json");

  const writeResult = await handleWriteTool(
    {
      file_path: filePath,
      content: {
        name: "demo",
        private: true,
      } as unknown as string,
    },
    createContext("write-json-object", workspace)
  );

  assert.equal(writeResult.ok, true);
  assert.equal(writeResult.metadata?.type, "create");
  assert.equal(writeResult.metadata?.file_path, filePath);
  assert.equal(writeResult.metadata?.cache_refreshed, true);
  assert.equal(writeResult.metadata?.line_endings, "LF");
  assert.equal(writeResult.metadata?.input_repaired, true);
  assert.match(String(writeResult.metadata?.diff_preview ?? ""), /\+\s*"name": "demo"|^\+\{/m);
  assert.equal(fs.readFileSync(filePath, "utf8"), '{\n  "name": "demo",\n  "private": true\n}');
});

test("Edit requires snippet_id even after Write refreshes file state", async () => {
  const workspace = createTempWorkspace();
  const filePath = path.join(workspace, "note.txt");

  const writeResult = await handleWriteTool(
    {
      file_path: filePath,
      content: "alpha\nbeta\n",
    },
    createContext("write-then-edit", workspace)
  );

  assert.equal(writeResult.ok, true);
  assert.equal(writeResult.metadata?.type, "create");
  assert.equal(writeResult.metadata?.cache_refreshed, true);

  const editResult = await handleEditTool(
    {
      file_path: filePath,
      old_string: "beta",
      new_string: "gamma",
    },
    createContext("write-then-edit", workspace)
  );

  assert.equal(editResult.ok, false);
  assert.match(editResult.error ?? "", /snippet_id/);
  assert.equal(fs.readFileSync(filePath, "utf8"), "alpha\nbeta\n");
});

test("Edit allows empty old_string when the file is empty", async () => {
  const workspace = createTempWorkspace();
  const filePath = path.join(workspace, "empty-edit.txt");
  fs.writeFileSync(filePath, "", "utf8");

  const sessionId = "edit-empty-existing";
  const snippet = await readSnippet(filePath, sessionId, workspace);

  const editResult = await handleEditTool(
    {
      snippet_id: snippet.id,
      old_string: "",
      new_string: "initialized\n",
    },
    createContext(sessionId, workspace)
  );

  assert.equal(editResult.ok, true);
  assert.equal(editResult.metadata?.matched_via, "empty_file");
  assert.equal(editResult.metadata?.replaced_count, 1);
  assert.match(String(editResult.metadata?.diff_preview ?? ""), /\+initialized/);
  assert.equal(fs.readFileSync(filePath, "utf8"), "initialized\n");
});

test("Edit rejects empty old_string when the file is not empty", async () => {
  const workspace = createTempWorkspace();
  const filePath = path.join(workspace, "non-empty-edit.txt");
  fs.writeFileSync(filePath, "alpha\n", "utf8");

  const sessionId = "edit-empty-old-string-non-empty-file";
  const snippet = await readSnippet(filePath, sessionId, workspace);

  const editResult = await handleEditTool(
    {
      snippet_id: snippet.id,
      old_string: "",
      new_string: "initialized\n",
    },
    createContext(sessionId, workspace)
  );

  assert.equal(editResult.ok, false);
  assert.equal(editResult.error, "old_string must not be empty unless the file is empty.");
  assert.equal(fs.readFileSync(filePath, "utf8"), "alpha\n");
});

test("Write requires a full read before overwriting an existing file", async () => {
  const workspace = createTempWorkspace();
  const filePath = path.join(workspace, "config.txt");
  fs.writeFileSync(filePath, "line1\nline2\nline3\n", "utf8");

  const sessionId = "write-full-read";
  await handleReadTool({ file_path: filePath, offset: 2, limit: 1 }, createContext(sessionId, workspace));

  const blockedResult = await handleWriteTool(
    {
      file_path: filePath,
      content: "rewritten",
    },
    createContext(sessionId, workspace)
  );

  assert.equal(blockedResult.ok, false);
  assert.equal(blockedResult.error, "Must read the full existing file before writing.");
});

test("Write can overwrite an existing empty file without a prior read", async () => {
  const workspace = createTempWorkspace();
  const filePath = path.join(workspace, "empty.txt");
  fs.writeFileSync(filePath, "", "utf8");

  const writeResult = await handleWriteTool(
    {
      file_path: filePath,
      content: "initialized\n",
    },
    createContext("write-empty-existing", workspace)
  );

  assert.equal(writeResult.ok, true);
  assert.equal(writeResult.metadata?.type, "update");
  assert.equal(writeResult.metadata?.cache_refreshed, true);
  assert.match(String(writeResult.metadata?.diff_preview ?? ""), /\+initialized/);
  assert.equal(fs.readFileSync(filePath, "utf8"), "initialized\n");
});

test("Edit rejects stale reads after the file changes on disk", async () => {
  const workspace = createTempWorkspace();
  const filePath = path.join(workspace, "stale.txt");
  fs.writeFileSync(filePath, "before\n", "utf8");

  const sessionId = "stale-edit";
  const snippet = await readSnippet(filePath, sessionId, workspace);

  fs.writeFileSync(filePath, "after\n", "utf8");
  const futureTime = new Date(Date.now() + 2000);
  fs.utimesSync(filePath, futureTime, futureTime);

  const editResult = await handleEditTool(
    {
      snippet_id: snippet.id,
      old_string: "after",
      new_string: "final",
    },
    createContext(sessionId, workspace)
  );

  assert.equal(editResult.ok, false);
  assert.equal(editResult.error, "File has been modified since read. Read it again before editing.");
});

test("Write preserves the exact trailing newline policy from the provided content", async () => {
  const workspace = createTempWorkspace();
  const filePath = path.join(workspace, "newline.txt");

  const writeResult = await handleWriteTool(
    {
      file_path: filePath,
      content: "no trailing newline",
    },
    createContext("write-no-newline", workspace)
  );

  assert.equal(writeResult.ok, true);
  assert.match(String(writeResult.metadata?.diff_preview ?? ""), /\+no trailing newline/);
  assert.equal(fs.readFileSync(filePath, "utf8"), "no trailing newline");
});

test("Edit preserves CRLF line endings for existing files", async () => {
  const workspace = createTempWorkspace();
  const filePath = path.join(workspace, "windows.txt");
  fs.writeFileSync(filePath, "alpha\r\nbeta\r\n", "utf8");

  const sessionId = "crlf-edit";
  const snippet = await readSnippet(filePath, sessionId, workspace);

  const editResult = await handleEditTool(
    {
      snippet_id: snippet.id,
      old_string: "beta",
      new_string: "gamma",
    },
    createContext(sessionId, workspace)
  );

  assert.equal(editResult.ok, true);
  assert.equal(editResult.metadata?.line_endings, "CRLF");
  assert.equal(fs.readFileSync(filePath, "utf8"), "alpha\r\ngamma\r\n");
});

test("Read returns an acknowledgement for images and attaches the image as a follow-up system message", async () => {
  const workspace = createTempWorkspace();
  const filePath = path.join(workspace, "pixel.png");
  fs.writeFileSync(
    filePath,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0X8AAAAASUVORK5CYII=",
      "base64"
    )
  );

  const readResult = await handleReadTool({ file_path: filePath }, createContext("image-read", workspace));

  assert.equal(readResult.ok, true);
  assert.equal(readResult.output, "File loaded.");
  assert.equal(readResult.metadata?.mime, "image/png");
  assert.equal(Array.isArray(readResult.followUpMessages), true);
  assert.equal(readResult.followUpMessages?.length, 1);

  const followUpMessage = readResult.followUpMessages?.[0];
  assert.equal(followUpMessage?.role, "system");
  assert.match(followUpMessage?.content ?? "", /pixel\.png/);
  const contentParams = Array.isArray(followUpMessage?.contentParams) ? followUpMessage.contentParams : [];
  assert.equal(contentParams.length, 1);
  assert.equal((contentParams[0] as { type?: unknown }).type, "image_url");
  assert.match(
    String((contentParams[0] as { image_url?: { url?: unknown } }).image_url?.url ?? ""),
    /^data:image\/png;base64,/
  );
});

function createContext(
  sessionId: string,
  projectRoot: string,
  overrides: Partial<ToolExecutionContext> = {}
): ToolExecutionContext {
  return {
    sessionId,
    projectRoot,
    toolCall: {
      id: "test-tool-call",
      type: "function",
      function: {
        name: "test",
        arguments: "{}",
      },
    },
    ...overrides,
  };
}

function createTempWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "deepcode-tools-"));
  tempDirs.push(dir);
  return dir;
}

async function readSnippet(
  filePath: string,
  sessionId: string,
  workspace: string
): Promise<{ id: string; startLine: number; endLine: number }> {
  const readResult = await handleReadTool({ file_path: filePath }, createContext(sessionId, workspace));
  assert.equal(readResult.ok, true);
  const snippet = (readResult.metadata?.snippet ?? null) as {
    id: string;
    startLine: number;
    endLine: number;
  } | null;
  assert.ok(snippet);
  return snippet;
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await delay(25);
  }
  assert.equal(predicate(), true);
}
