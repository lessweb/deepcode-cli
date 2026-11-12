import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  appendHistoryEntry,
  readHistoryBatch,
  getHistoryRevision,
  HistoryChangedError,
  resolveHistorySettings,
  DEFAULT_HISTORY_SETTINGS,
  HISTORY_BATCH_BYTES,
  type HistoryEntry,
} from "../common/message-history";
import { resolveSettingsSources } from "../settings";

async function fixture(t: TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "deepcode-history-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return path.join(root, "history.jsonl");
}
const entry = (text: string): HistoryEntry => ({ session_id: "session", ts: 1, text });
const line = (text: string) => JSON.stringify(entry(text)) + "\n";
const unlimited = { persistence: "saveAll", maxBytes: 0 } as const;

async function readAll(file: string) {
  const result: string[] = [];
  let batch = await readHistoryBatch(undefined, undefined, file);
  result.push(...batch.entries.map((e) => e.text));
  while (batch.cursor) {
    batch = await readHistoryBatch(batch.cursor, undefined, file);
    result.push(...batch.entries.map((e) => e.text));
  }
  return result;
}

test("history configuration defaults, per-field override, and validation", () => {
  assert.deepEqual(resolveHistorySettings(), DEFAULT_HISTORY_SETTINGS);
  const settings = resolveSettingsSources(
    { history: { persistence: "none", maxBytes: 100 } },
    { history: { maxBytes: 0 } },
    { model: "test", baseURL: "http://localhost" },
    {}
  );
  assert.deepEqual(settings.history, { persistence: "none", maxBytes: 0 });
  for (const value of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "10M"]) {
    assert.throws(() => resolveHistorySettings({ maxBytes: value as number }), /history.maxBytes/);
  }
  assert.throws(() => resolveHistorySettings({ persistence: "other" as "none" }), /history.persistence/);
  assert.throws(() => resolveHistorySettings(null as never), /object/);
});

test("none neither creates nor changes history; zero keeps all entries", async (t) => {
  const file = await fixture(t);
  await appendHistoryEntry(entry("ignored"), { persistence: "none", maxBytes: 1 }, file);
  assert.equal(await getHistoryRevision(file), "missing");
  await appendHistoryEntry(entry("汉字\n".repeat(100)), unlimited, file);
  const before = await fs.readFile(file);
  await appendHistoryEntry(entry("ignored"), { persistence: "none", maxBytes: 1 }, file);
  assert.deepEqual(await fs.readFile(file), before);
  await appendHistoryEntry(entry(" newest "), unlimited, file);
  assert.deepEqual(await readAll(file), [" newest ", "汉字\n".repeat(100)]);
  if (process.platform !== "win32") assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
});

test("trim retains newest whole records below 80% and always preserves an oversized latest entry", async (t) => {
  const file = await fixture(t);
  const texts = Array.from({ length: 20 }, (_, i) => `${i}:` + "汉".repeat(25));
  await fs.writeFile(file, texts.map(line).join(""));
  await appendHistoryEntry(entry("last"), { persistence: "saveAll", maxBytes: 1000 }, file);
  const retained = await readAll(file);
  assert.ok((await fs.stat(file)).size <= 800);
  assert.equal(retained[0], "last");
  assert.deepEqual(retained.slice(1), texts.slice(-(retained.length - 1)).reverse());
  const huge = "新".repeat(1000);
  await appendHistoryEntry(entry(huge), { persistence: "saveAll", maxBytes: 100 }, file);
  assert.deepEqual(await readAll(file), [huge]);
  await appendHistoryEntry(entry("small"), { persistence: "saveAll", maxBytes: 100 }, file);
  assert.deepEqual(await readAll(file), ["small"]);
});

test("probe and cursor batches cover each row once with bounded rows and raw bytes", async (t) => {
  const file = await fixture(t);
  const texts = Array.from({ length: 350 }, (_, i) => `${i} 多行\n内容`);
  await fs.writeFile(file, texts.map(line).join(""));
  const probe = await readHistoryBatch(undefined, 1, file);
  assert.equal(probe.rows, 1);
  assert.equal(probe.entries[0].text, texts.at(-1));
  const batch = await readHistoryBatch(probe.cursor!, undefined, file);
  assert.equal(batch.rows, 128);
  assert.ok(batch.bytes <= HISTORY_BATCH_BYTES);
  assert.equal(batch.cursor!.position, probe.cursor!.position - batch.bytes);
  assert.deepEqual(await readAll(file), texts.reverse());
});

test("byte limit, oversized row, UTF-8 block boundaries, malformed rows and missing final newline", async (t) => {
  const file = await fixture(t);
  const huge = "中文🙂".repeat(20_000);
  const medium = "x".repeat(33_000);
  await fs.writeFile(file, line("old") + line(huge) + "{broken}\n" + line(medium) + line("new").trimEnd());
  const first = await readHistoryBatch(undefined, undefined, file);
  assert.deepEqual(
    first.entries.map((e) => e.text),
    ["new", medium]
  );
  assert.equal(first.rows, 3);
  assert.ok(first.bytes <= HISTORY_BATCH_BYTES);
  const second = await readHistoryBatch(first.cursor!, undefined, file);
  assert.deepEqual(
    second.entries.map((e) => e.text),
    [huge]
  );
  assert.equal(second.rows, 1);
  assert.ok(second.bytes > HISTORY_BATCH_BYTES);
  assert.deepEqual(await readAll(file), ["new", medium, huge, "old"]);
  await appendHistoryEntry(entry("appended"), unlimited, file);
  assert.deepEqual(await readAll(file), ["appended", "new", medium, huge, "old"]);
});

test("missing files are empty and append/replacement invalidate byte cursors", async (t) => {
  const file = await fixture(t);
  assert.equal((await readHistoryBatch(undefined, undefined, file)).cursor, null);
  await fs.writeFile(file, line("first") + line("second"));
  const probe = await readHistoryBatch(undefined, 1, file);
  await appendHistoryEntry(entry("third"), unlimited, file);
  await assert.rejects(readHistoryBatch(probe.cursor!, undefined, file), HistoryChangedError);
  const current = await readHistoryBatch(undefined, 1, file);
  await fs.writeFile(file + ".new", line("replacement"));
  await fs.rename(file + ".new", file);
  await assert.rejects(readHistoryBatch(current.cursor!, undefined, file), HistoryChangedError);
});

test("parallel processes serialize complete appends and trimming", async (t) => {
  const file = await fixture(t);
  const source = new URL("../common/message-history.ts", import.meta.url).href;
  async function writer(id: number, maxBytes: number) {
    const script = `import {appendHistoryEntry} from ${JSON.stringify(source)}; for(let i=0;i<12;i++) await appendHistoryEntry({session_id:String(${id}),ts:i,text:${JSON.stringify(`${id}:`)}+i}, {persistence:'saveAll',maxBytes:${maxBytes}}, ${JSON.stringify(file)});`;
    const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (data) => {
      stderr += data;
    });
    await new Promise<void>((resolve, reject) => {
      child.on("error", reject);
      child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(stderr))));
    });
  }
  await Promise.all([writer(1, 0), writer(2, 0), writer(3, 0)]);
  assert.equal(new Set(await readAll(file)).size, 36);
  await Promise.all([writer(4, 500), writer(5, 500)]);
  assert.ok((await fs.stat(file)).size <= 500);
  const contents = (await fs.readFile(file, "utf8"))
    .trim()
    .split("\n")
    .map((s) => JSON.parse(s));
  assert.ok(contents.length > 0);
  assert.match(contents.at(-1).text, /[45]:11/);
});

test("reading the newest probe and an older batch seeks near the tail instead of scanning the prefix", async (t) => {
  const file = await fixture(t);
  await fs.writeFile(file, Array.from({ length: 10_000 }, (_, i) => line(`${i}:` + "x".repeat(100))).join(""));
  const size = (await fs.stat(file)).size;
  const originalOpen = fs.open.bind(fs);
  let totalRead = 0;
  let lowestPosition = size;
  t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
    const handle = await originalOpen(...args);
    const originalRead = handle.read.bind(handle);
    t.mock.method(handle, "read", async (...readArgs: any[]) => {
      lowestPosition = Math.min(lowestPosition, readArgs[3]);
      const result = await (originalRead as any)(...readArgs);
      totalRead += result.bytesRead;
      return result;
    });
    return handle;
  });
  const newest = await readHistoryBatch(undefined, 1, file);
  const older = await readHistoryBatch(newest.cursor!, undefined, file);
  assert.equal(older.rows, 128);
  assert.ok(totalRead < 64 * 1024, `Read ${totalRead} bytes from a ${size}-byte file`);
  assert.ok(lowestPosition > size - 64 * 1024);
});
