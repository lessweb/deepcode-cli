import { test } from "node:test";
import assert from "node:assert/strict";
import { buildNotifyEnv, formatDurationSeconds, launchNotifyScript, type NotifySpawn } from "../notify";
import { applyModelConfigSelection, resolveSettings } from "../settings";

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
    }
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
    }
  );

  assert.equal(resolved.model, "deepseek-v4-flash");
});

test("resolveSettings still accepts legacy env.THINKING and defaults reasoning effort when absent", () => {
  const resolved = resolveSettings(
    {
      env: {
        THINKING: "enabled",
      },
    },
    {
      model: "default-model",
      baseURL: "https://default.example.com",
    }
  );

  assert.equal(resolved.thinkingEnabled, true);
  assert.equal(resolved.reasoningEffort, "max");
  assert.equal(resolved.model, "default-model");
  assert.equal(resolved.baseURL, "https://default.example.com");
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
    }
  );

  assert.equal(resolved.thinkingEnabled, true);
});

test("resolveSettings applies thinking defaults to the fallback model", () => {
  const resolved = resolveSettings(
    {},
    {
      model: "deepseek-v4-pro",
      baseURL: "https://default.example.com",
    }
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
    }
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
    }
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
    }
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

test("buildNotifyEnv injects DURATION", () => {
  const env = buildNotifyEnv(2750, { HOME: "/tmp/home" });
  assert.equal(env.HOME, "/tmp/home");
  assert.equal(env.DURATION, "2");
});

test("launchNotifyScript passes DURATION and falls back to /bin/sh for non-executable scripts", () => {
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

  launchNotifyScript("/tmp/notify.sh", 2750, "/tmp/project", spawnProcess);

  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.command, "/tmp/notify.sh");
  assert.deepEqual(calls[0]?.args, []);
  assert.equal(calls[0]?.options.cwd, "/tmp/project");
  assert.equal(calls[0]?.options.env?.DURATION, "2");
  assert.equal(calls[1]?.command, "/bin/sh");
  assert.deepEqual(calls[1]?.args, ["/tmp/notify.sh"]);
  assert.equal(calls[1]?.options.cwd, "/tmp/project");
  assert.equal(calls[1]?.options.env?.DURATION, "2");
});
