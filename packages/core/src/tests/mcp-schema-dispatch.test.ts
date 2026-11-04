import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Ajv from "ajv";
import { McpManager } from "../mcp/mcp-manager";
import { getTools } from "../prompt";

test("MCP tuple tools validate before dispatch, preserve arguments, and refresh validators with tools/list", async (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), "deepcode-mcp-schema-"));
  const serverPath = path.join(directory, "server.cjs");
  writeFileSync(
    serverPath,
    `
const readline = require("node:readline");
let firstType = "string";
let calls = 0;
const send = message => process.stdout.write(JSON.stringify(message) + "\\n");
const schema = () => ({
  type: "object",
  required: ["pair"],
  additionalProperties: false,
  properties: {
    pair: { $ref: "#/$defs/Pair" },
    optional: { type: "string", default: "must not insert" }
  },
  $defs: {
    Pair: { type: "array", items: [{ type: firstType }, { type: "integer" }], additionalItems: false, minItems: 2 }
  }
});
readline.createInterface({ input: process.stdin }).on("line", line => {
  const request = JSON.parse(line);
  if (!("id" in request)) return;
  let result;
  if (request.method === "initialize") {
    result = { protocolVersion: "2025-03-26", capabilities: { tools: { listChanged: true } } };
  } else if (request.method === "tools/list") {
    result = { tools: [
      { name: "tuple.tool", inputSchema: schema() },
      { name: "broken", inputSchema: { ...schema(), allOf: [{ $ref: "#/$defs/Missing" }] } },
      { name: "ordinary", inputSchema: { type: "object", properties: { number: { type: "integer" } } } },
      { name: "refresh", inputSchema: { type: "object", properties: {} } },
      { name: "reject", inputSchema: { type: "object", properties: {} } }
    ] };
  } else if (request.method === "tools/call") {
    calls++;
    result = { content: [{ type: "text", text: JSON.stringify({ calls, ...request.params }) }] };
    if (request.params.name === "refresh") firstType = "boolean";
    if (request.params.name === "reject") result.isError = true;
  } else {
    result = { prompts: [], resources: [] };
  }
  send({ jsonrpc: "2.0", id: request.id, result });
  if (request.method === "tools/call" && request.params.name === "refresh") {
    send({ jsonrpc: "2.0", method: "notifications/tools/list_changed" });
  }
});
`,
    "utf8"
  );
  const manager = new McpManager();
  t.after(() => {
    manager.disconnect();
    rmSync(directory, { recursive: true, force: true });
  });
  await manager.initialize({ probe: { command: process.execPath, args: [serverPath] } });
  assert.equal(manager.getStatus()[0].status, "ready");

  // Validation must also work before anyone asks for the model's tool definitions.
  const name = "mcp__probe__tuple_tool";
  const reversed = { pair: [1, "x"] };
  const rejected = await manager.executeMcpTool(name, reversed);
  assert.equal(rejected.ok, false);
  assert.match(rejected.error!, /Invalid MCP tool arguments/);
  assert.deepEqual(reversed, { pair: [1, "x"] });

  const wire = JSON.parse(JSON.stringify({ tools: getTools({}, manager.getMcpToolDefinitions()) }));
  const parameters = wire.tools.find((tool: any) => tool.function.name === name).function.parameters;
  // The outgoing schema is accepted by a JSON Schema validator, resolves its
  // references, and represents tuple members as an object-form items schema.
  assert.equal(Array.isArray(parameters.$defs.Pair.items), false);
  assert.equal(new Ajv({ strict: false }).validate(parameters, reversed), true);

  for (const args of [{ pair: ["x", "1"] }, { pair: ["x", 1], extra: true }, { pair: ["x", 1, 2] }]) {
    const copy = structuredClone(args);
    assert.equal((await manager.executeMcpTool(name, args)).ok, false);
    assert.deepEqual(args, copy);
  }
  const broken = await manager.executeMcpTool("mcp__probe__broken", { pair: ["x", 1] });
  assert.equal(broken.ok, false);
  assert.match(broken.error!, /Cannot validate MCP tool arguments/);

  const args = { pair: ["x", 1] };
  const accepted = await manager.executeMcpTool(name, args);
  assert.equal(accepted.ok, true);
  assert.deepEqual(JSON.parse(accepted.output!), { calls: 1, name: "tuple.tool", arguments: args });
  assert.deepEqual(args, { pair: ["x", 1] });

  // Existing tools without tuple conversion still delegate argument validation
  // to their server, and server-reported errors remain errors.
  const ordinary = await manager.executeMcpTool("mcp__probe__ordinary", { number: "unchanged" });
  assert.equal(ordinary.ok, true);
  assert.deepEqual(JSON.parse(ordinary.output!).arguments, { number: "unchanged" });
  assert.equal((await manager.executeMcpTool("mcp__probe__reject", {})).ok, false);

  const refreshed = new Promise<void>((resolve) => manager.setOnToolsListChanged(resolve));
  assert.equal((await manager.executeMcpTool("mcp__probe__refresh", {})).ok, true);
  await refreshed;
  assert.equal((await manager.executeMcpTool(name, { pair: ["x", 1] })).ok, false);
  const afterRefresh = await manager.executeMcpTool(name, { pair: [true, 1] });
  assert.equal(afterRefresh.ok, true);
  assert.deepEqual(JSON.parse(afterRefresh.output!), {
    calls: 5,
    name: "tuple.tool",
    arguments: { pair: [true, 1] },
  });
});
