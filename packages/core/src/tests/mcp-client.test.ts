import { test, type TestContext } from "node:test";
import { getEventListeners } from "node:events";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { McpClient, createMcpSpawnSpec } from "../mcp/mcp-client";
import { McpManager } from "../mcp/mcp-manager";
import { ToolExecutor } from "../tools/executor";
import { createMcpTestServer } from "./mcp-test-server";

async function startClient(t: TestContext) {
  let started!: (params: Record<string, unknown>) => void;
  let cancelled!: (params: Record<string, unknown>) => void;
  const startedRequest = new Promise<Record<string, unknown>>((resolve) => (started = resolve));
  const cancelledRequest = new Promise<Record<string, unknown>>((resolve) => (cancelled = resolve));
  const client = new McpClient("probe", process.execPath, [createMcpTestServer(t)], undefined, (method, params) => {
    if (method === "test/started") started(params!);
    if (method === "test/cancelled") cancelled(params!);
  });
  t.after(() => client.disconnect());
  await client.connect(2_000);
  return { client, startedRequest, cancelledRequest };
}

test(
  "MCP cancellation finishes locally even when the server ignores it and later replies",
  { timeout: 5000 },
  async (t) => {
    const { client, startedRequest, cancelledRequest } = await startClient(t);
    const controller = new AbortController();
    const pending = client.callTool("hang", {}, undefined, controller.signal);
    const rejected = assert.rejects(pending, { name: "AbortError" });
    const { requestId } = await startedRequest;
    controller.abort();
    await rejected;
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
    assert.equal((await cancelledRequest).requestId, requestId);
    assert.equal((await client.callTool("release", {})).content[0].text, "released");
    const state = JSON.parse((await client.callTool("inspect", {})).content[0].text!);
    assert.deepEqual(state.cancelled, [requestId]);
    assert.equal(client.isConnected(), true, "cancelling a request must preserve the connection");
  }
);

test("MCP does not send an already cancelled call or cancel a completed call", { timeout: 5000 }, async (t) => {
  const { client } = await startClient(t);
  const controller = new AbortController();
  await client.callTool("inspect", {}, undefined, controller.signal);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  controller.abort();
  await assert.rejects(client.callTool("hang", {}, undefined, controller.signal), { name: "AbortError" });
  const state = JSON.parse((await client.callTool("inspect", {})).content[0].text!);
  assert.deepEqual(state, { calls: ["inspect", "inspect"], cancelled: [] });
});

test("MCP timeouts still reject and remove cancellation listeners", { timeout: 5000 }, async (t) => {
  const { client } = await startClient(t);
  const controller = new AbortController();
  await assert.rejects(client.callTool("hang", {}, 30, controller.signal), /Timed out after 30ms/);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  controller.abort();
  const state = JSON.parse((await client.callTool("inspect", {})).content[0].text!);
  assert.deepEqual(state.cancelled, []);
});

test("MCP disconnect rejects pending calls without waiting for process close", { timeout: 5000 }, async (t) => {
  const { client, startedRequest } = await startClient(t);
  const controller = new AbortController();
  const rejected = assert.rejects(client.callTool("hang", {}, undefined, controller.signal), /disconnected/);
  await startedRequest;
  client.disconnect();
  await rejected;
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  await assert.rejects(client.callTool("hang", {}), /not connected/);
});

test("ToolExecutor propagates MCP cancellation instead of returning a tool error", { timeout: 5000 }, async (t) => {
  const manager = new McpManager();
  t.after(() => manager.disconnect());
  await manager.initialize({ probe: { command: process.execPath, args: [createMcpTestServer(t)] } });
  assert.equal(manager.getStatus()[0]?.status, "ready", JSON.stringify(manager.getStatus()));
  const executor = new ToolExecutor(process.cwd(), undefined, manager);
  const controller = new AbortController();
  const pending = executor.executeToolCalls(
    "test",
    [{ id: "hang", function: { name: "mcp__probe__hang", arguments: "{}" } }],
    { signal: controller.signal }
  );
  const rejected = assert.rejects(pending, { name: "AbortError" });
  controller.abort();
  await rejected;
});

test("createMcpSpawnSpec keeps non-Windows MCP launches shell-free", () => {
  assert.deepEqual(createMcpSpawnSpec("npx", ["-y", "@playwright/mcp@latest"], "darwin"), {
    command: "npx",
    args: ["-y", "@playwright/mcp@latest"],
    shell: false,
  });
});

test("createMcpSpawnSpec joins args without quoting when spaces are absent (Windows)", () => {
  assert.deepEqual(createMcpSpawnSpec("npx", ["-y", "@playwright/mcp@latest"], "win32"), {
    command: "npx -y @playwright/mcp@latest",
    args: [],
    shell: true,
    windowsHide: true,
  });
});

test("createMcpSpawnSpec quotes Windows command paths and arguments", () => {
  const spec = createMcpSpawnSpec(
    String.raw`C:\Program Files\nodejs\node.exe`,
    [String.raw`C:\tmp\mcp server.cjs`, 'a "quoted" value'],
    "win32"
  );

  assert.equal(
    spec.command,
    String.raw`"C:\Program Files\nodejs\node.exe" "C:\tmp\mcp server.cjs" "a \"quoted\" value"`
  );
  assert.deepEqual(spec.args, []);
});

test("createMcpSpawnSpec quotes Windows args with cmd metacharacters", () => {
  const spec = createMcpSpawnSpec(
    "npx",
    [
      "-y",
      "some-mcp",
      "--url=https://example.test?a=1&b=2",
      "--pipe=a|b",
      "--redirect=<in>out",
      "--caret=^value",
      "--group=(value)",
    ],
    "win32"
  );

  assert.equal(
    spec.command,
    [
      "npx",
      "-y",
      "some-mcp",
      '"--url=https://example.test?a=1&b=2"',
      '"--pipe=a|b"',
      '"--redirect=<in>out"',
      '"--caret=^value"',
      '"--group=(value)"',
    ].join(" ")
  );
  assert.deepEqual(spec.args, []);
});

test("McpClient starts a PATH-resolved cmd MCP server on Windows", { skip: process.platform !== "win32" }, async () => {
  const serverDir = mkdtempSync(path.join(tmpdir(), "deepcode-mcp-probe-"));
  const originalPath = process.env.PATH;

  writeFileSync(path.join(serverDir, "mcp-probe.cmd"), '@echo off\r\nnode "%~dp0mcp-probe-server.cjs"\r\n');
  writeFileSync(
    path.join(serverDir, "mcp-probe-server.cjs"),
    [
      'const readline = require("node:readline");',
      "const rl = readline.createInterface({ input: process.stdin });",
      "function send(message) { process.stdout.write(`${JSON.stringify(message)}\\n`); }",
      'rl.on("line", (line) => {',
      "  const request = JSON.parse(line);",
      '  if (request.method === "initialize") {',
      '    send({ jsonrpc: "2.0", id: request.id, result: { protocolVersion: "2025-03-26", capabilities: {}, serverInfo: { name: "probe", version: "1.0.0" } } });',
      "    return;",
      "  }",
      '  if (request.method === "tools/list") {',
      '    send({ jsonrpc: "2.0", id: request.id, result: { tools: [{ name: "probe_tool", inputSchema: { type: "object", properties: {} } }] } });',
      "    return;",
      "  }",
      "});",
    ].join("\n")
  );

  process.env.PATH = `${serverDir}${path.delimiter}${originalPath ?? ""}`;
  const client = new McpClient("probe", "mcp-probe", []);

  try {
    await client.connect(5_000);
    const tools = await client.listTools(5_000);
    assert.deepEqual(
      tools.map((tool) => tool.name),
      ["probe_tool"]
    );
  } finally {
    client.disconnect();
    process.env.PATH = originalPath;
    rmSync(serverDir, { recursive: true, force: true });
  }
});
