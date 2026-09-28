import { test } from "node:test";
import assert from "node:assert/strict";
import { McpManager } from "../mcp/mcp-manager";

// CONCURRENCY in initialize() mirrors the batch size asserted below.
const BATCH_SIZE = 5;

function stubConnect(manager: McpManager, onStart?: (name: string) => void) {
  const started: string[] = [];
  let inFlight = 0;
  let peak = 0;

  // Probe the scheduler instead of spawning real MCP processes: recording the
  // in-flight count proves batching without depending on wall-clock timing.
  (manager as any).connectServer = async (name: string) => {
    started.push(name);
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    onStart?.(name);
    await new Promise((resolve) => setTimeout(resolve, 20));
    inFlight -= 1;
  };

  return {
    started,
    peak: () => peak,
  };
}

const servers = Object.fromEntries(
  Array.from({ length: 12 }, (_, index) => [`server-${index}`, { command: "node", args: ["-e", ""] }])
);

test("initialize connects MCP servers in bounded parallel batches", async () => {
  const manager = new McpManager();
  const probe = stubConnect(manager);

  await manager.initialize(servers);

  assert.equal(probe.started.length, Object.keys(servers).length);
  assert.ok(probe.peak() > 1, `expected overlapping connections, saw peak=${probe.peak()}`);
  assert.ok(
    probe.peak() <= BATCH_SIZE,
    `expected at most ${BATCH_SIZE} concurrent connections, saw peak=${probe.peak()}`
  );
});

test("initialize starts no further batch once disposed", async () => {
  const manager = new McpManager();
  let firstBatch = 0;
  const probe = stubConnect(manager, () => {
    firstBatch += 1;
    if (firstBatch === BATCH_SIZE) {
      manager.disconnect();
    }
  });

  await manager.initialize(servers);

  assert.ok(probe.started.length > 0, "expected the first batch to start");
  assert.ok(
    probe.started.length <= BATCH_SIZE,
    `expected no batch after disconnect, saw ${probe.started.length} servers started`
  );
});
