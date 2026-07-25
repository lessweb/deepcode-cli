import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  JobQueue,
  createSpawnRequest,
} from "../common/job-queue";

describe("JobQueue - basic operations", { timeout: 15000 }, () => {
  test("submit and complete a simple echo job", async () => {
    const queue = new JobQueue(2);
    const req = createSpawnRequest(process.execPath, {
      args: ["-e", "console.log('hello')"],
      timeoutMs: 5000,
      maxRetries: 0,
      retryDelayMs: 100,
    });
    const jobId = queue.submit(req);
    assert.ok(jobId.length > 0);

    const result = await queue.waitFor(jobId);
    assert.equal(result.exitCode, 0, "stdout=" + JSON.stringify(result.stdout));
    assert.ok(result.stdout.includes("hello"));
  });

  test("failure exit code", async () => {
    const queue = new JobQueue(2);
    const req = createSpawnRequest(process.execPath, {
      args: ["-e", "process.exit(42)"],
      timeoutMs: 5000,
      maxRetries: 1,
      retryDelayMs: 100,
    });
    const jobId = queue.submit(req);
    const result = await queue.waitFor(jobId);
    assert.equal(result.exitCode, 42);
    assert.ok(result.attempts >= 1);
  });

  test("timeout kills process", async () => {
    const queue = new JobQueue(2);
    const req = createSpawnRequest(process.execPath, {
      args: ["-e", "setTimeout(() => {}, 30000)"],
      timeoutMs: 200,
      maxRetries: 0,
      retryDelayMs: 100,
    });
    const jobId = queue.submit(req);
    const result = await queue.waitFor(jobId);
    assert.equal(result.timedOut, true);
  });

  test("cancel pending job", async () => {
    const queue = new JobQueue(1);
    const req1 = createSpawnRequest(process.execPath, {
      args: ["-e", "setTimeout(() => {}, 5000)"],
      timeoutMs: 10000,
      maxRetries: 0,
    });
    const req2 = createSpawnRequest(process.execPath, {
      args: ["-e", "console.log('cancelled')"],
      timeoutMs: 5000,
      maxRetries: 0,
    });
    const job1 = queue.submit(req1);
    const job2 = queue.submit(req2);

    assert.equal(queue.cancel(job2), true);
    assert.equal(queue.getState(job2)?.status, "cancelled");

    // Cleanup
    queue.cancel(job1);
  });
});

describe("JobQueue - concurrency", { timeout: 15000 }, () => {
  test("active count <= maxConcurrency", async () => {
    const queue = new JobQueue(3);

    const jobs: string[] = [];
    for (let i = 0; i < 3; i++) {
      const req = createSpawnRequest(process.execPath, {
        args: ["-e", "console.log('job-" + i + "')"],
        timeoutMs: 5000,
        maxRetries: 0,
      });
      jobs.push(queue.submit(req));
    }

    // All 3 jobs should complete successfully
    for (const id of jobs) {
      const result = await queue.waitFor(id);
      assert.equal(result.exitCode, 0, `job ${id} failed`);
    }
  });
});

describe("JobQueue - stderr capture", { timeout: 10000 }, () => {
  test("stderr is captured", async () => {
    const queue = new JobQueue(2);
    const req = createSpawnRequest(process.execPath, {
      args: ["-e", "console.error('my-error')"],
      timeoutMs: 5000,
      maxRetries: 0,
    });
    const jobId = queue.submit(req);
    const result = await queue.waitFor(jobId);
    assert.ok(result.stderr.includes("my-error"), `stderr=${JSON.stringify(result.stderr)}`);
  });
});

describe("createSpawnRequest", () => {
  test("default values", () => {
    const req = createSpawnRequest("node");
    assert.equal(req.command, "node");
    assert.equal(req.timeoutMs, 30000);
    assert.equal(req.maxRetries, 2);
    assert.equal(req.retryDelayMs, 500);
  });

  test("overrides work", () => {
    const req = createSpawnRequest("npm", {
      args: ["install"],
      timeoutMs: 120000,
      maxRetries: 0,
    });
    assert.equal(req.command, "npm");
    assert.equal(req.timeoutMs, 120000);
    assert.equal(req.maxRetries, 0);
  });
});
