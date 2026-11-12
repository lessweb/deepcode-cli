import assert from "node:assert/strict";
import { test } from "node:test";
import { ImagePreviewCache } from "../ui/core/image-preview-cache";
import type { ImagePreview } from "../ui/core/image-preview";

const image: ImagePreview = { columns: 1, rows: 1, png: Buffer.from("png") };
const unavailable: ImagePreview = { columns: 0, rows: 1 };

function deferred() {
  let resolve!: (image: ImagePreview) => void;
  const promise = new Promise<ImagePreview>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("shared preview decoding survives cancellation of one consumer", async () => {
  const cache = new ImagePreviewCache();
  const work = deferred();
  const first = new AbortController();
  const second = new AbortController();
  let decodeSignal!: AbortSignal;
  let loads = 0;
  const load = (signal: AbortSignal) => {
    loads++;
    decodeSignal = signal;
    return work.promise;
  };
  const a = cache.get("same", load, first.signal);
  const b = cache.get("same", load, second.signal);
  first.abort();
  assert.deepEqual(await a, unavailable);
  assert.equal(decodeSignal.aborted, false);
  work.resolve(image);
  assert.equal(await b, image);
  assert.equal(await cache.get("same", load), image);
  assert.equal(loads, 1);
  second.abort();
  assert.equal(decodeSignal.aborted, false, "completed consumers must detach their abort listeners");
});

test("abandoned queued previews release their slot and never start decoding", async () => {
  const cache = new ImagePreviewCache();
  const work = deferred();
  const running = [cache.get("a", () => work.promise), cache.get("b", () => work.promise)];
  const controller = new AbortController();
  const cancelled = cache.get("queued", () => assert.fail("cancelled work must not run"), controller.signal);
  assert.equal(cache.stats.waiting, 1);
  controller.abort();
  assert.deepEqual(await cancelled, unavailable);
  assert.equal(cache.stats.waiting, 0);
  assert.equal(cache.stats.pending, 2);
  work.resolve(image);
  await Promise.all(running);
  assert.equal(cache.stats.active, 0);
});

test("cancelled running work cannot cache stale results or remove a replacement job", async () => {
  const cache = new ImagePreviewCache();
  const oldWork = deferred();
  const newWork = deferred();
  const controller = new AbortController();
  let oldSignal!: AbortSignal;
  const old = cache.get(
    "same",
    (signal) => {
      oldSignal = signal;
      return oldWork.promise;
    },
    controller.signal
  );
  controller.abort();
  assert.deepEqual(await old, unavailable);
  assert.equal(oldSignal.aborted, true);
  assert.equal(cache.stats.active, 1, "native work still in flight must retain its concurrency slot");
  const replacement = cache.get("same", () => newWork.promise);
  oldWork.resolve(image);
  await oldWork.promise;
  assert.equal(cache.stats.pending, 1);
  assert.equal(cache.stats.cached, 0);
  const shared = cache.get("same", () => assert.fail("replacement must stay shared"));
  const fresh = { ...image, width: 123 };
  newWork.resolve(fresh);
  assert.equal(await replacement, fresh);
  assert.equal(await shared, fresh);
  assert.equal(cache.stats.active, 0);
});

test("preview queue bounds concurrency and backlog, then accepts retries after saturation", async () => {
  const cache = new ImagePreviewCache();
  const work = deferred();
  let started = 0;
  const requests = Array.from({ length: 34 }, (_, i) =>
    cache.get(String(i), () => {
      started++;
      return work.promise;
    })
  );
  assert.equal(started, 2);
  assert.equal(cache.stats.waiting, 32);
  assert.deepEqual(await cache.get("overflow", () => assert.fail("queue is full")), unavailable);
  work.resolve(image);
  await Promise.all(requests);
  assert.equal(started, 34);
  assert.equal(cache.stats.pending, 0);
  assert.equal(cache.stats.cached, 32);
  assert.equal(cache.stats.cachedBytes, 32 * image.png!.length);
  assert.equal(await cache.get("overflow", async () => image), image);
});

test("preview cache bounds retained bytes and updates recency on cache hits", async () => {
  const cache = new ImagePreviewCache();
  const large = { ...image, png: Buffer.alloc(3 * 1024 * 1024) };
  await cache.get("a", async () => large);
  await cache.get("b", async () => large);
  await cache.get("a", () => assert.fail("a should be cached"));
  await cache.get("c", async () => large);
  assert.equal(cache.stats.cached, 2);
  assert.equal(cache.stats.cachedBytes, 6 * 1024 * 1024);
  assert.equal(await cache.get("a", () => assert.fail("recent cache entry should survive")), large);
  let reloaded = false;
  await cache.get("b", async () => {
    reloaded = true;
    return image;
  });
  assert.equal(reloaded, true);
  const oversized = { ...image, png: Buffer.alloc(9 * 1024 * 1024) };
  assert.equal(await cache.get("oversized", async () => oversized), oversized);
  assert.equal(cache.stats.cachedBytes, 0);
});

test("decode failures drain the queue and pre-aborted requests never start", async () => {
  const cache = new ImagePreviewCache();
  const work = deferred();
  const failed = cache.get("failed", async () => {
    await work.promise;
    throw new Error("unreadable image");
  });
  const other = cache.get("other", () => work.promise);
  const queued = cache.get("queued", async () => image);
  const controller = new AbortController();
  controller.abort();
  assert.deepEqual(await cache.get("aborted", () => assert.fail("already cancelled"), controller.signal), unavailable);
  work.resolve(image);
  assert.deepEqual(await failed, unavailable);
  assert.equal(await other, image);
  assert.equal(await queued, image);
  assert.equal(cache.stats.pending, 0);
  assert.equal(cache.stats.active, 0);
});
