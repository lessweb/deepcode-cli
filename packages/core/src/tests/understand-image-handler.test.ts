import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { ToolExecutionContext } from "../tools/executor";
import { handleUnderstandImageTool } from "../tools/understand-image-handler";

const originalFetch = globalThis.fetch;
const tempDirs: string[] = [];

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("UnderstandImage uploads prompt and image to the default API", async () => {
  const workspace = createTempDir("deepcode-understand-image-");
  const imagePath = path.join(workspace, "pixel.png");
  fs.writeFileSync(imagePath, Buffer.from([1, 2, 3]));
  const starts: Array<{ id: string | number; command: string }> = [];
  const exits: Array<string | number> = [];
  let request: { input: string | URL; init?: RequestInit } | undefined;

  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    request = { input, init };
    return new Response(JSON.stringify({ success: true, result: "a tiny test image" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  const result = await handleUnderstandImageTool(
    { prompt: "Describe it", image_path: imagePath },
    createContext(workspace, {
      onProcessStart: (id, command) => starts.push({ id, command }),
      onProcessExit: (id) => exits.push(id),
    })
  );

  assert.equal(result.ok, true);
  assert.equal(result.output, "a tiny test image");
  assert.equal(String(request?.input), "https://deepcode.vegamo.cn/api/plugin/understand-image");
  assert.equal(request?.init?.method, "POST");
  assert.equal((request?.init?.headers as Record<string, string>).Token, "machine-id-123");
  const form = request?.init?.body as FormData;
  assert.equal(form.get("prompt"), "Describe it");
  const image = form.get("image") as File;
  assert.equal(image.name, "pixel.png");
  assert.equal(image.type, "image/png");
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), Buffer.from([1, 2, 3]));
  assert.equal(starts[0]?.command, "UnderstandImage: pixel.png");
  assert.deepEqual(exits, [starts[0]?.id]);
});

test("UnderstandImage reports an HTTP 200 business error", async () => {
  const workspace = createTempDir("deepcode-understand-image-error-");
  const imagePath = path.join(workspace, "pixel.webp");
  fs.writeFileSync(imagePath, Buffer.from([1]));
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ success: false, reason: "UnderstandImage rate limit exceeded." }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;

  const result = await handleUnderstandImageTool(
    { prompt: "Describe it", image_path: imagePath },
    createContext(workspace)
  );

  assert.equal(result.ok, false);
  assert.equal(result.error, "UnderstandImage API failed: UnderstandImage rate limit exceeded.");
});

test("UnderstandImage validates absolute paths, formats, and size before fetching", async () => {
  const workspace = createTempDir("deepcode-understand-image-validation-");
  const unsupportedPath = path.join(workspace, "pixel.gif");
  const emptyPath = path.join(workspace, "empty.png");
  const oversizedPath = path.join(workspace, "oversized.jpg");
  fs.writeFileSync(unsupportedPath, Buffer.from([1]));
  fs.writeFileSync(emptyPath, Buffer.alloc(0));
  fs.writeFileSync(oversizedPath, Buffer.alloc(1));
  fs.truncateSync(oversizedPath, 10 * 1024 * 1024 + 1);
  let fetchCount = 0;
  globalThis.fetch = (async () => {
    fetchCount += 1;
    return new Response();
  }) as typeof fetch;

  const relative = await handleUnderstandImageTool(
    { prompt: "Describe it", image_path: "pixel.png" },
    createContext(workspace)
  );
  const unsupported = await handleUnderstandImageTool(
    { prompt: "Describe it", image_path: unsupportedPath },
    createContext(workspace)
  );
  const empty = await handleUnderstandImageTool(
    { prompt: "Describe it", image_path: emptyPath },
    createContext(workspace)
  );
  const oversized = await handleUnderstandImageTool(
    { prompt: "Describe it", image_path: oversizedPath },
    createContext(workspace)
  );

  assert.match(relative.error ?? "", /absolute path/);
  assert.match(unsupported.error ?? "", /Only JPEG, PNG, and WebP/);
  assert.match(empty.error ?? "", /must not be empty/);
  assert.match(oversized.error ?? "", /exceeds the 10 MiB limit/);
  assert.equal(fetchCount, 0);
});

function createContext(
  projectRoot: string,
  hooks: Pick<ToolExecutionContext, "onProcessStart" | "onProcessExit"> = {}
): ToolExecutionContext {
  return {
    sessionId: "understand-image-test",
    projectRoot,
    toolCall: {
      id: "tool-call-id",
      type: "function",
      function: { name: "UnderstandImage", arguments: "{}" },
    },
    createOpenAIClient: () => ({
      client: null,
      model: "deepseek-chat",
      thinkingEnabled: false,
      machineId: "machine-id-123",
    }),
    ...hooks,
  };
}

function createTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
