import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type OpenAI from "openai";
import type { ToolExecutionContext } from "../tools/executor";
import { handleWebSearchTool } from "../tools/web-search-handler";

const tempDirs: string[] = [];
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

test(
  "WebSearch executes the configured script with the query as one argument",
  { skip: process.platform === "win32" },
  async () => {
    const workspace = createTempWorkspace();
    const scriptPath = path.join(workspace, "web-search.sh");
    fs.writeFileSync(
      scriptPath,
      [
        "#!/bin/sh",
        "printf 'query=%s\\n' \"$1\"",
        "printf 'cwd=%s\\n' \"$PWD\"",
        "printf 'webhook=%s\\n' \"$WEBHOOK\"",
      ].join("\n"),
      "utf8"
    );
    fs.chmodSync(scriptPath, 0o755);

    const starts: Array<{ id: string | number; command: string }> = [];
    const exits: Array<string | number> = [];
    const result = await handleWebSearchTool(
      { query: "latest node release" },
      createContext(workspace, {
        webSearchTool: scriptPath,
        env: { WEBHOOK: "configured" },
        onProcessStart: (id, command) => starts.push({ id, command }),
        onProcessExit: (id) => exits.push(id),
      })
    );
    const realWorkspace = fs.realpathSync(workspace);

    assert.equal(result.ok, true);
    assert.equal(result.output, `query=latest node release\ncwd=${realWorkspace}\nwebhook=configured\n`);
    assert.equal(starts.length, 1);
    assert.match(starts[0].command, /^WebSearch: latest node release$/);
    assert.deepEqual(exits, [starts[0].id]);
  }
);

test("WebSearch uses the default API when no script is configured", async () => {
  const workspace = createTempWorkspace();
  const starts: Array<{ id: string | number; command: string }> = [];
  const exits: Array<string | number> = [];
  const fetchCalls: Array<{ input: string | URL; init?: RequestInit }> = [];

  const fakeClient = {
    chat: {
      completions: {
        create: async ({ messages }: { messages: Array<{ content: string }> }) => {
          const prompt = messages[0]?.content ?? "";
          if (prompt.includes("Return strict JSON:")) {
            return {
              choices: [
                {
                  message: {
                    content:
                      '{"dominant_language":"en","reason":"Most Node.js release notes are published in English."}',
                  },
                },
              ],
            };
          }
          throw new Error(`Unexpected chat prompt: ${prompt}`);
        },
      },
    },
  } as unknown as OpenAI;

  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    fetchCalls.push({ input, init });
    return {
      ok: true,
      json: async () => ({
        success: true,
        result: JSON.stringify(
          {
            organic_results: [
              {
                title: "Node.js Releases",
                link: "https://nodejs.org/en/about/previous-releases",
              },
            ],
          },
          null,
          2
        ),
      }),
    } as Response;
  }) as typeof fetch;

  const result = await handleWebSearchTool(
    { query: "latest node release" },
    createContext(workspace, {
      client: fakeClient,
      machineId: "machine-id-123",
      onProcessStart: (id, command) => starts.push({ id, command }),
      onProcessExit: (id) => exits.push(id),
    })
  );

  assert.equal(result.ok, true);
  assert.match(result.output ?? "", /Node\.js Releases/);
  assert.equal(result.metadata?.resolvedQuery, "latest node release");
  assert.equal(starts.length, 1);
  assert.equal(starts[0].id, exits[0]);
  assert.equal(starts[0].command, "WebSearch: latest node release");
  assert.equal(fetchCalls.length, 1);
  assert.equal(String(fetchCalls[0].input), "https://deepcode.vegamo.cn/api/plugin/web-search");
  assert.equal(fetchCalls[0].init?.method, "POST");
  assert.deepEqual(JSON.parse(String(fetchCalls[0].init?.body)), { query: "latest node release" });
  assert.equal((fetchCalls[0].init?.headers as Record<string, string>).Token, "machine-id-123");
});

test("WebSearch returns a configuration error when neither a script nor an LLM client is available", async () => {
  const workspace = createTempWorkspace();
  const result = await handleWebSearchTool({ query: "latest node release" }, createContext(workspace));

  assert.equal(result.ok, false);
  assert.equal(
    result.error,
    "WebSearch default mode requires a valid LLM configuration in ~/.deepcode/settings.json or ./.deepcode/settings.json."
  );
});

function createContext(
  projectRoot: string,
  options: {
    client?: OpenAI | null;
    webSearchTool?: string;
    env?: Record<string, string>;
    machineId?: string;
    onProcessStart?: (processId: string | number, command: string) => void;
    onProcessExit?: (processId: string | number) => void;
  } = {}
): ToolExecutionContext {
  return {
    sessionId: "web-search-test",
    projectRoot,
    toolCall: {
      id: "tool-call-id",
      type: "function",
      function: {
        name: "WebSearch",
        arguments: "{}",
      },
    },
    createOpenAIClient: () => ({
      client: options.client ?? null,
      model: "test-model",
      thinkingEnabled: false,
      webSearchTool: options.webSearchTool,
      env: options.env,
      machineId: options.machineId,
    }),
    onProcessStart: options.onProcessStart,
    onProcessExit: options.onProcessExit,
  };
}

function createTempWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "deepcode-web-search-"));
  tempDirs.push(dir);
  return dir;
}
