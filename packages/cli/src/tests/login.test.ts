import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runLogin } from "../commands/login";

/** Redirect $HOME to a temp dir and silence stdout while fn runs. */
async function withTempHome<T>(fn: () => Promise<T>): Promise<T> {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "dc-login-"));
  const previousHome = process.env.HOME;
  const previousExitCode = process.exitCode;
  const origStdoutWrite = process.stdout.write.bind(process.stdout);

  process.env.HOME = tmpHome;
  // runLogin prints a confirmation; swallow it during tests
  process.stdout.write = (() => true) as never;
  try {
    return await fn();
  } finally {
    process.env.HOME = previousHome;
    process.exitCode = previousExitCode;
    process.stdout.write = origStdoutWrite;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
}

function readSettings(homeDir: string): Record<string, unknown> {
  const settingsPath = path.join(homeDir, ".deepcode", "settings.json");
  return JSON.parse(fs.readFileSync(settingsPath, "utf8")) as Record<string, unknown>;
}

test("runLogin --api-key writes a ready-to-use settings file", async () => {
  await withTempHome(async () => {
    await runLogin({ apiKey: "sk-test-123", show: false });

    const written = readSettings(process.env.HOME!);
    const env = written.env as Record<string, string>;
    assert.equal(env.API_KEY, "sk-test-123");
    assert.equal(env.MODEL, "deepseek-v4-pro");
    assert.equal(env.BASE_URL, "https://api.deepseek.com");
    assert.equal(written.thinkingEnabled, true);
    assert.equal(written.reasoningEffort, "max");
  });
});

test("runLogin preserves existing custom fields when updating the key", async () => {
  await withTempHome(async () => {
    // seed an existing settings file with custom fields
    const settingsDir = path.join(process.env.HOME!, ".deepcode");
    fs.mkdirSync(settingsDir, { recursive: true });
    fs.writeFileSync(
      path.join(settingsDir, "settings.json"),
      JSON.stringify({ env: { MODEL: "deepseek-v3.2" }, thinkingEnabled: false })
    );

    await runLogin({ apiKey: "sk-new", show: false });

    const written = readSettings(process.env.HOME!);
    const env = written.env as Record<string, string>;
    assert.equal(env.API_KEY, "sk-new"); // updated
    assert.equal(env.MODEL, "deepseek-v3.2"); // preserved
    assert.equal(written.thinkingEnabled, false); // preserved
    assert.equal(env.BASE_URL, "https://api.deepseek.com"); // filled in
    assert.equal(written.reasoningEffort, "max"); // filled in
  });
});
