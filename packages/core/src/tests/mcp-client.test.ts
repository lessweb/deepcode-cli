import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createMcpClient, createMcpSpawnSpec } from "../mcp/mcp-client";

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
  const client = createMcpClient("probe", { command: "mcp-probe", args: [] });

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

test("McpClient connects to a Streamable HTTP server and echoes the session id", async () => {
  const SESSION_ID = "sess-123";
  const seenSessionIds: Array<string | undefined> = [];

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const message = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const sessionHeader = req.headers["mcp-session-id"];
      seenSessionIds.push(Array.isArray(sessionHeader) ? sessionHeader[0] : sessionHeader);

      // Notifications (no id) are acknowledged with 202 and no body.
      if (message.id === undefined) {
        res.writeHead(202).end();
        return;
      }

      if (message.method === "initialize") {
        // Single JSON response branch + session assignment via header.
        res.writeHead(200, {
          "content-type": "application/json",
          "mcp-session-id": SESSION_ID,
        });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: message.id,
            result: {
              protocolVersion: "2025-03-26",
              capabilities: {},
              serverInfo: { name: "remote", version: "1.0.0" },
            },
          })
        );
        return;
      }

      if (message.method === "tools/list") {
        // SSE response branch: the JSON-RPC response is delivered as one event.
        res.writeHead(200, { "content-type": "text/event-stream" });
        const payload = JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result: { tools: [{ name: "remote_tool", inputSchema: { type: "object", properties: {} } }] },
        });
        res.end(`event: message\ndata: ${payload}\n\n`);
        return;
      }

      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: {} }));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const client = createMcpClient("remote", { type: "http", url: `http://127.0.0.1:${port}/mcp` });

  try {
    await client.connect(5_000);
    const tools = await client.listTools(5_000);
    assert.deepEqual(
      tools.map((tool) => tool.name),
      ["remote_tool"]
    );
    // initialize carries no session id; every request after the handshake must echo it.
    assert.equal(seenSessionIds[0], undefined);
    assert.ok(
      seenSessionIds.slice(1).every((id) => id === SESSION_ID),
      `expected later requests to carry session id, saw ${JSON.stringify(seenSessionIds)}`
    );
  } finally {
    client.disconnect();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
