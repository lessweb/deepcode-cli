import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { inspectSettings } from "@vegamo/deepcode-core/settings-diagnostics";
import { resolvePlusLlmHost } from "@vegamo/deepcode-core/common/plus-subscription";
import { inspectApi, formatDoctorReport, redactDoctorText } from "../doctor";
import { inspectUpdates, checkWritable, executablePaths, runDoctorCommand, type CommandRunner } from "../doctor-system";

function fixture(t: TestContext) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "doctor-cli-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const write = (relative: string, value: unknown) => {
    const file = path.join(home, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value));
  };
  return { home, projectRoot: path.join(home, "project"), env: {}, write };
}

test("API doctor checks both effective keys and resolves Plus fallback using runtime semantics", async (t) => {
  const f = fixture(t);
  const key = "sk-" + "a".repeat(26);
  f.write(".deepcode/settings.json", {
    model: "deepseek-flash",
    env: { API_KEY: "regular-secret", BASE_URL: "https://api.example/v1" },
  });
  f.write(".deepcode-plus/settings.json", { env: { PLUS_API_KEY: key } });
  const seen: Array<{ apiKey: string; baseURL: string }> = [];
  const checks = await inspectApi(inspectSettings(f), async (options) => {
    seen.push(options);
    return options.apiKey === key
      ? { outcome: "forbidden", httpStatus: 403, detail: "HTTP 403" }
      : { outcome: "available", httpStatus: 200, modelListed: true, detail: "Accessible" };
  });
  assert.equal(seen.length, 2);
  assert.ok(seen.some((item) => item.baseURL === `${resolvePlusLlmHost(key)}/plugin/openai`));
  assert.ok(
    checks.some(
      (check) => check.name === "Selected API" && check.detail.startsWith("Regular API") && check.status === "PASS"
    )
  );
  assert.ok(
    checks.some(
      (check) => check.name === "Plus API" && check.status === "WARN" && check.detail.includes("other Plus services")
    )
  );
  assert.equal(checks.filter((check) => check.status === "FAIL").length, 0);
});

test("forced Plus rejection fails; off selects regular; unknown Plus access with a regular key falls back", async (t) => {
  const f = fixture(t);
  const key = "sk-" + "b".repeat(24);
  f.write(".deepcode/settings.json", { env: { API_KEY: "regular" } });
  for (const subscriptionPlan of ["on", "off", "default"]) {
    f.write(".deepcode-plus/settings.json", { env: { PLUS_API_KEY: key }, subscriptionPlan });
    const checks = await inspectApi(inspectSettings(f), async ({ apiKey }) =>
      apiKey === key
        ? {
            outcome: subscriptionPlan === "on" ? "authentication" : "unavailable",
            httpStatus: subscriptionPlan === "on" ? 401 : undefined,
            detail: "Cannot verify",
          }
        : { outcome: "available", httpStatus: 200, modelListed: false, detail: "Accessible" }
    );
    assert.equal(
      checks.some((check) => check.name === "Plus API" && check.status === "FAIL"),
      subscriptionPlan === "on"
    );
    assert.ok(checks.some((check) => check.name === "Regular API model" && check.status === "WARN"));
  }
});

test("HTTP 200 with malformed model data still matches Plus subscription routing", async (t) => {
  const f = fixture(t);
  f.write(".deepcode/settings.json", { env: { API_KEY: "regular" } });
  f.write(".deepcode-plus/settings.json", { env: { PLUS_API_KEY: "sk-" + "c".repeat(26) } });
  const checks = await inspectApi(inspectSettings(f), async () => ({
    outcome: "unavailable",
    httpStatus: 200,
    detail: "Unexpected model list",
  }));
  assert.ok(checks.some((check) => check.name === "Selected API" && check.detail.startsWith("DeepCode Plus")));
  assert.ok(checks.some((check) => check.name === "Plus API model" && check.status === "SKIP"));
});

test("missing required key and invalid base URL fail without sending a request", async (t) => {
  const f = fixture(t);
  let count = 0;
  const probe = async () => {
    count++;
    return { outcome: "available" as const, detail: "Accessible" };
  };
  assert.ok(
    (await inspectApi(inspectSettings(f), probe)).some(
      (check) => check.name === "Selected API" && check.status === "FAIL"
    )
  );
  f.write(".deepcode/settings.json", { env: { API_KEY: "secret", BASE_URL: "file:///tmp/models" } });
  assert.ok(
    (await inspectApi(inspectSettings(f), probe)).some(
      (check) => check.name === "Regular API" && check.status === "FAIL"
    )
  );
  assert.equal(count, 0);
});

test("report redacts credentials, URL userinfo and parameters, and terminal control sequences", () => {
  const secret = "do/not-print-me";
  const report = formatDoctorReport(
    [
      {
        name: "Test",
        checks: [
          {
            status: "FAIL",
            name: "Example",
            detail: `https://user:password@host.test/v1?token=123#private ${secret} ${encodeURIComponent(secret)} sk-test-secret\u001b[2J\nnext`,
          },
        ],
      },
    ],
    [secret]
  );
  assert.doesNotMatch(report, /password|token=123|private|do\/not-print-me|do%2Fnot-print-me|sk-test-secret|\u001b/);
  assert.match(report, /1 failed/);
  assert.match(redactDoctorText("https://host.test/v1?key=a&secret=b"), /key=redacted&secret=redacted/);
});

test("updates inspect registry, target permissions and cached state without running installation", async (t) => {
  const f = fixture(t);
  f.write(".deepcode/update-check.json", { pending: { latestVersion: "9.0.0" }, ignoredVersions: ["9.0.0"] });
  const commands: string[] = [];
  const run: CommandRunner = async (_command, args) => {
    const arg = args.join(" ");
    commands.push(arg);
    const values: Record<string, string> = {
      "--version": "10.9.4",
      "config get registry": "https://registry.npmjs.org/",
      "config get @vegamo:registry": "https://custom.invalid/",
      "prefix -g": f.home,
      "root -g": path.join(f.home, "lib/node_modules"),
      "config get cache": path.join(f.home, "cache"),
    };
    return { code: 0, stdout: values[arg], stderr: "" };
  };
  const registries: string[] = [];
  const checks = await inspectUpdates({
    home: f.home,
    run,
    registryProbe: async (registry) => {
      registries.push(registry);
      return { status: "PASS", name: "Test registry", detail: registry };
    },
  });
  assert.ok(registries.includes("https://custom.invalid/"));
  assert.ok(!registries.includes("https://registry.npmjs.org/"));
  assert.ok(checks.some((check) => check.name === "Ignored updates"));
  assert.ok(checks.some((check) => check.name === "Pending update" && check.detail.includes("9.0.0")));
  assert.ok(commands.every((command) => !/install|view|update/.test(command)));
  assert.equal(fs.existsSync(path.join(f.home, "cache")), false);
  const missing = await inspectUpdates({
    home: f.home,
    run: async () => ({ code: null, stdout: "", stderr: "", error: "ENOENT" }),
  });
  assert.equal(missing[0].status, "WARN");
});

test("directory checks and PATH inspection use existing files without creating state", (t) => {
  const f = fixture(t);
  assert.equal(checkWritable(path.join(f.home, "not-created"), "State").status, "PASS");
  assert.equal(fs.existsSync(path.join(f.home, "not-created")), false);
  const file = path.join(f.home, process.platform === "win32" ? "deepcode.cmd" : "deepcode");
  fs.writeFileSync(file, "test", { mode: 0o755 });
  assert.equal(checkWritable(file, "State").status, "FAIL");
  assert.deepEqual(executablePaths("deepcode", { PATH: f.home }), [file]);
});

test("command runner bounds output and reports missing executables", async () => {
  const result = await runDoctorCommand(process.execPath, ["-e", "process.stdout.write('x'.repeat(100000))"]);
  assert.equal(result.code, 0);
  assert.equal(result.stdout.length, 65536);
  assert.equal((await runDoctorCommand("deepcode-nonexistent-command", [])).error, "ENOENT");
});

test("doctor bootstrap runs with broken settings, no TTY, no npm, and no normal app import", (t) => {
  const f = fixture(t);
  const settings = path.join(f.home, "broken.json");
  fs.writeFileSync(settings, '{"secret":"do-not-print-me", broken');
  const cli = fileURLToPath(new URL("../cli.tsx", import.meta.url));
  const tsx = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
  const config = fileURLToPath(new URL("../../tsconfig.json", import.meta.url));
  const result = spawnSync(process.execPath, ["--import", tsx, cli, "--doctor", "--settings", settings], {
    cwd: f.home,
    encoding: "utf8",
    timeout: 15000,
    env: { HOME: f.home, USERPROFILE: f.home, PATH: "", TSX_TSCONFIG_PATH: config },
  });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /Invalid JSON/);
  assert.match(result.stdout, /API checks/);
  assert.match(result.stdout, /npm/);
  assert.doesNotMatch(result.stdout + result.stderr, /do-not-print-me|Unhandled|UpdatePrompt/);
  assert.equal(fs.existsSync(path.join(f.home, ".deepcode")), false);
});

test("registry diagnostics classify public metadata, access failures and malformed responses", async (t) => {
  const { inspectRegistry } = await import("../doctor-system");
  const responses = [
    new Response(JSON.stringify({ version: "1.2.3" })),
    new Response("denied", { status: 403 }),
    new Response("not json"),
    new Response(JSON.stringify({ version: "unexpected-secret" })),
    new Response("x".repeat(65537)),
  ];
  const requests: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: URL) => {
    requests.push(url.toString());
    return responses.shift()!;
  });
  assert.equal((await inspectRegistry("https://registry.example/npm/")).status, "PASS");
  assert.match(requests[0], /\/npm\/@vegamo%2fdeepcode-cli\/latest$/);
  assert.match((await inspectRegistry("https://registry.example/")).detail, /HTTP 403/);
  assert.match((await inspectRegistry("https://registry.example/")).detail, /Invalid package metadata/);
  assert.doesNotMatch((await inspectRegistry("https://registry.example/")).detail, /unexpected-secret/);
  assert.match((await inspectRegistry("https://registry.example/")).detail, /oversized/);
  assert.equal((await inspectRegistry("file:///tmp/private")).status, "WARN");
  assert.equal(requests.length, 5);
});

test("Windows shell diagnosis uses bounded commands and reports missing Git Bash", async () => {
  const { inspectShell } = await import("../doctor-system");
  const calls: string[] = [];
  const result = await inspectShell(async (command, args) => {
    calls.push([command, ...args].join(" "));
    return { code: 1, stdout: "", stderr: "" };
  }, "win32");
  assert.ok(calls.includes("where.exe bash"));
  assert.ok(calls.includes("git --exec-path"));
  if (process.platform !== "win32") {
    assert.equal(result.status, "FAIL");
    assert.match(result.detail, /Git Bash/);
  }
});

test("forced Plus without a Plus key identifies the missing Plus credential", async (t) => {
  const f = fixture(t);
  f.write(".deepcode/settings.json", { env: { API_KEY: "regular" } });
  f.write(".deepcode-plus/settings.json", { subscriptionPlan: "on" });
  const checks = await inspectApi(inspectSettings(f), async () => ({
    outcome: "available",
    modelListed: true,
    detail: "Accessible",
  }));
  assert.ok(
    checks.some(
      (check) =>
        check.name === "Selected API" &&
        check.status === "FAIL" &&
        check.detail.startsWith("DeepCode Plus") &&
        check.detail.includes("PLUS_API_KEY not found")
    )
  );
});
