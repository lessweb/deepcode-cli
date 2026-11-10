// A real stdio server that can ignore cancellation and send late responses.
export const MCP_TEST_SERVER = `
const readline = require("node:readline");
const calls = [];
const cancelled = [];
let pending;
const send = message => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\\n");
const reply = (id, text) => send({ id, result: { content: [{ type: "text", text }] } });
readline.createInterface({ input: process.stdin }).on("line", line => {
  const request = JSON.parse(line);
  if (request.method === "notifications/cancelled") {
    cancelled.push(request.params.requestId);
    send({ method: "test/cancelled", params: request.params });
    return;
  }
  if (!("id" in request)) return;
  if (request.method === "initialize") {
    send({ id: request.id, result: { protocolVersion: "2025-03-26", capabilities: {} } });
  } else if (request.method === "tools/list") {
    send({ id: request.id, result: { tools: [{ name: "hang", inputSchema: { type: "object" } }] } });
  } else if (request.method === "tools/call") {
    calls.push(request.params.name);
    if (request.params.name === "hang") {
      pending = request.id;
      send({ method: "test/started", params: { requestId: request.id } });
    } else if (request.params.name === "release") {
      if (pending !== undefined) reply(pending, "late response");
      reply(request.id, "released");
    } else {
      reply(request.id, JSON.stringify({ calls, cancelled }));
    }
  } else {
    send({ id: request.id, result: { prompts: [], resources: [] } });
  }
});
`;
