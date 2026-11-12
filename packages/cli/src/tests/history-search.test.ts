import assert from "node:assert/strict";
import { test } from "node:test";
import { HistorySearch, type HistorySearchSource } from "../ui/core/history-search";
import { historyMatchRange, historySearchFooter } from "../ui/core/history-search-display";
import type { HistoryBatch } from "@vegamo/deepcode-core";

function source(texts: string[]) {
  let version = "v1";
  let reads = 0;
  const limits: Array<number | undefined> = [];
  const provider: HistorySearchSource = {
    revision: async () => version,
    read: async (cursor, maxRows) => {
      reads++;
      limits.push(maxRows);
      const position = cursor?.position ?? texts.length;
      const start = Math.max(0, position - (maxRows ?? 128));
      return {
        entries: texts
          .slice(start, position)
          .reverse()
          .map((text) => ({ text, ts: 1, session_id: "test" })),
        cursor: start ? { position: start, revision: version } : null,
        revision: version,
        rows: position - start,
        bytes: 1,
      };
    },
  };
  return {
    provider,
    reads: () => reads,
    limits,
    change: (next: string[]) => {
      texts = next;
      version += "x";
    },
  };
}

test("local-first search, case insensitive matching, exact text deduplication, and both boundaries", async () => {
  const disk = source(["old cat", "cat", "other"]);
  const engine = new HistorySearch(disk.provider);
  await engine.start(["cat", "new Cat"]);
  assert.equal((await engine.find("CAT", "older")).text, "new Cat");
  assert.equal(disk.reads(), 0);
  assert.equal((await engine.find("CAT", "older")).text, "cat");
  assert.equal((await engine.find("CAT", "older")).text, "old cat");
  assert.deepEqual(disk.limits, [1, undefined]);
  for (let i = 0; i < 4; i++) assert.equal((await engine.find("CAT", "older")).text, "old cat");
  assert.equal(disk.reads(), 2);
  assert.equal((await engine.find("CAT", "newer")).text, "cat");
  assert.equal((await engine.find("CAT", "newer")).text, "new Cat");
  assert.equal((await engine.find("CAT", "newer")).text, "new Cat");
  assert.equal(disk.reads(), 2);
});

test("latest probe avoids batch reads; query changes and reopened searches reuse disk cache", async () => {
  const disk = source(["older", "latest"]);
  const engine = new HistorySearch(disk.provider);
  await engine.start([]);
  assert.equal((await engine.find("", "older")).text, null);
  assert.equal(disk.reads(), 0);
  assert.equal((await engine.find("latest", "older")).text, "latest");
  assert.deepEqual(disk.limits, [1]);
  assert.equal((await engine.find("older", "older")).text, "older");
  const reads = disk.reads();
  engine.restartQuery("latest");
  assert.equal((await engine.find("latest", "older")).text, "latest");
  assert.equal((await engine.find("absent", "older")).text, null);
  await engine.start([]);
  assert.equal((await engine.find("older", "older")).text, "older");
  assert.equal(disk.reads(), reads);
  disk.change(["replacement"]);
  engine.restartQuery("replacement");
  assert.equal((await engine.find("replacement", "older")).text, "replacement");
});

test("query selection restarts at newest cached result", async () => {
  const disk = source([]);
  const engine = new HistorySearch(disk.provider);
  await engine.start(["match old", "match new"]);
  await engine.find("match", "older");
  await engine.find("match", "older");
  await engine.find("new", "older");
  engine.restartQuery("match");
  assert.equal((await engine.find("match", "older")).text, "match new");
});

test("pending reads are shared and superseded queries stop requesting older batches", async () => {
  let deliver!: (batch: HistoryBatch) => void;
  let reads = 0;
  const engine = new HistorySearch({
    revision: async () => "v1",
    read: () => {
      reads++;
      return new Promise((resolve) => {
        deliver = resolve;
      });
    },
  });
  await engine.start([]);
  let current = true;
  const obsolete = engine.find("old", "older", () => current);
  await new Promise((resolve) => setImmediate(resolve));
  current = false;
  const latest = engine.find("new", "older");
  await new Promise((resolve) => setImmediate(resolve));
  deliver({
    entries: [{ text: "new", ts: 1, session_id: "test" }],
    cursor: { position: 5, revision: "v1" },
    revision: "v1",
    rows: 1,
    bytes: 1,
  });
  assert.equal((await latest).text, "new");
  assert.equal((await obsolete).text, null);
  assert.equal(reads, 1);
});

test("disk failure keeps local results and suppresses repeated failing reads", async () => {
  let reads = 0;
  const engine = new HistorySearch({
    revision: async () => "v1",
    read: async () => {
      reads++;
      throw new Error("denied");
    },
  });
  await engine.start(["local"]);
  assert.equal((await engine.find("local", "older")).text, "local");
  assert.deepEqual(await engine.find("other", "older"), { text: null, unavailable: true });
  await engine.find("another", "older");
  assert.equal(reads, 1);
});

test("footer fits narrow terminals and Unicode queries; highlights use original text offsets", () => {
  const footer = historySearchFooter("a\n中文\t末尾", 25);
  assert.ok(footer.column < 25);
  assert.ok(footer.query.endsWith("末尾"));
  assert.ok(!footer.query.includes("\n"));
  assert.equal(historySearchFooter("hello", 1).column, 0);
  assert.deepEqual(historyMatchRange("İ foo", "foo"), { start: 2, end: 5 });
  assert.deepEqual(historyMatchRange("hello 中文\n世界", "中文\n"), { start: 6, end: 9 });
});
