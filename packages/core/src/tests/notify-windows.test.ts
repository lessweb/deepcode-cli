import { test } from "node:test";
import assert from "node:assert/strict";
import { launchNotifyScript, type NotifySpawn } from "../common/notify";

const bashPath = "C:\\Program Files\\Git\\bin\\bash.exe";
const runtime = { platform: "win32" as const, findGitBashPath: () => bashPath };

function captureSpawn(errorCode?: string) {
  const calls: Parameters<NotifySpawn>[] = [];
  let unrefs = 0;
  const spawn: NotifySpawn = (...args) => {
    calls.push(args);
    return {
      once(_event, listener) {
        if (errorCode) listener({ code: errorCode } as NodeJS.ErrnoException);
        return this;
      },
      unref() {
        unrefs++;
      },
    };
  };
  return { calls, spawn, unrefs: () => unrefs };
}

test("Windows shell notifications pass the script as one Git Bash argument and preserve context", () => {
  const paths = [
    ["C:\\Users\\张 三\\O'Brien & $(echo test)\\notify.sh", "/c/Users/张 三/O'Brien & $(echo test)/notify.sh"],
    ["D:/通知 文件/notify.SH", "/d/通知 文件/notify.SH"],
    ["/c/Users/you/notify.sh", "/c/Users/you/notify.sh"],
    ["\\\\server\\share\\通知 文件\\notify.sh", "//server/share/通知 文件/notify.sh"],
  ];
  for (const [script, bashScript] of paths) {
    const capture = captureSpawn();
    launchNotifyScript(
      `  ${script}  `,
      15999,
      "C:\\project",
      capture.spawn,
      { NOTIFY_CUSTOM: "value" },
      { status: "failed", failReason: "error", body: "a\nb", title: "test", sessionId: "session-123" },
      runtime
    );
    assert.equal(capture.calls.length, 1);
    const [command, args, options] = capture.calls[0];
    assert.equal(command, bashPath);
    assert.deepEqual(args, ["--noprofile", "--norc", "--", bashScript]);
    assert.equal(options.cwd, "C:\\project");
    assert.equal(options.detached, false);
    assert.equal(options.windowsHide, true);
    assert.equal(options.stdio, "ignore");
    assert.equal(options.env?.NOTIFY_CUSTOM, "value");
    assert.equal(options.env?.DURATION, "15");
    assert.equal(options.env?.STATUS, "failed");
    assert.equal(options.env?.FAIL_REASON, "error");
    assert.equal(options.env?.BODY, "a\nb");
    assert.equal(options.env?.TITLE, "test");
    assert.equal(options.env?.SESSION_ID, "session-123");
    assert.equal(capture.unrefs(), 1);
  }
});

test("Windows non-shell notifications retain direct execution", () => {
  for (const script of ["C:\\notify.exe", "C:\\notify.py", "C:\\notify.cmd"]) {
    const capture = captureSpawn();
    launchNotifyScript(
      script,
      0,
      undefined,
      capture.spawn,
      {},
      {},
      {
        platform: "win32",
        findGitBashPath: () => {
          assert.fail("Non-shell notifications must not look up Git Bash");
        },
      }
    );
    assert.equal(capture.calls.length, 1);
    assert.equal(capture.calls[0][0], script);
    assert.deepEqual(capture.calls[0][1], []);
  }
});

test("Windows notification lookup and spawn failures do not escape or start a fallback shell", () => {
  const capture = captureSpawn();
  assert.doesNotThrow(() =>
    launchNotifyScript(
      "C:\\notify.sh",
      0,
      undefined,
      capture.spawn,
      {},
      {},
      {
        platform: "win32",
        findGitBashPath: () => {
          throw new Error("Git Bash not found");
        },
      }
    )
  );
  assert.equal(capture.calls.length, 0);

  const throwingSpawn: NotifySpawn = () => {
    throw new Error("spawn failed");
  };
  assert.doesNotThrow(() => launchNotifyScript("C:\\notify.sh", 0, undefined, throwingSpawn, {}, {}, runtime));

  for (const code of ["ENOENT", "EACCES", "ENOEXEC"]) {
    const failed = captureSpawn(code);
    assert.doesNotThrow(() => launchNotifyScript("C:\\notify.sh", 0, undefined, failed.spawn, {}, {}, runtime));
    assert.equal(failed.calls.length, 1);
    assert.equal(failed.unrefs(), 1);
  }
});

test("empty notification paths do not look up Git Bash or spawn a process", () => {
  const capture = captureSpawn();
  for (const script of [undefined, "", "  "]) {
    launchNotifyScript(
      script,
      0,
      undefined,
      capture.spawn,
      {},
      {},
      {
        platform: "win32",
        findGitBashPath: () => {
          assert.fail("Empty paths must not look up Git Bash");
        },
      }
    );
  }
  assert.equal(capture.calls.length, 0);
});
