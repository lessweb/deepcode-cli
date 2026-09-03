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
        baseURL: "https://api.deepseek.com",
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
      baseURL: "https://example.com/v1",
      client: fakeClient,
      machineId: "machine-id-123",
      plusApiKey: "sk-plus-test",
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
  assert.equal((fetchCalls[0].init?.headers as Record<string, string>)["PLUS-API-KEY"], "sk-plus-test");
});

test("WebSearch reports and records a default API rate limit error", async () => {
  const workspace = createTempWorkspace();
  const rateLimitedTools: string[] = [];
  let requestHeaders: RequestInit["headers"];
  const fakeClient = {
    chat: {
      completions: {
        create: async () => ({
          choices: [
            {
              message: {
                content: '{"dominant_language":"en","reason":"English sources are more useful."}',
              },
            },
          ],
        }),
      },
    },
  } as unknown as OpenAI;
  globalThis.fetch = (async (_input: string | URL, init?: RequestInit) => {
    requestHeaders = init?.headers;
    return new Response(JSON.stringify({ success: false, reason: "WebSearch rate limit exceeded." }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  const result = await handleWebSearchTool(
    { query: "latest node release" },
    createContext(workspace, {
      baseURL: "https://example.com/v1",
      client: fakeClient,
      machineId: "machine-id-123",
      onPluginRateLimitExceeded: (tool) => rateLimitedTools.push(tool),
    })
  );

  assert.equal(result.ok, false);
  assert.equal(result.error, "WebSearch default mode failed: WebSearch API failed: WebSearch rate limit exceeded.");
  assert.deepEqual(rateLimitedTools, ["WebSearch"]);
  assert.equal((requestHeaders as Record<string, string>)["PLUS-API-KEY"], undefined);
});

test("WebSearch matches rate limit errors case-sensitively", async () => {
  const workspace = createTempWorkspace();
  const rateLimitedTools: string[] = [];
  const fakeClient = {
    chat: {
      completions: {
        create: async () => ({
          choices: [
            {
              message: {
                content: '{"dominant_language":"en","reason":"English sources are more useful."}',
              },
            },
          ],
        }),
      },
    },
  } as unknown as OpenAI;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ success: false, reason: "WebSearch Rate limit exceeded." }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;

  await handleWebSearchTool(
    { query: "latest node release" },
    createContext(workspace, {
      baseURL: "https://example.com/v1",
      client: fakeClient,
      machineId: "machine-id-123",
      onPluginRateLimitExceeded: (tool) => rateLimitedTools.push(tool),
    })
  );

  assert.deepEqual(rateLimitedTools, []);
});

test("WebSearch accepts a completed DeepSeek response with partial web search failures", async () => {
  const workspace = createTempWorkspace();
  const starts: Array<{ id: string | number; command: string }> = [];
  const exits: Array<string | number> = [];
  const responseRequests: Array<Record<string, unknown>> = [];

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
          if (prompt.includes("Translate the query text below into English.")) {
            return { choices: [{ message: { content: "latest Node.js release" } }] };
          }
          throw new Error(`Unexpected chat prompt: ${prompt}`);
        },
      },
    },
    responses: {
      create: async (request: Record<string, unknown>) => {
        responseRequests.push(request);
        return {
          status: "completed",
          output: [
            { type: "web_search_call", status: "completed" },
            { type: "web_search_call", status: "failed" },
          ],
          output_text: "Node.js 24 is the latest release.",
        };
      },
    },
  } as unknown as OpenAI;

  const result = await handleWebSearchTool(
    { query: "Node.js 最新版本" },
    createContext(workspace, {
      client: fakeClient,
      model: "configured-model",
      baseURL: "https://api.deepseek.com",
      onProcessStart: (id, command) => starts.push({ id, command }),
      onProcessExit: (id) => exits.push(id),
    })
  );

  assert.equal(result.ok, true);
  assert.equal(result.output, "Node.js 24 is the latest release.");
  assert.equal(result.metadata?.originalQuery, "Node.js 最新版本");
  assert.equal(result.metadata?.resolvedQuery, "latest Node.js release");
  assert.equal(result.metadata?.translated, true);
  assert.deepEqual(responseRequests, [
    {
      model: "deepseek-v4-flash",
      input: "latest Node.js release",
      tools: [{ type: "web_search" }],
      tool_choice: "required",
    },
  ]);
  assert.equal(starts.length, 1);
  assert.equal(starts[0].command, "WebSearch: latest Node.js release");
  assert.deepEqual(exits, [starts[0].id]);
});

test("WebSearch treats an incomplete empty DeepSeek response as a successful empty result", async () => {
  const workspace = createTempWorkspace();
  const fakeClient = {
    chat: {
      completions: {
        create: async () => ({
          choices: [
            {
              message: {
                content: '{"dominant_language":"en","reason":"English sources are more useful."}',
              },
            },
          ],
        }),
      },
    },
    responses: {
      create: async () => ({
        status: "incomplete",
        output: [],
        output_text: "  ",
      }),
    },
  } as unknown as OpenAI;

  const result = await handleWebSearchTool(
    { query: "latest node release" },
    createContext(workspace, {
      client: fakeClient,
      baseURL: "https://api.deepseek.com",
    })
  );

  assert.equal(result.ok, true);
  assert.equal(result.output, "No web search results were returned.");
});

test("WebSearch rejects DeepSeek request and provider failures", async () => {
  const responseCases = [
    {
      response: null,
      requestError: new Error("network unavailable"),
      error: "WebSearch default mode failed: network unavailable",
    },
    {
      response: null,
      requestError: new Error("429 rate limit exceeded"),
      error: "WebSearch default mode failed: 429 rate limit exceeded",
    },
    {
      response: {
        status: "failed",
        output: [{ type: "web_search_call", status: "completed" }],
        output_text: "A failed response.",
      },
      error: "WebSearch default mode failed: DeepSeek Responses API returned status failed.",
    },
  ];

  for (const responseCase of responseCases) {
    const workspace = createTempWorkspace();
    const starts: Array<{ id: string | number; command: string }> = [];
    const exits: Array<string | number> = [];
    const fakeClient = {
      chat: {
        completions: {
          create: async () => ({
            choices: [
              {
                message: {
                  content: '{"dominant_language":"en","reason":"English sources are more useful."}',
                },
              },
            ],
          }),
        },
      },
      responses: {
        create: async () => {
          if (responseCase.requestError) {
            throw responseCase.requestError;
          }
          return responseCase.response;
        },
      },
    } as unknown as OpenAI;

    const result = await handleWebSearchTool(
      { query: "latest node release" },
      createContext(workspace, {
        client: fakeClient,
        baseURL: "https://api.deepseek.com",
        onProcessStart: (id, command) => starts.push({ id, command }),
        onProcessExit: (id) => exits.push(id),
      })
    );

    assert.equal(result.ok, false);
    assert.equal(result.error, responseCase.error);
    assert.equal(starts.length, 1);
    assert.deepEqual(exits, [starts[0].id]);
  }
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

test("WebSearch executes a configured .bat script on Windows", { skip: process.platform !== "win32" }, async () => {
  const workspace = createTempWorkspace();
  const scriptPath = path.join(workspace, "web-search.bat");
  fs.writeFileSync(scriptPath, "@echo off\r\necho query=%1\r\n", "utf8");

  const result = await handleWebSearchTool({ query: "test" }, createContext(workspace, { webSearchTool: scriptPath }));

  assert.equal(result.ok, true);
  assert.match(result.output ?? "", /query=test/);
});

function createContext(
  projectRoot: string,
  options: {
    client?: OpenAI | null;
    model?: string;
    baseURL?: string;
    webSearchTool?: string;
    env?: Record<string, string>;
    machineId?: string;
    plusApiKey?: string;
    onProcessStart?: (processId: string | number, command: string) => void;
    onProcessExit?: (processId: string | number) => void;
    onPluginRateLimitExceeded?: ToolExecutionContext["onPluginRateLimitExceeded"];
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
      model: options.model ?? "test-model",
      baseURL: options.baseURL,
      thinkingEnabled: false,
      webSearchTool: options.webSearchTool,
      env: options.env,
      machineId: options.machineId,
      plusApiKey: options.plusApiKey,
    }),
    onProcessStart: options.onProcessStart,
    onProcessExit: options.onProcessExit,
    onPluginRateLimitExceeded: options.onPluginRateLimitExceeded,
  };
}

function createTempWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "deepcode-web-search-"));
  tempDirs.push(dir);
  return dir;
}
