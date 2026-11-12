import type { ImagePreview } from "./image-preview";

const unavailable = (): ImagePreview => ({ columns: 0, rows: 1 });
type Consumer = { resolve: (image: ImagePreview) => void; signal?: AbortSignal; abort: () => void };
type Job = {
  key: string;
  load?: (signal: AbortSignal) => Promise<ImagePreview>;
  controller: AbortController;
  consumers: Set<Consumer>;
};

/** Shared decode work, with independently cancellable consumers and bounded retention. */
export class ImagePreviewCache {
  private readonly cache = new Map<string, ImagePreview>();
  private readonly pending = new Map<string, Job>();
  private readonly waiting = new Set<Job>();
  private cachedBytes = 0;
  private active = 0;

  get stats() {
    return {
      cached: this.cache.size,
      cachedBytes: this.cachedBytes,
      pending: this.pending.size,
      waiting: this.waiting.size,
      active: this.active,
    };
  }

  get(key: string, load: (signal: AbortSignal) => Promise<ImagePreview>, signal?: AbortSignal): Promise<ImagePreview> {
    if (signal?.aborted) return Promise.resolve(unavailable());
    const cached = this.cache.get(key);
    if (cached) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return Promise.resolve(cached);
    }
    let job = this.pending.get(key);
    if (!job) {
      // Optional previews must not build an unbounded backlog of source images.
      // A saturated request uses a placeholder and is not cached as a decode failure.
      if (this.waiting.size >= 32) return Promise.resolve(unavailable());
      job = { key, load, controller: new AbortController(), consumers: new Set() };
      this.pending.set(key, job);
      this.waiting.add(job);
    }
    const current = job;
    const result = new Promise<ImagePreview>((resolve) => {
      const consumer: Consumer = {
        resolve,
        signal,
        abort: () => {
          current.consumers.delete(consumer);
          signal?.removeEventListener("abort", consumer.abort);
          resolve(unavailable());
          if (current.consumers.size === 0) {
            current.controller.abort();
            if (this.pending.get(key) === current) this.pending.delete(key);
            this.waiting.delete(current);
            current.load = undefined;
          }
        },
      };
      current.consumers.add(consumer);
      signal?.addEventListener("abort", consumer.abort, { once: true });
    });
    this.drain();
    return result;
  }

  private drain(): void {
    while (this.active < 2 && this.waiting.size > 0) {
      const job = this.waiting.values().next().value!;
      this.waiting.delete(job);
      this.active++;
      void this.run(job);
    }
  }

  private async run(job: Job): Promise<void> {
    let image: ImagePreview;
    try {
      image = await job.load!(job.controller.signal);
    } catch {
      image = unavailable();
    }
    if (this.pending.get(job.key) === job) this.pending.delete(job.key);
    if (!job.controller.signal.aborted) {
      this.cache.set(job.key, image);
      this.cachedBytes += image.png?.length ?? 0;
      while (this.cache.size > 32 || this.cachedBytes > 8 * 1024 * 1024) {
        const oldest = this.cache.keys().next().value!;
        this.cachedBytes -= this.cache.get(oldest)?.png?.length ?? 0;
        this.cache.delete(oldest);
      }
    }
    for (const consumer of job.consumers) {
      consumer.signal?.removeEventListener("abort", consumer.abort);
      consumer.resolve(image);
    }
    job.consumers.clear();
    job.load = undefined;
    this.active--;
    this.drain();
  }
}
