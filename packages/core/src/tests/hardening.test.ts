import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { writeFileAtomic } from "../common/private-storage";
import { classifyMcpError } from "../mcp/mcp-manager";
import { sweepOldBackgroundLogs } from "../tools/bash-handler";

const tempDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("writeFileAtomic", () => {
  it("replaces the target and leaves no .tmp behind", () => {
    const dir = tempDir("dc-atomic-");
    const target = path.join(dir, "index.json");
    fs.writeFileSync(target, "old", "utf8");
    writeFileAtomic(target, "new");
    assert.equal(fs.readFileSync(target, "utf8"), "new");
    assert.ok(!fs.existsSync(`${target}.tmp`), "tmp file must be cleaned up");
  });

  it("writes 0600 on POSIX", () => {
    if (process.platform === "win32") {
      return;
    }
    const dir = tempDir("dc-atomic-mode-");
    const target = path.join(dir, "s.json");
    writeFileAtomic(target, "{}");
    const mode = fs.statSync(target).mode & 0o777;
    assert.equal(mode, 0o600);
  });
});

describe("classifyMcpError", () => {
  it("classifies timeouts", () => {
    assert.equal(classifyMcpError("Timed out after 60000ms"), "timeout");
    assert.equal(classifyMcpError("deadline exceeded"), "timeout");
  });

  it("classifies connection failures", () => {
    assert.equal(classifyMcpError("Failed to start MCP server: ENOENT"), "connection");
    assert.equal(classifyMcpError("connection refused"), "connection");
  });

  it("classifies auth failures", () => {
    assert.equal(classifyMcpError("HTTP 401 unauthorized"), "auth");
    assert.equal(classifyMcpError("invalid api key"), "auth");
  });

  it("classifies protocol and busy", () => {
    assert.equal(classifyMcpError("invalid json payload"), "protocol");
    assert.equal(classifyMcpError("server busy, retry later"), "busy");
  });

  it("returns unknown otherwise", () => {
    assert.equal(classifyMcpError("something unexpected"), "unknown");
  });
});

describe("sweepOldBackgroundLogs", () => {
  it("deletes only expired .log files", () => {
    const dir = tempDir("dc-sweep-");

    const oldLog = path.join(dir, "old.log");
    const freshLog = path.join(dir, "fresh.log");
    const otherFile = path.join(dir, "keep.txt");
    fs.writeFileSync(oldLog, "old");
    fs.writeFileSync(freshLog, "fresh");
    fs.writeFileSync(otherFile, "keep");

    // Simulate old file: 8 days ago; fresh: now.
    const now = Date.now();
    const eightDaysAgo = now - 8 * 24 * 60 * 60 * 1000;
    fs.utimesSync(oldLog, new Date(eightDaysAgo), new Date(eightDaysAgo));

    sweepOldBackgroundLogs(now, dir);

    assert.ok(!fs.existsSync(oldLog), "expired .log must be deleted");
    assert.ok(fs.existsSync(freshLog), "fresh .log must be kept");
    assert.ok(fs.existsSync(otherFile), "non-log file must be kept");
  });

  it("is a no-op when the directory does not exist", () => {
    const missing = path.join(os.tmpdir(), "dc-no-such-sweep-dir");
    assert.doesNotThrow(() => sweepOldBackgroundLogs(Date.now(), missing));
  });
});
