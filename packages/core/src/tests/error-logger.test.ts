import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

test("logApiError masks secrets, truncates payloads, and enforces retention", async () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "deepcode-error-logger-"));
  const previousHome = process.env.HOME;
  process.env.HOME = tempHome;
  try {
    const { logApiError } = await import("../common/error-logger.js");
    const logPath = path.join(tempHome, ".deepcode", "logs", "error.log");

    for (let index = 0; index < 55; index += 1) {
      logApiError({
        timestamp: new Date().toISOString(),
        location: "test",
        requestId: `req-${index}`,
        sessionId: "session-1",
        error: {
          name: "Error",
          message: "Bearer sk-1234567890abcdef api_key=secret-value",
        } as never,
        request: {
          model: "test",
          messages: [{ role: "user", content: `hello ${"x".repeat(10_000)}` }],
          tools: [{ type: "function", function: { name: "x", description: "y".repeat(10_000) } }],
        },
        response: { body: "z".repeat(50_000) },
      });
    }

    const retained = fs.readFileSync(logPath, "utf8");
    const retainedLines = retained.split("\n").filter((line) => line.trim().length > 0);
    assert.equal(retainedLines.length, 50);
    assert.ok(retained.length < 2_000_000, `log grew to ${retained.length} bytes`);
    assert.ok(!retained.includes("sk-1234567890abcdef"), "raw secret key leaked into the log");
    assert.ok(!retained.includes("secret-value"), "raw api_key leaked into the log");
    assert.ok(retained.includes("***MASKED***"), "sensitive values were not masked");
    assert.ok(retained.includes("...(total "), "long strings were not truncated");
    for (const line of retainedLines) {
      assert.ok(line.length <= 32_000, `log entry is too long: ${line.length}`);
    }

    const oversizedRequest: Record<string, string> = {};
    for (let index = 0; index < 100; index += 1) {
      oversizedRequest[`field${index}`] = "x".repeat(500);
    }
    logApiError({
      timestamp: new Date().toISOString(),
      location: "test",
      requestId: "req-oversized",
      error: { name: "Error", message: "oversized" } as never,
      request: oversizedRequest,
    });

    const finalLines = fs
      .readFileSync(logPath, "utf8")
      .split("\n")
      .filter((line) => line.trim().length > 0);
    const last = JSON.parse(finalLines.at(-1) ?? "{}") as { truncated?: boolean };
    assert.equal(last.truncated, true);
    assert.ok((finalLines.at(-1) ?? "").length <= 32_000);
  } finally {
    process.env.HOME = previousHome;
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});
