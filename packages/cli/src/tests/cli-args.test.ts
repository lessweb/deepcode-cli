import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArguments, isValidSessionId } from "../cli-args";

// ── isValidSessionId ─────────────────────────────────────────────────────────

test("isValidSessionId accepts valid UUID", () => {
  assert.ok(isValidSessionId("0a5cb7a5-c39d-4c39-a11b-05f8b22b8df6"));
});

test("isValidSessionId rejects invalid format", () => {
  assert.ok(!isValidSessionId("not-a-uuid"));
  assert.ok(!isValidSessionId(""));
  assert.ok(!isValidSessionId("abc"));
});

// ── parseArguments: basic parsing ──────────────────────────────────────────────

test("parseArguments returns prompt after -p", async () => {
  const r = await parseArguments(["-p", "hello world"]);
  assert.ok(!("message" in r));
  assert.equal(r.prompt, "hello world");
});

test("parseArguments returns prompt after --prompt", async () => {
  const r = await parseArguments(["--prompt", "hello world"]);
  assert.ok(!("message" in r));
  assert.equal(r.prompt, "hello world");
});

test("parseArguments returns prompt from positional query", async () => {
  const r = await parseArguments(["hello world"]);
  assert.ok(!("message" in r));
  assert.equal(r.prompt, "hello world");
});

test("parseArguments joins multi-word positional query", async () => {
  const r = await parseArguments(["hello", "world"]);
  assert.ok(!("message" in r));
  assert.equal(r.prompt, "hello world");
});

test("parseArguments returns undefined prompt when -p is not present", async () => {
  const r = await parseArguments(["--resume"]);
  assert.ok(!("message" in r));
  assert.equal(r.prompt, undefined);
});

test("parseArguments returns session ID after --resume", async () => {
  const r = await parseArguments(["--resume", "0a5cb7a5-c39d-4c39-a11b-05f8b22b8df6"]);
  assert.ok(!("message" in r));
  assert.equal(r.resume, "0a5cb7a5-c39d-4c39-a11b-05f8b22b8df6");
});

test("parseArguments returns true when --resume has no value", async () => {
  const r = await parseArguments(["--resume"]);
  assert.ok(!("message" in r));
  assert.equal(r.resume, true);
});

test("parseArguments returns undefined resume when not present", async () => {
  const r = await parseArguments(["-p", "test"]);
  assert.ok(!("message" in r));
  assert.equal(r.resume, undefined);
});

test("parseArguments returns defaults for empty args", async () => {
  const r = await parseArguments([]);
  assert.ok(!("message" in r));
  assert.equal(r.prompt, undefined);
  assert.equal(r.resume, undefined);
  assert.equal(r.version, false);
  assert.equal(r.help, false);
});

// ── parseArguments: -r alias ───────────────────────────────────────────────────

test("parseArguments returns session ID after -r", async () => {
  const r = await parseArguments(["-r", "0a5cb7a5-c39d-4c39-a11b-05f8b22b8df6"]);
  assert.ok(!("message" in r));
  assert.equal(r.resume, "0a5cb7a5-c39d-4c39-a11b-05f8b22b8df6");
});

test("parseArguments returns true when -r has no value", async () => {
  const r = await parseArguments(["-r"]);
  assert.ok(!("message" in r));
  assert.equal(r.resume, true);
});

test("parseArguments handles -r <id> combined with -p", async () => {
  const r = await parseArguments(["-r", "0a5cb7a5-c39d-4c39-a11b-05f8b22b8df6", "-p", "hello"]);
  assert.ok(!("message" in r));
  assert.equal(r.resume, "0a5cb7a5-c39d-4c39-a11b-05f8b22b8df6");
  assert.equal(r.prompt, "hello");
});

// ── parseArguments: --version / --help ─────────────────────────────────────────

test("parseArguments detects --version", async () => {
  const r = await parseArguments(["--version"]);
  assert.ok(!("message" in r));
  assert.equal(r.version, true);
  assert.equal(r.help, false);
});

test("parseArguments detects -v", async () => {
  const r = await parseArguments(["-v"]);
  assert.ok(!("message" in r));
  assert.equal(r.version, true);
});

test("parseArguments detects --help", async () => {
  const r = await parseArguments(["--help"]);
  assert.ok(!("message" in r));
  assert.equal(r.help, true);
  assert.equal(r.version, false);
});

test("parseArguments detects -h", async () => {
  const r = await parseArguments(["-h"]);
  assert.ok(!("message" in r));
  assert.equal(r.help, true);
});

test("parseArguments version and help are false when not passed", async () => {
  const r = await parseArguments(["-p", "hello"]);
  assert.ok(!("message" in r));
  assert.equal(r.version, false);
  assert.equal(r.help, false);
});

test("parseArguments handles -v combined with -r (both flags set)", async () => {
  const r = await parseArguments(["-v", "-r", "abc"]);
  assert.ok(!("message" in r));
  assert.equal(r.version, true);
  assert.equal(r.resume, "abc");
});

// ── parseArguments: combined usage ─────────────────────────────────────────────

test("parseArguments handles --resume <id> combined with -p", async () => {
  const r = await parseArguments(["--resume", "0a5cb7a5-c39d-4c39-a11b-05f8b22b8df6", "-p", "hello"]);
  assert.ok(!("message" in r));
  assert.equal(r.resume, "0a5cb7a5-c39d-4c39-a11b-05f8b22b8df6");
  assert.equal(r.prompt, "hello");
});

test("parseArguments handles -p before --resume <id>", async () => {
  const r = await parseArguments(["-p", "hello", "--resume", "0a5cb7a5-c39d-4c39-a11b-05f8b22b8df6"]);
  assert.ok(!("message" in r));
  assert.equal(r.resume, "0a5cb7a5-c39d-4c39-a11b-05f8b22b8df6");
  assert.equal(r.prompt, "hello");
});

test("parseArguments handles --resume <id> combined with positional query", async () => {
  const r = await parseArguments(["--resume", "0a5cb7a5-c39d-4c39-a11b-05f8b22b8df6", "hello", "again"]);
  assert.ok(!("message" in r));
  assert.equal(r.resume, "0a5cb7a5-c39d-4c39-a11b-05f8b22b8df6");
  assert.equal(r.prompt, "hello again");
});

test("parseArguments --version takes precedence over --help", async () => {
  const r = await parseArguments(["--version", "--help"]);
  assert.ok(!("message" in r));
  assert.equal(r.version, true);
  assert.equal(r.help, true);
});

// ── parseArguments: error cases (mock process.exit) ────────────────────────────
// Command-level and top-level errors both call process.exit(1) via yargs .fail().

function withMockedExit(fn: (exitSpy: { calls: number[] }) => Promise<void>): Promise<void> {
  const original = process.exit;
  const stderrWrite = process.stderr.write;
  // Suppress yargs help/error output during tests
  process.stderr.write = (() => true) as typeof process.stderr.write;
  const exitSpy: { calls: number[] } = { calls: [] };
  process.exit = ((code?: number) => {
    exitSpy.calls.push(code ?? 0);
    throw new Error(`process.exit(${code})`);
  }) as typeof process.exit;
  return fn(exitSpy).finally(() => {
    process.exit = original;
    process.stderr.write = stderrWrite;
  });
}

test("parseArguments exits on unknown flags", async () => {
  await withMockedExit(async (exitSpy) => {
    try {
      await parseArguments(["--unknown-flag"]);
    } catch {
      /* expected */
    }
    assert.ok(exitSpy.calls.length >= 1);
  });
});

test("parseArguments exits on bare -r with -p", async () => {
  await withMockedExit(async (exitSpy) => {
    try {
      await parseArguments(["-r", "-p", "hello"]);
    } catch {
      /* expected */
    }
    assert.ok(exitSpy.calls.length >= 1);
  });
});

test("parseArguments exits on empty -p value", async () => {
  await withMockedExit(async (exitSpy) => {
    try {
      await parseArguments(["-p", ""]);
    } catch {
      /* expected */
    }
    assert.ok(exitSpy.calls.length >= 1);
  });
});

test("parseArguments exits when positional query is combined with -p", async () => {
  await withMockedExit(async (exitSpy) => {
    try {
      await parseArguments(["hello", "-p", "world"]);
    } catch {
      /* expected */
    }
    assert.ok(exitSpy.calls.length >= 1);
  });
});

test("parseArguments exits on invalid --resume session ID", async () => {
  await withMockedExit(async (exitSpy) => {
    try {
      await parseArguments(["--resume", "not-a-uuid"]);
    } catch {
      /* expected */
    }
    assert.ok(exitSpy.calls.length >= 1);
  });
});
