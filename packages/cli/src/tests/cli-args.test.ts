import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArguments, isValidSessionId } from "../cli-args";

test("parseArguments supports --plus as an independent configuration command", async () => {
  assert.equal((await parseArguments(["--plus"])).plus, true);
  assert.equal((await parseArguments([])).plus, false);
});

for (const flags of [
  ["-p", "hello"],
  ["hello"],
  ["-x"],
  ["--json"],
  ["--session-id", "test"],
  ["-r"],
  ["-f"],
  ["-l"],
]) {
  test(`--plus rejects conversation flags: ${flags.join(" ")}`, async () => {
    await withMockedExit(async () => {
      await assert.rejects(parseArguments(["--plus", ...flags]), /process.exit\(1\)/);
    });
  });
}

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
  assert.equal(r.exec, false);
  assert.equal(r.sessionId, undefined);
  assert.equal(r.json, false);
});

test("parseArguments accepts a custom UUID and JSON output in exec mode", async () => {
  const id = "0A5CB7A5-C39D-4C39-A11B-05F8B22B8DF6";
  const parsed = await parseArguments(["--exec", "--prompt", "hello", "--session-id", id, "--json"]);
  assert.equal(parsed.sessionId, id.toLowerCase());
  assert.equal(parsed.json, true);
});

test("isValidSessionId accepts standard UUID versions and rejects invalid variants", () => {
  for (let version = 1; version <= 8; version++) {
    assert.ok(isValidSessionId(`0a5cb7a5-c39d-${version}c39-a11b-05f8b22b8df6`));
  }
  assert.ok(isValidSessionId("00000000-0000-0000-0000-000000000000"));
  assert.ok(isValidSessionId("ffffffff-ffff-ffff-ffff-ffffffffffff"));
  assert.ok(!isValidSessionId("0a5cb7a5-c39d-4c39-711b-05f8b22b8df6"));
  assert.ok(!isValidSessionId("0a5cb7a5-c39d-9c39-a11b-05f8b22b8df6"));
});

for (const flags of [
  ["--resume", "0a5cb7a5-c39d-4c39-a11b-05f8b22b8df6"],
  ["--fork", "0a5cb7a5-c39d-4c39-a11b-05f8b22b8df6"],
  ["--fork"],
  ["--last"],
]) {
  test(`parseArguments accepts --json with exec and ${flags.join(" ")}`, async () => {
    const parsed = await parseArguments(["-x", "-p", "hello", "--json", ...flags]);
    assert.equal(parsed.json, true);
  });
}

for (const args of [
  ["--session-id", "0a5cb7a5-c39d-4c39-a11b-05f8b22b8df6"],
  ["--json"],
  ["-x", "-p", "hello", "--session-id"],
  ["-x", "-p", "hello", "--session-id", ""],
  ["-x", "-p", "hello", "--session-id", "not-a-uuid"],
  ["-x", "--json"],
  ["-x", "--session-id", "0a5cb7a5-c39d-4c39-a11b-05f8b22b8df6"],
  ...["-r", "--resume", "-f", "--fork", "-l", "--last"].map((flag) => [
    "-x",
    "-p",
    "hello",
    "--session-id",
    "0a5cb7a5-c39d-4c39-a11b-05f8b22b8df6",
    flag,
  ]),
]) {
  test(`parseArguments rejects ${args.join(" ")}`, async () => {
    await withMockedExit(async (exitSpy) => {
      await assert.rejects(parseArguments(args), /process.exit\(1\)/);
      assert.ok(exitSpy.calls.includes(1));
    });
  });
}

test("parseArguments enables exec mode with -x", async () => {
  const r = await parseArguments(["-x", "-p", "hello world"]);
  assert.equal(r.exec, true);
  assert.equal(r.prompt, "hello world");
});

test("parseArguments enables exec mode with --exec", async () => {
  const r = await parseArguments(["--exec", "--prompt", "hello world"]);
  assert.equal(r.exec, true);
  assert.equal(r.prompt, "hello world");
});

test("parseArguments returns prompt after --prompt", async () => {
  const r = await parseArguments(["--prompt", "hello world"]);
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

test("parseArguments returns true when --fork has no value", async () => {
  const r = await parseArguments(["--fork"]);
  assert.equal(r.fork, true);
});

test("parseArguments returns a session ID after -f", async () => {
  const r = await parseArguments(["-f", "0a5cb7a5-c39d-4c39-a11b-05f8b22b8df6"]);
  assert.equal(r.fork, "0a5cb7a5-c39d-4c39-a11b-05f8b22b8df6");
});

test("parseArguments allows bare --fork with exec and prompt", async () => {
  const r = await parseArguments(["--fork", "--exec", "--prompt", "continue"]);
  assert.equal(r.fork, true);
  assert.equal(r.exec, true);
  assert.equal(r.prompt, "continue");
});

test("parseArguments returns defaults for empty args", async () => {
  const r = await parseArguments([]);
  assert.ok(!("message" in r));
  assert.equal(r.prompt, undefined);
  assert.equal(r.resume, undefined);
  assert.equal(r.version, false);
  assert.equal(r.help, false);
  assert.equal(r.exec, false);
});

// ── parseArguments: --last flag ─────────────────────────────────────────────────

test("parseArguments returns last: true for --last", async () => {
  const r = await parseArguments(["--last"]);
  assert.ok(!("message" in r));
  assert.equal(r.last, true);
  assert.equal(r.resume, undefined);
});

test("parseArguments returns last: true for -l", async () => {
  const r = await parseArguments(["-l"]);
  assert.ok(!("message" in r));
  assert.equal(r.last, true);
});

test("parseArguments returns last: false when not passed", async () => {
  const r = await parseArguments(["-p", "test"]);
  assert.ok(!("message" in r));
  assert.equal(r.last, false);
});

test("parseArguments handles --last with -p", async () => {
  const r = await parseArguments(["--last", "-p", "hello"]);
  assert.ok(!("message" in r));
  assert.equal(r.last, true);
  assert.equal(r.prompt, "hello");
});

test("parseArguments handles -l with -p and -x", async () => {
  const r = await parseArguments(["-l", "-x", "-p", "hello"]);
  assert.ok(!("message" in r));
  assert.equal(r.last, true);
  assert.equal(r.exec, true);
  assert.equal(r.prompt, "hello");
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

test("parseArguments handles exec prompt with a session ID", async () => {
  const r = await parseArguments(["-x", "-p", "hello", "-r", "0a5cb7a5-c39d-4c39-a11b-05f8b22b8df6"]);
  assert.equal(r.exec, true);
  assert.equal(r.prompt, "hello");
  assert.equal(r.resume, "0a5cb7a5-c39d-4c39-a11b-05f8b22b8df6");
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

test("parseArguments exits when exec mode has no -p", async () => {
  await withMockedExit(async (exitSpy) => {
    try {
      await parseArguments(["-x"]);
    } catch {
      /* expected */
    }
    assert.ok(exitSpy.calls.includes(1));
  });
});

test("parseArguments exits when exec prompt is whitespace", async () => {
  await withMockedExit(async (exitSpy) => {
    try {
      await parseArguments(["-x", "-p", "   "]);
    } catch {
      /* expected */
    }
    assert.ok(exitSpy.calls.includes(1));
  });
});

test("parseArguments does not use a positional query as the exec prompt", async () => {
  await withMockedExit(async (exitSpy) => {
    try {
      await parseArguments(["-x", "positional prompt"]);
    } catch {
      /* expected */
    }
    assert.ok(exitSpy.calls.includes(1));
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

test("parseArguments exits on invalid --fork session ID", async () => {
  await withMockedExit(async (exitSpy) => {
    try {
      await parseArguments(["--fork", "not-a-uuid"]);
    } catch {
      /* expected */
    }
    assert.ok(exitSpy.calls.length >= 1);
  });
});

test("parseArguments exits when --fork is combined with --resume", async () => {
  await withMockedExit(async (exitSpy) => {
    try {
      await parseArguments([
        "--fork",
        "0a5cb7a5-c39d-4c39-a11b-05f8b22b8df6",
        "--resume",
        "1a5cb7a5-c39d-4c39-a11b-05f8b22b8df6",
      ]);
    } catch {
      /* expected */
    }
    assert.ok(exitSpy.calls.length >= 1);
  });
});

test("parseArguments exits when --fork is combined with --last", async () => {
  await withMockedExit(async (exitSpy) => {
    try {
      await parseArguments(["--fork", "--last"]);
    } catch {
      /* expected */
    }
    assert.ok(exitSpy.calls.length >= 1);
  });
});

test("parseArguments exits when --last is combined with --resume", async () => {
  await withMockedExit(async (exitSpy) => {
    try {
      await parseArguments(["--last", "--resume", "0a5cb7a5-c39d-4c39-a11b-05f8b22b8df6"]);
    } catch {
      /* expected */
    }
    assert.ok(exitSpy.calls.length >= 1);
  });
});

test("parseArguments exits when --last is combined with bare --resume", async () => {
  await withMockedExit(async (exitSpy) => {
    try {
      await parseArguments(["--last", "--resume"]);
    } catch {
      /* expected */
    }
    assert.ok(exitSpy.calls.length >= 1);
  });
});

for (const flag of ["-s", "--settings"]) {
  test(`parseArguments accepts ${flag} with all session modes`, async () => {
    for (const mode of [[], ["-x", "-p", "hello"], ["-r"], ["-f"], ["-l"]]) {
      const parsed = await parseArguments([flag, "config/custom settings.json", ...mode]);
      assert.equal(parsed.settingsFile, "config/custom settings.json");
    }
    assert.equal((await parseArguments([flag, "/tmp/settings.json"])).settingsFile, "/tmp/settings.json");
    assert.equal((await parseArguments([])).settingsFile, undefined);
  });
  for (const args of [[flag], [flag, ""], [flag, "   "], [flag, "--exec"], ["--plus", flag, "settings.json"]]) {
    test(`parseArguments rejects settings arguments ${JSON.stringify(args)}`, async () => {
      await withMockedExit(async () => {
        await assert.rejects(parseArguments(args), /process.exit\(1\)/);
      });
    });
  }
}

test("--doctor accepts only an optional settings input", async () => {
  const parsed = await parseArguments(["--doctor", "-s", "custom.json"]);
  assert.equal(parsed.doctor, true);
  assert.equal(parsed.settingsFile, "custom.json");
  assert.equal((await parseArguments([])).doctor, false);
  for (const flags of [
    ["--plus"],
    ["--json"],
    ["-x"],
    ["-p", "hi"],
    ["hi"],
    ["-r"],
    ["-f"],
    ["-l"],
    ["--session-id", "x"],
  ]) {
    await withMockedExit(async () => {
      await assert.rejects(parseArguments(["--doctor", ...flags]), /process.exit\(1\)/);
    });
  }
});
