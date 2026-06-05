import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildNotifyEnv,
  formatDurationSeconds,
  launchBuiltinNotify,
  launchNotifyScript,
  resolveBuiltinNotifyPath,
  type NotifyContext,
  type NotifySpawn,
} from "../common/notify";
import { applyModelConfigSelection, resolveSettings, resolveSettingsSources } from "../settings";

const TEST_PROCESS_ENV = {};

test("resolveSettings reads top-level thinkingEnabled, notify, and webSearchTool", () => {
  const resolved = resolveSettings(
    {
      env: {
        MODEL: "deepseek-v3.2",
        BASE_URL: "https://example.com/v1",
        API_KEY: "sk-test",
      },
      thinkingEnabled: true,
      reasoningEffort: "high",
      debugLogEnabled: true,
      notify: "  /tmp/notify.sh  ",
      webSearchTool: "  /tmp/web-search.sh  ",
    },
    {
      model: "default-model",
      baseURL: "https://default.example.com",
    },
    TEST_PROCESS_ENV
  );

  assert.equal(resolved.model, "deepseek-v3.2");
  assert.equal(resolved.baseURL, "https://example.com/v1");
  assert.equal(resolved.apiKey, "sk-test");
  assert.equal(resolved.thinkingEnabled, true);
  assert.equal(resolved.reasoningEffort, "high");
  assert.equal(resolved.debugLogEnabled, true);
  assert.equal(resolved.notify, "/tmp/notify.sh");
  assert.equal(resolved.webSearchTool, "/tmp/web-search.sh");
});

test("resolveSettings gives top-level model priority over env MODEL", () => {
  const resolved = resolveSettings(
    {
      model: "deepseek-v4-flash",
      env: {
        MODEL: "deepseek-v4-pro",
      },
    },
    {
      model: "default-model",
      baseURL: "https://default.example.com",
    },
    TEST_PROCESS_ENV
  );

  assert.equal(resolved.model, "deepseek-v4-flash");
});

test("resolveSettings reads THINKING_ENABLED, REASONING_EFFORT, and DEBUG_LOG_ENABLED from env", () => {
  const resolved = resolveSettings(
    {
      env: {
        THINKING_ENABLED: "true",
        REASONING_EFFORT: "high",
        DEBUG_LOG_ENABLED: "true",
      },
    },
    {
      model: "default-model",
      baseURL: "https://default.example.com",
    },
    TEST_PROCESS_ENV
  );

  assert.equal(resolved.thinkingEnabled, true);
  assert.equal(resolved.reasoningEffort, "high");
  assert.equal(resolved.debugLogEnabled, true);
  assert.equal(resolved.model, "default-model");
  assert.equal(resolved.baseURL, "https://default.example.com");
});

test("resolveSettings defaults telemetryEnabled to true", () => {
  const resolved = resolveSettings(
    {},
    { model: "default-model", baseURL: "https://default.example.com" },
    TEST_PROCESS_ENV
  );
  assert.equal(resolved.telemetryEnabled, true);
});

test("resolveSettings reads TELEMETRY_ENABLED from env", () => {
  const resolved = resolveSettings(
    { env: { TELEMETRY_ENABLED: "0" } },
    { model: "default-model", baseURL: "https://default.example.com" },
    TEST_PROCESS_ENV
  );
  assert.equal(resolved.telemetryEnabled, false);
});

test("resolveSettings gives top-level telemetryEnabled priority over env TELEMETRY_ENABLED", () => {
  const resolved = resolveSettings(
    {
      telemetryEnabled: false,
      env: { TELEMETRY_ENABLED: "true" },
    },
    { model: "default-model", baseURL: "https://default.example.com" },
    TEST_PROCESS_ENV
  );
  assert.equal(resolved.telemetryEnabled, false);
});

test("resolveSettings ignores removed legacy env.THINKING", () => {
  const resolved = resolveSettings(
    {
      env: {
        THINKING: "enabled",
      },
    },
    {
      model: "default-model",
      baseURL: "https://default.example.com",
    },
    {}
  );

  assert.equal(resolved.thinkingEnabled, false);
});

test("resolveSettingsSources applies user, project, and DEEPCODE environment precedence", () => {
  const resolved = resolveSettingsSources(
    {
      env: {
        API_KEY: "user-key",
        MODEL: "user-env-model",
        THINKING_ENABLED: "false",
        REASONING_EFFORT: "high",
        DEBUG_LOG_ENABLED: "false",
        WEBHOOK: "user-webhook",
      },
      model: "user-top-model",
      thinkingEnabled: true,
      reasoningEffort: "max",
      debugLogEnabled: true,
      telemetryEnabled: false,
    },
    {
      env: {
        API_KEY: "project-key",
        MODEL: "project-env-model",
        THINKING_ENABLED: "false",
        DEBUG_LOG_ENABLED: "false",
      },
      model: "project-top-model",
      thinkingEnabled: true,
      telemetryEnabled: true,
    },
    {
      model: "default-model",
      baseURL: "https://default.example.com",
    },
    {
      DEEPCODE_MODEL: "system-model",
      DEEPCODE_THINKING_ENABLED: "false",
      DEEPCODE_REASONING_EFFORT: "high",
      DEEPCODE_DEBUG_LOG_ENABLED: "true",
      DEEPCODE_TELEMETRY_ENABLED: "false",
      DEEPCODE_WEBHOOK: "system-webhook",
    }
  );

  assert.equal(resolved.model, "system-model");
  assert.equal(resolved.apiKey, "project-key");
  assert.equal(resolved.thinkingEnabled, false);
  assert.equal(resolved.reasoningEffort, "high");
  assert.equal(resolved.debugLogEnabled, true);
  assert.equal(resolved.telemetryEnabled, false);
  assert.equal(resolved.env.WEBHOOK, "system-webhook");
});

test("resolveSettingsSources merges permission settings", () => {
  const resolved = resolveSettingsSources(
    {
      permissions: {
        allow: ["read-in-cwd", "network"],
        ask: ["write-out-cwd"],
        defaultMode: "askAll",
      },
    },
    {
      permissions: {
        allow: ["write-in-cwd", "read-in-cwd"],
        deny: ["delete-out-cwd"],
        defaultMode: "allowAll",
      },
    },
    {
      model: "default-model",
      baseURL: "https://default.example.com",
    },
    TEST_PROCESS_ENV
  );

  assert.deepEqual(resolved.permissions.allow, ["read-in-cwd", "network", "write-in-cwd"]);
  assert.deepEqual(resolved.permissions.ask, ["write-out-cwd"]);
  assert.deepEqual(resolved.permissions.deny, ["delete-out-cwd"]);
  assert.equal(resolved.permissions.defaultMode, "allowAll");
});

test("resolveSettingsSources merges MCP env with documented priority", () => {
  const resolved = resolveSettingsSources(
    {
      env: {
        MCP_GITHUB_PERSONAL_ACCESS_TOKEN: "user-global",
      },
      mcpServers: {
        github: {
          command: "node",
          args: ["user-server.js"],
          env: {
            GITHUB_PERSONAL_ACCESS_TOKEN: "user-local",
            USER_ONLY: "1",
          },
        },
      },
    },
    {
      env: {
        MCP_GITHUB_PERSONAL_ACCESS_TOKEN: "project-global",
      },
      mcpServers: {
        github: {
          command: "python",
          env: {
            GITHUB_PERSONAL_ACCESS_TOKEN: "project-local",
            PROJECT_ONLY: "1",
          },
        },
      },
    },
    {
      model: "default-model",
      baseURL: "https://default.example.com",
    },
    {
      DEEPCODE_MCP_GITHUB_PERSONAL_ACCESS_TOKEN: "system-global",
    }
  );

  assert.equal(resolved.mcpServers?.github?.command, "python");
  assert.deepEqual(resolved.mcpServers?.github?.args, ["user-server.js"]);
  assert.deepEqual(resolved.mcpServers?.github?.env, {
    MCP_GITHUB_PERSONAL_ACCESS_TOKEN: "system-global",
    GITHUB_PERSONAL_ACCESS_TOKEN: "system-global",
    USER_ONLY: "1",
    PROJECT_ONLY: "1",
  });
});

test("resolveSettings defaults DeepSeek v4 models to thinking mode", () => {
  const resolved = resolveSettings(
    {
      env: {
        MODEL: "deepseek-v4-flash",
      },
    },
    {
      model: "default-model",
      baseURL: "https://default.example.com",
    },
    TEST_PROCESS_ENV
  );

  assert.equal(resolved.thinkingEnabled, true);
});

test("resolveSettings applies thinking defaults to the fallback model", () => {
  const resolved = resolveSettings(
    {},
    {
      model: "deepseek-v4-pro",
      baseURL: "https://default.example.com",
    },
    TEST_PROCESS_ENV
  );

  assert.equal(resolved.model, "deepseek-v4-pro");
  assert.equal(resolved.thinkingEnabled, true);
});

test("resolveSettings keeps thinking mode off by default for other models", () => {
  const resolved = resolveSettings(
    {
      env: {
        MODEL: "deepseek-v3.2",
      },
    },
    {
      model: "default-model",
      baseURL: "https://default.example.com",
    },
    TEST_PROCESS_ENV
  );

  assert.equal(resolved.thinkingEnabled, false);
});

test("resolveSettings allows explicit thinkingEnabled to override model defaults", () => {
  const resolved = resolveSettings(
    {
      env: {
        MODEL: "deepseek-v4-pro",
      },
      thinkingEnabled: false,
    },
    {
      model: "default-model",
      baseURL: "https://default.example.com",
    },
    TEST_PROCESS_ENV
  );

  assert.equal(resolved.thinkingEnabled, false);
});

test("resolveSettings defaults invalid reasoning effort to max", () => {
  const resolved = resolveSettings(
    {
      reasoningEffort: "medium" as never,
    },
    {
      model: "default-model",
      baseURL: "https://default.example.com",
    },
    TEST_PROCESS_ENV
  );

  assert.equal(resolved.reasoningEffort, "max");
});

test("applyModelConfigSelection writes model only when the effective model changes or already exists", () => {
  const result = applyModelConfigSelection(
    {
      env: {
        MODEL: "deepseek-v4-pro",
      },
      thinkingEnabled: false,
    },
    {
      model: "deepseek-v4-pro",
      thinkingEnabled: false,
      reasoningEffort: "max",
    },
    {
      model: "deepseek-v4-pro",
      thinkingEnabled: true,
      reasoningEffort: "high",
    }
  );

  assert.equal(result.changed, true);
  assert.equal(result.settings.model, undefined);
  assert.equal(result.settings.thinkingEnabled, true);
  assert.equal(result.settings.reasoningEffort, "high");
});

test("applyModelConfigSelection persists a new selected model and thinking option", () => {
  const result = applyModelConfigSelection(
    {
      env: {
        MODEL: "deepseek-v4-pro",
        BASE_URL: "https://api.deepseek.com",
        API_KEY: "sk-test",
      },
      thinkingEnabled: false,
    },
    {
      model: "deepseek-v4-pro",
      thinkingEnabled: false,
      reasoningEffort: "max",
    },
    {
      model: "deepseek-v4-flash",
      thinkingEnabled: true,
      reasoningEffort: "high",
    }
  );

  assert.equal(result.changed, true);
  assert.equal(result.settings.env?.MODEL, "deepseek-v4-pro");
  assert.equal(result.settings.model, "deepseek-v4-flash");
  assert.equal(result.settings.thinkingEnabled, true);
  assert.equal(result.settings.reasoningEffort, "high");
});

test("applyModelConfigSelection leaves settings untouched when the effective selection is unchanged", () => {
  const result = applyModelConfigSelection(
    {
      env: {
        MODEL: "deepseek-v4-pro",
      },
      thinkingEnabled: true,
      reasoningEffort: "max",
    },
    {
      model: "deepseek-v4-pro",
      thinkingEnabled: true,
      reasoningEffort: "max",
    },
    {
      model: "deepseek-v4-pro",
      thinkingEnabled: true,
      reasoningEffort: "max",
    }
  );

  assert.equal(result.changed, false);
  assert.equal(result.settings.model, undefined);
});

test("formatDurationSeconds preserves sub-second precision and trims trailing zeros", () => {
  assert.equal(formatDurationSeconds(0), "0");
  assert.equal(formatDurationSeconds(1250), "1");
  assert.equal(formatDurationSeconds(4000), "4");
});

test("buildNotifyEnv injects DURATION without context", () => {
  const env = buildNotifyEnv(2750, { HOME: "/tmp/home" });
  assert.equal(env.HOME, "/tmp/home");
  assert.equal(env.DURATION, "2");
  assert.equal(env.STATUS, undefined);
  assert.equal(env.FAIL_REASON, undefined);
  assert.equal(env.QUESTION, undefined);
  assert.equal(env.BODY, undefined);
  assert.equal(env.TITLE, undefined);
});

test("buildNotifyEnv injects STATUS, FAIL_REASON, QUESTION, BODY, and TITLE from context", () => {
  const context: NotifyContext = {
    status: "failed",
    failReason: "API key not found",
    question: "Can you fix the login bug?",
    body: "Hello, this is the last assistant message.",
    title: "Fix login bug",
  };
  const env = buildNotifyEnv(5000, { HOME: "/tmp/home" }, context);
  assert.equal(env.HOME, "/tmp/home");
  assert.equal(env.DURATION, "5");
  assert.equal(env.STATUS, "failed");
  assert.equal(env.FAIL_REASON, "API key not found");
  assert.equal(env.QUESTION, "Can you fix the login bug?");
  assert.equal(env.BODY, "Hello, this is the last assistant message.");
  assert.equal(env.TITLE, "Fix login bug");
});

test("buildNotifyEnv omits optional context fields when not provided", () => {
  const env = buildNotifyEnv(
    1000,
    {
      HOME: "/tmp/home",
      STATUS: "stale-status",
      FAIL_REASON: "stale-failure",
      QUESTION: "stale-question",
      BODY: "stale-body",
      TITLE: "stale-title",
    },
    { status: "completed" }
  );
  assert.equal(env.STATUS, "completed");
  assert.equal(env.FAIL_REASON, undefined);
  assert.equal(env.QUESTION, undefined);
  assert.equal(env.BODY, undefined);
  assert.equal(env.TITLE, undefined);
});

test("buildNotifyEnv ignores empty strings in context", () => {
  const env = buildNotifyEnv(
    1000,
    { HOME: "/tmp/home" },
    {
      status: "",
      failReason: "",
      question: "",
      body: "",
      title: "",
    }
  );
  assert.equal(env.STATUS, undefined);
  assert.equal(env.FAIL_REASON, undefined);
  assert.equal(env.QUESTION, undefined);
  assert.equal(env.BODY, undefined);
  assert.equal(env.TITLE, undefined);
});

test("buildNotifyEnv preserves special characters in question, body, and title", () => {
  const context: NotifyContext = {
    question: "Question?\nWith tabs\tand quotes",
    body: 'Line 1\nLine 2\tindented "quoted"',
    title: "Fix: login & signup (urgent)",
  };
  const env = buildNotifyEnv(1000, {}, context);
  assert.equal(env.QUESTION, "Question?\nWith tabs\tand quotes");
  assert.equal(env.BODY, 'Line 1\nLine 2\tindented "quoted"');
  assert.equal(env.TITLE, "Fix: login & signup (urgent)");
});

test(
  "launchNotifyScript passes DURATION, context vars, and falls back to /bin/sh for non-executable scripts",
  { skip: process.platform === "win32" },
  () => {
    const calls: Array<{
      command: string;
      args: string[];
      options: { cwd?: string | URL; env?: NodeJS.ProcessEnv };
    }> = [];

    const spawnProcess: NotifySpawn = (command, args, options) => {
      calls.push({ command, args, options: { cwd: options.cwd, env: options.env } });

      return {
        once(event, listener) {
          if (event === "error" && calls.length === 1) {
            listener({ code: "EACCES" } as NodeJS.ErrnoException);
          }
          return this;
        },
        unref() {
          return undefined;
        },
      };
    };

    const context: NotifyContext = {
      status: "completed",
      question: "Can you finish the task?",
      body: "Task finished successfully.",
      title: "Fix login bug",
    };

    launchNotifyScript("/tmp/notify.sh", 2750, "/tmp/project", spawnProcess, { WEBHOOK: "configured" }, context);

    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.command, "/tmp/notify.sh");
    assert.deepEqual(calls[0]?.args, []);
    assert.equal(calls[0]?.options.cwd, "/tmp/project");
    assert.equal(calls[0]?.options.env?.DURATION, "2");
    assert.equal(calls[0]?.options.env?.WEBHOOK, "configured");
    assert.equal(calls[0]?.options.env?.STATUS, "completed");
    assert.equal(calls[0]?.options.env?.FAIL_REASON, undefined);
    assert.equal(calls[0]?.options.env?.QUESTION, "Can you finish the task?");
    assert.equal(calls[0]?.options.env?.BODY, "Task finished successfully.");
    assert.equal(calls[0]?.options.env?.TITLE, "Fix login bug");
    assert.equal(calls[1]?.command, "/bin/sh");
    assert.deepEqual(calls[1]?.args, ["/tmp/notify.sh"]);
    assert.equal(calls[1]?.options.cwd, "/tmp/project");
    assert.equal(calls[1]?.options.env?.DURATION, "2");
    assert.equal(calls[1]?.options.env?.STATUS, "completed");
    assert.equal(calls[1]?.options.env?.QUESTION, "Can you finish the task?");
    assert.equal(calls[1]?.options.env?.BODY, "Task finished successfully.");
    assert.equal(calls[1]?.options.env?.TITLE, "Fix login bug");
  }
);

test(
  "resolveBuiltinNotifyPath returns the bundled Windows notification script",
  { skip: process.platform !== "win32" },
  () => {
    const notifyPath = resolveBuiltinNotifyPath();
    assert.ok(notifyPath);
    assert.match(notifyPath.replace(/\\/g, "/"), /templates\/tools\/deepcode-notify\.ps1$/);
  }
);

test(
  "launchBuiltinNotify starts PowerShell with context and DeepCode process ids",
  { skip: process.platform !== "win32" },
  () => {
    const calls: Array<{
      command: string;
      args: string[];
      options: { cwd?: string | URL; env?: NodeJS.ProcessEnv; detached?: boolean; stdio?: unknown };
    }> = [];

    const spawnProcess: NotifySpawn = (command, args, options) => {
      calls.push({
        command,
        args,
        options: {
          cwd: options.cwd,
          detached: options.detached,
          env: options.env,
          stdio: options.stdio,
        },
      });

      return {
        once() {
          return this;
        },
        unref() {
          return undefined;
        },
      };
    };

    launchBuiltinNotify(
      2750,
      "C:/tmp/project",
      spawnProcess,
      { WEBHOOK: "configured", DEEPCODE_NOTIFY_WINDOW_HWND: "1234" },
      {
        status: "completed",
        question: "Can you finish the task?",
        body: "Task finished successfully.",
        title: "Fix login bug",
      }
    );

    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.command, "powershell.exe");
    assert.deepEqual(calls[0]?.args.slice(0, 4), ["-ExecutionPolicy", "Bypass", "-NoProfile", "-File"]);
    assert.match(calls[0]?.args[4]?.replace(/\\/g, "/") ?? "", /templates\/tools\/deepcode-notify\.ps1$/);
    assert.equal(calls[0]?.options.cwd, "C:/tmp/project");
    assert.equal(calls[0]?.options.detached, false);
    assert.equal(calls[0]?.options.stdio, "ignore");
    assert.equal(calls[0]?.options.env?.DURATION, "2");
    assert.equal(calls[0]?.options.env?.WEBHOOK, "configured");
    assert.equal(calls[0]?.options.env?.STATUS, "completed");
    assert.equal(calls[0]?.options.env?.QUESTION, "Can you finish the task?");
    assert.equal(calls[0]?.options.env?.BODY, "Task finished successfully.");
    assert.equal(calls[0]?.options.env?.TITLE, "Fix login bug");
    assert.equal(calls[0]?.options.env?.DEEPCODE_NOTIFY_PROCESS_PID, String(process.pid));
    assert.equal(calls[0]?.options.env?.DEEPCODE_NOTIFY_PARENT_PID, String(process.ppid));
    assert.equal(calls[0]?.options.env?.DEEPCODE_NOTIFY_WINDOW_HWND, "1234");
  }
);
