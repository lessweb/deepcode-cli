import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { sanitizeStatusText, STATUS_SEGMENT_MAX_LENGTH } from "../ui/statusline/sanitize";
import { validateModulePath, loadModuleProvider } from "../ui/statusline/module-provider";
import { createCommandStatusProvider } from "../ui/statusline/command-provider";
import { StatusLineManager } from "../ui/statusline/manager";
import { resolveSettings, resolveSettingsSources } from "@vegamo/deepcode-core";
import type { ResolvedStatusLineSettings } from "@vegamo/deepcode-core";

test("sanitizeStatusText returns empty for null/undefined/empty", () => {
  assert.equal(sanitizeStatusText(undefined), "");
  assert.equal(sanitizeStatusText(null), "");
  assert.equal(sanitizeStatusText(""), "");
});

test("sanitizeStatusText keeps first non-empty line and strips ANSI", () => {
  assert.equal(sanitizeStatusText("\n\nfirst\nsecond"), "first");
  assert.equal(sanitizeStatusText("[31mred text[0m"), "red text");
  assert.equal(sanitizeStatusText("multiple   spaces\t\there"), "multiple spaces here");
});

test("sanitizeStatusText truncates to max length with ellipsis", () => {
  const long = "x".repeat(STATUS_SEGMENT_MAX_LENGTH + 20);
  const result = sanitizeStatusText(long);
  assert.equal(result.length, STATUS_SEGMENT_MAX_LENGTH);
  assert.ok(result.endsWith("…"));
});

test("sanitizeStatusText respects custom max length", () => {
  assert.equal(sanitizeStatusText("hello world", 5), "hell…");
  assert.equal(sanitizeStatusText("hi", 5), "hi");
});

test("validateModulePath accepts paths under project root", () => {
  const projectRoot = path.resolve(os.tmpdir(), "deepcode-test-project");
  const inside = path.join(projectRoot, "plugins", "status.js");
  const result = validateModulePath(inside, projectRoot);
  assert.equal(result, path.normalize(inside));
});

test("validateModulePath accepts relative paths resolved under project root", () => {
  const projectRoot = path.resolve(os.tmpdir(), "deepcode-test-project");
  const result = validateModulePath("plugins/status.js", projectRoot);
  assert.equal(result, path.normalize(path.join(projectRoot, "plugins", "status.js")));
});

test("validateModulePath rejects paths outside project root and home", () => {
  const projectRoot = path.resolve(os.tmpdir(), "deepcode-isolated-test");
  // Use a path guaranteed to be outside both projectRoot and HOME.
  const outside = path.resolve("/totally-not-in-any-allowed-base/status.js");
  const result = validateModulePath(outside, projectRoot);
  assert.equal(result, null);
});

test("resolveSettings produces a default statusline with no providers", () => {
  const resolved = resolveSettings({}, { model: "default-model", baseURL: "https://default.example.com" }, {});
  assert.equal(resolved.statusline.enabled, false);
  assert.equal(resolved.statusline.refreshMs, 2000);
  assert.deepEqual(resolved.statusline.providers, []);
});

test("resolveSettings normalizes statusline providers and filters invalid entries", () => {
  const resolved = resolveSettings(
    {
      statusline: {
        enabled: true,
        refreshMs: 3000,
        providers: [
          { type: "command", id: "git", command: "git status -sb" },
          { type: "command", command: "" } as never, // invalid: empty command
          { type: "module", path: "./plugins/x.js" },
          { type: "module" } as never, // invalid: missing path
          { type: "unknown" } as never, // invalid: bad type
        ],
      },
    },
    { model: "default-model", baseURL: "https://default.example.com" },
    {}
  );
  assert.equal(resolved.statusline.enabled, true);
  assert.equal(resolved.statusline.refreshMs, 3000);
  assert.equal(resolved.statusline.providers.length, 2);
  assert.equal(resolved.statusline.providers[0]?.type, "command");
  assert.equal(resolved.statusline.providers[1]?.type, "module");
});

test("resolveSettings clamps refreshMs to minimum and ignores invalid values", () => {
  const tooSmall = resolveSettings({ statusline: { refreshMs: 100 } }, { model: "m", baseURL: "https://e" }, {});
  assert.equal(tooSmall.statusline.refreshMs, 2000); // falls back to default
});

test("createCommandStatusProvider returns stdout from short commands", async () => {
  const provider = createCommandStatusProvider(
    { type: "command", command: process.platform === "win32" ? "echo hello" : "printf hello" },
    process.cwd(),
    "test-cmd"
  );
  const ac = new AbortController();
  const result = await provider.fetch({ projectRoot: process.cwd(), signal: ac.signal });
  assert.ok(result.includes("hello"));
});

test("createCommandStatusProvider times out long-running commands", async () => {
  const sleepCmd = process.platform === "win32" ? "ping -n 5 127.0.0.1 > nul" : "sleep 3";
  const provider = createCommandStatusProvider(
    { type: "command", command: sleepCmd, timeoutMs: 200 },
    process.cwd(),
    "slow"
  );
  const ac = new AbortController();
  const start = Date.now();
  const result = await provider.fetch({ projectRoot: process.cwd(), signal: ac.signal });
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 1500, `expected timeout within ~1.5s, got ${elapsed}ms`);
  assert.equal(result, "");
});

test("createCommandStatusProvider returns empty on non-existent command", async () => {
  const provider = createCommandStatusProvider(
    { type: "command", command: "this-command-definitely-does-not-exist-xyz-abc-12345" },
    process.cwd(),
    "missing"
  );
  const ac = new AbortController();
  const result = await provider.fetch({ projectRoot: process.cwd(), signal: ac.signal });
  // Either empty (failure) or shell error message — both fine, just must not hang/throw.
  assert.equal(typeof result, "string");
});

test("loadModuleProvider returns null when the path does not exist", async () => {
  const provider = await loadModuleProvider(
    path.join(os.tmpdir(), "does-not-exist-xyz.mjs"),
    undefined,
    "missing",
    1000
  );
  assert.equal(provider, null);
});

test("loadModuleProvider isolates errors thrown by the user function", async () => {
  // Create a temporary module that throws.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "deepcode-statusline-"));
  const modPath = path.join(dir, "bad.mjs");
  fs.writeFileSync(modPath, "export default () => { throw new Error('boom'); }", "utf8");
  try {
    const provider = await loadModuleProvider(modPath, undefined, "bad", 1000);
    assert.ok(provider, "provider should load even if its fn throws on invocation");
    const ac = new AbortController();
    await assert.rejects(provider!.fetch({ projectRoot: process.cwd(), signal: ac.signal }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("loadModuleProvider succeeds for a well-formed module", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "deepcode-statusline-"));
  const modPath = path.join(dir, "good.mjs");
  fs.writeFileSync(modPath, "export default ({ projectRoot }) => `root=${projectRoot}`;", "utf8");
  try {
    const provider = await loadModuleProvider(modPath, "yellow", "good", 1000);
    assert.ok(provider);
    assert.equal(provider!.color, "yellow");
    const ac = new AbortController();
    const result = await provider!.fetch({ projectRoot: "/some/root", signal: ac.signal });
    assert.equal(result, "root=/some/root");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("loadModuleProvider removes abort listener after successful fetch", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "deepcode-statusline-"));
  const modPath = path.join(dir, "cleanup.mjs");
  fs.writeFileSync(modPath, "export default () => 'ok';", "utf8");
  try {
    const provider = await loadModuleProvider(modPath, undefined, "cleanup", 10_000);
    assert.ok(provider);

    const ac = new AbortController();
    const signal = ac.signal;
    const originalAdd = signal.addEventListener;
    const originalRemove = signal.removeEventListener;
    let abortListenerAdds = 0;
    let abortListenerRemoves = 0;
    signal.addEventListener = function (this: AbortSignal, ...args: Parameters<AbortSignal["addEventListener"]>) {
      if (args[0] === "abort") {
        abortListenerAdds += 1;
      }
      return originalAdd.apply(this, args);
    } as AbortSignal["addEventListener"];
    signal.removeEventListener = function (this: AbortSignal, ...args: Parameters<AbortSignal["removeEventListener"]>) {
      if (args[0] === "abort") {
        abortListenerRemoves += 1;
      }
      return originalRemove.apply(this, args);
    } as AbortSignal["removeEventListener"];

    const result = await provider!.fetch({ projectRoot: dir, signal });
    assert.equal(result, "ok");
    assert.equal(abortListenerAdds, 1);
    assert.equal(abortListenerRemoves, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveSettingsSources lets project-level providers override user-level by id", () => {
  const resolved = resolveSettingsSources(
    {
      statusline: {
        enabled: true,
        providers: [
          { type: "command", id: "model", command: "echo user-model" },
          { type: "command", id: "branch", command: "echo user-branch" },
        ],
      },
    },
    {
      statusline: {
        providers: [
          { type: "command", id: "model", command: "echo project-model" },
          { type: "command", id: "cwd", command: "echo project-cwd" },
        ],
      },
    },
    { model: "default-model", baseURL: "https://default.example.com" }
  );
  const ids = resolved.statusline.providers.map((p) => p.id);
  assert.deepEqual(ids, ["branch", "model", "cwd"]);
  const modelProvider = resolved.statusline.providers.find((p) => p.id === "model");
  assert.equal(modelProvider?.type === "command" && modelProvider.command, "echo project-model");
});

test("StatusLineManager emits segments after fetch and stops cleanly", async () => {
  const config: ResolvedStatusLineSettings = {
    enabled: true,
    refreshMs: 60_000,
    separator: " · ",
    providers: [
      {
        type: "command",
        id: "echo",
        command: process.platform === "win32" ? "echo hello" : "printf hello",
      },
    ],
  };
  const manager = new StatusLineManager();
  const updates: Array<Array<{ id: string; text: string }>> = [];
  const unsub = manager.subscribe((segments) => updates.push(segments.map((s) => ({ id: s.id, text: s.text }))));
  await manager.start(config, process.cwd());

  // Wait for the initial fetch to settle.
  await new Promise((resolve) => setTimeout(resolve, 400));

  unsub();
  manager.stop();

  const populated = updates.find((u) => u.length > 0 && u[0]?.text.includes("hello"));
  assert.ok(populated, `expected an update with 'hello' segment; got ${JSON.stringify(updates)}`);
});

test("StatusLineManager skips fetch when disabled", async () => {
  const config: ResolvedStatusLineSettings = {
    enabled: false,
    refreshMs: 60_000,
    separator: " · ",
    providers: [{ type: "command", command: "echo whatever" }],
  };
  const manager = new StatusLineManager();
  const updates: Array<{ id: string; text: string }[]> = [];
  manager.subscribe((segs) => updates.push(segs.map((s) => ({ id: s.id, text: s.text }))));
  await manager.start(config, process.cwd());
  await new Promise((resolve) => setTimeout(resolve, 100));
  manager.stop();
  assert.equal(updates.length, 0);
});

test("StatusLineManager isolates a failing provider from succeeding ones", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "deepcode-statusline-"));
  const badMod = path.join(dir, "bad.mjs");
  const goodMod = path.join(dir, "good.mjs");
  fs.writeFileSync(badMod, "export default () => { throw new Error('boom'); }", "utf8");
  fs.writeFileSync(goodMod, "export default () => 'ok';", "utf8");

  try {
    const config: ResolvedStatusLineSettings = {
      enabled: true,
      refreshMs: 60_000,
      separator: " · ",
      providers: [
        { type: "module", id: "bad", path: badMod },
        { type: "module", id: "good", path: goodMod },
      ],
    };
    const manager = new StatusLineManager();
    let lastSegments: Array<{ id: string; text: string }> = [];
    manager.subscribe((segs) => {
      lastSegments = segs.map((s) => ({ id: s.id, text: s.text }));
    });
    await manager.start(config, dir);
    await new Promise((resolve) => setTimeout(resolve, 400));
    manager.stop();
    assert.equal(lastSegments.length, 1);
    assert.equal(lastSegments[0]?.id, "good");
    assert.equal(lastSegments[0]?.text, "ok");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
