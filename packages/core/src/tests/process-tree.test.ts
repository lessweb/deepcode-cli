import { test } from "node:test";
import assert from "node:assert/strict";
import { killProcessTree, runWindowsTaskkill } from "../common/process-tree";

test("runWindowsTaskkill invokes taskkill for the full process tree", () => {
  const calls: Array<{ command: string; args: string[]; options: { stdio: "ignore"; windowsHide: true } }> = [];

  const ok = runWindowsTaskkill(1234, (command, args, options) => {
    calls.push({ command, args, options });
    return { status: 0 };
  });

  assert.equal(ok, true);
  assert.deepEqual(calls, [
    {
      command: "taskkill",
      args: ["/PID", "1234", "/T", "/F"],
      options: { stdio: "ignore", windowsHide: true },
    },
  ]);
});

test("runWindowsTaskkill reports failure for non-zero exits and spawn errors", () => {
  assert.equal(
    runWindowsTaskkill(1234, () => ({
      status: 1,
    })),
    false
  );
  assert.equal(
    runWindowsTaskkill(1234, () => ({
      status: null,
      error: new Error("taskkill missing"),
    })),
    false
  );
});

test("killProcessTree uses taskkill on Windows", () => {
  const killed: number[] = [];

  const ok = killProcessTree(1234, "SIGKILL", {
    platform: "win32",
    runTaskkill: (pid) => {
      killed.push(pid);
      return true;
    },
    killPid: () => {
      throw new Error("direct kill should not be used");
    },
  });

  assert.equal(ok, true);
  assert.deepEqual(killed, [1234]);
});

test("killProcessTree falls back to direct kill on Windows taskkill failure", () => {
  const directKills: Array<{ pid: number; signal: NodeJS.Signals }> = [];

  const ok = killProcessTree(1234, "SIGTERM", {
    platform: "win32",
    runTaskkill: () => false,
    killPid: (pid, signal) => {
      directKills.push({ pid, signal });
    },
  });

  assert.equal(ok, true);
  assert.deepEqual(directKills, [{ pid: 1234, signal: "SIGTERM" }]);
});

test("killProcessTree returns false on Windows when all kill attempts fail", () => {
  const ok = killProcessTree(1234, "SIGKILL", {
    platform: "win32",
    runTaskkill: () => false,
    killPid: () => {
      throw new Error("missing process");
    },
  });

  assert.equal(ok, false);
});

test("killProcessTree kills a process group before direct PID on non-Windows platforms", () => {
  const kills: Array<{ pid: number; signal: NodeJS.Signals }> = [];

  const ok = killProcessTree(1234, "SIGKILL", {
    platform: "darwin",
    killPid: (pid, signal) => {
      kills.push({ pid, signal });
    },
  });

  assert.equal(ok, true);
  assert.deepEqual(kills, [{ pid: -1234, signal: "SIGKILL" }]);
});

test("killProcessTree falls back to direct PID on non-Windows group failure", () => {
  const kills: Array<{ pid: number; signal: NodeJS.Signals }> = [];

  const ok = killProcessTree(1234, "SIGTERM", {
    platform: "linux",
    killPid: (pid, signal) => {
      kills.push({ pid, signal });
      if (pid < 0) {
        throw new Error("no process group");
      }
    },
  });

  assert.equal(ok, true);
  assert.deepEqual(kills, [
    { pid: -1234, signal: "SIGTERM" },
    { pid: 1234, signal: "SIGTERM" },
  ]);
});

test("killProcessTree can skip non-Windows process group killing", () => {
  const kills: Array<{ pid: number; signal: NodeJS.Signals }> = [];

  const ok = killProcessTree(1234, "SIGTERM", {
    platform: "linux",
    killGroupOnNonWindows: false,
    killPid: (pid, signal) => {
      kills.push({ pid, signal });
    },
  });

  assert.equal(ok, true);
  assert.deepEqual(kills, [{ pid: 1234, signal: "SIGTERM" }]);
});

test("killProcessTree ignores invalid PIDs", () => {
  for (const pid of [0, -1, 1.5, Number.NaN]) {
    assert.equal(
      killProcessTree(pid, "SIGKILL", {
        platform: "win32",
        runTaskkill: () => {
          throw new Error("taskkill should not be used");
        },
        killPid: () => {
          throw new Error("direct kill should not be used");
        },
      }),
      false
    );
  }
});
