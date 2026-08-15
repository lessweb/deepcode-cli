import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  AskPermissionRequest,
  ResolvedDeepcodingSettings,
  SessionEntry,
  SessionManagerOptions,
  SessionStatus,
  UserPromptContent,
} from "@vegamo/deepcode-core";
import { runExecMode, type ExecRunnerDependencies } from "../exec-runner";
import type { ExecInputStream } from "../exec-input";

const RESUME_ID = "0a5cb7a5-c39d-4c39-a11b-05f8b22b8df6";

function createSettings(
  permissions: ResolvedDeepcodingSettings["permissions"] = {
    allow: [],
    deny: [],
    ask: [],
    defaultMode: "allowAll",
  }
): ResolvedDeepcodingSettings {
  return {
    env: {},
    baseURL: "https://example.invalid",
    model: "test-model",
    contextWindow: 256 * 1024,
    autoCompactWindow: 128 * 1024,
    thinkingEnabled: false,
    reasoningEffort: "high",
    debugLogEnabled: false,
    telemetryEnabled: false,
    permissions,
    enabledSkills: {},
    statusline: { enabled: false, refreshMs: 1000, separator: " | ", providers: [] },
  };
}

function createEntry(id: string, status: SessionStatus, overrides: Partial<SessionEntry> = {}): SessionEntry {
  return {
    id,
    summary: "task",
    assistantReply: null,
    assistantThinking: null,
    assistantRefusal: null,
    toolCalls: null,
    status,
    failReason: null,
    usage: null,
    usagePerModel: null,
    activeTokens: 0,
    createTime: "2026-01-01T00:00:00.000Z",
    updateTime: "2026-01-01T00:00:00.000Z",
    processes: null,
    ...overrides,
  };
}

function ttyInput(): ExecInputStream {
  return {
    isTTY: true,
    async *[Symbol.asyncIterator]() {},
  };
}

function pipedInput(content: string): ExecInputStream {
  return {
    isTTY: false,
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(content);
    },
  };
}

type ManagerScenario = {
  finalStatus?: SessionStatus;
  finalReply?: string | null;
  failReason?: string | null;
  resumeExists?: boolean;
  throwFromPrompt?: Error;
  duringPrompt?: () => void;
  askPermissions?: AskPermissionRequest[];
  permissions?: ResolvedDeepcodingSettings["permissions"];
};

function createHarness(scenario: ManagerScenario = {}) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const submitted: UserPromptContent[] = [];
  const signalListeners = new Set<() => void>();
  let disposed = 0;
  let interrupted = 0;
  let activeId: string | null = null;
  let forkedFrom: string | null = null;
  let entry: SessionEntry | null = scenario.resumeExists ? createEntry(RESUME_ID, "completed") : null;
  let managerOptions: SessionManagerOptions | null = null;
  let initializedMcp: unknown;

  const dependencies: Partial<ExecRunnerDependencies> = {
    resolveSettings: () => createSettings(scenario.permissions),
    signalTarget: {
      on: (_event, listener) => signalListeners.add(listener),
      off: (_event, listener) => signalListeners.delete(listener),
    },
    writeStdoutLine: (message) => stdout.push(message),
    writeStderrLine: (message) => stderr.push(message),
    createSessionManager: (options) => {
      managerOptions = options;
      return {
        dispose: () => {
          disposed += 1;
        },
        getActiveSessionId: () => activeId,
        getSession: (sessionId) => (entry?.id === sessionId ? entry : null),
        forkSession: (sessionId) => {
          forkedFrom = sessionId;
          activeId = "forked-session";
          entry = createEntry(activeId, "completed");
          return activeId;
        },
        handleUserPrompt: async (prompt) => {
          submitted.push(prompt);
          if (scenario.throwFromPrompt) throw scenario.throwFromPrompt;
          activeId ??= "new-session";
          options.onSessionEntryUpdated?.(createEntry(activeId, "processing"));
          options.onAssistantMessage(
            {
              id: "tool-message",
              sessionId: activeId,
              role: "assistant",
              content: "",
              contentParams: null,
              messageParams: { tool_calls: [{ function: { name: "read" } }] },
              compacted: false,
              visible: false,
              createTime: "2026-01-01T00:00:00.000Z",
              updateTime: "2026-01-01T00:00:00.000Z",
            },
            true
          );
          options.onProcessStdout?.(123, "process output\n");
          scenario.duringPrompt?.();
          entry = createEntry(activeId, scenario.finalStatus ?? "completed", {
            assistantReply: scenario.finalReply === undefined ? "final answer" : scenario.finalReply,
            failReason: scenario.failReason ?? null,
            askPermissions: scenario.askPermissions,
          });
          options.onSessionEntryUpdated?.(entry);
        },
        initMcpServers: async (servers) => {
          initializedMcp = servers;
        },
        interruptActiveSession: () => {
          interrupted += 1;
          if (activeId) entry = createEntry(activeId, "interrupted", { failReason: "interrupted" });
        },
        setActiveSessionId: (sessionId) => {
          activeId = sessionId;
        },
      };
    },
  };

  return {
    dependencies,
    emitSigint: () => {
      for (const listener of signalListeners) listener();
    },
    get disposed() {
      return disposed;
    },
    get initializedMcp() {
      return initializedMcp;
    },
    get interrupted() {
      return interrupted;
    },
    get forkedFrom() {
      return forkedFrom;
    },
    get managerOptions() {
      return managerOptions;
    },
    stderr,
    stdout,
    submitted,
  };
}

test("runExecMode creates a non-interactive session without progress output", async () => {
  const harness = createHarness();
  const code = await runExecMode(
    { prompt: "task", projectRoot: "/tmp/project", input: ttyInput() },
    harness.dependencies
  );

  assert.equal(code, 0);
  assert.deepEqual(harness.stdout, ["final answer"]);
  assert.deepEqual(harness.submitted, [{ text: "task" }]);
  assert.equal(harness.managerOptions?.nonInteractive, true);
  assert.equal(harness.initializedMcp, undefined);
  assert.deepEqual(harness.stderr, []);
  assert.equal(harness.disposed, 1);
});

test("runExecMode submits piped stdin in the persisted user prompt", async () => {
  const harness = createHarness();
  const code = await runExecMode(
    { prompt: "explain", projectRoot: "/tmp/project", input: pipedInput("details") },
    harness.dependencies
  );

  assert.equal(code, 0);
  assert.deepEqual(harness.submitted, [{ text: "explain\n\n<stdin>\ndetails\n</stdin>" }]);
  assert.deepEqual(harness.stderr, []);
});

test("runExecMode resumes a validated session before submitting", async () => {
  const harness = createHarness({ resumeExists: true, finalReply: "continued" });
  const code = await runExecMode(
    { prompt: "continue", projectRoot: "/tmp/project", resumeSessionId: RESUME_ID, input: ttyInput() },
    harness.dependencies
  );

  assert.equal(code, 0);
  assert.deepEqual(harness.stdout, ["continued"]);
  assert.deepEqual(harness.submitted, [{ text: "continue" }]);
});

test("runExecMode rejects a missing resume session and disposes resources", async () => {
  const harness = createHarness();
  const code = await runExecMode(
    { prompt: "continue", projectRoot: "/tmp/project", resumeSessionId: RESUME_ID, input: ttyInput() },
    harness.dependencies
  );

  assert.equal(code, 1);
  assert.deepEqual(harness.stdout, []);
  assert.match(harness.stderr.join("\n"), /No saved session found/);
  assert.equal(harness.disposed, 1);
});

test("runExecMode forks a validated session before submitting", async () => {
  const harness = createHarness({ resumeExists: true, finalReply: "fork continued" });
  const code = await runExecMode(
    { prompt: "continue", projectRoot: "/tmp/project", forkSessionId: RESUME_ID, input: ttyInput() },
    harness.dependencies
  );

  assert.equal(code, 0);
  assert.equal(harness.forkedFrom, RESUME_ID);
  assert.deepEqual(harness.stdout, ["fork continued"]);
  assert.deepEqual(harness.submitted, [{ text: "continue" }]);
});

test("runExecMode rejects a missing fork source and disposes resources", async () => {
  const harness = createHarness();
  const code = await runExecMode(
    { prompt: "continue", projectRoot: "/tmp/project", forkSessionId: RESUME_ID, input: ttyInput() },
    harness.dependencies
  );

  assert.equal(code, 1);
  assert.equal(harness.forkedFrom, null);
  assert.deepEqual(harness.stdout, []);
  assert.match(harness.stderr.join("\n"), /No saved session found/);
  assert.equal(harness.disposed, 1);
});

test("runExecMode reports the tool, action, scope, and reason for required permission", async () => {
  const harness = createHarness({
    finalStatus: "ask_permission",
    permissions: { allow: [], deny: [], ask: ["network"], defaultMode: "allowAll" },
    askPermissions: [
      {
        toolCallId: "weather-search",
        name: "WebSearch",
        command: "重庆未来3天天气预报",
        scopes: ["network"],
      },
    ],
  });
  const code = await runExecMode(
    { prompt: "task", projectRoot: "/tmp/project", input: ttyInput() },
    harness.dependencies
  );

  assert.equal(code, 1);
  assert.deepEqual(harness.stdout, []);
  assert.equal(harness.stderr.length, 1);
  assert.match(harness.stderr[0], /Tool: WebSearch/);
  assert.match(harness.stderr[0], /Action: 重庆未来3天天气预报/);
  assert.match(harness.stderr[0], /network: network access/);
  assert.match(harness.stderr[0], /"network" is configured in permissions\.ask/);
  assert.equal(harness.disposed, 1);
});

test("runExecMode treats unexpected user-input states as failures", async () => {
  const harness = createHarness({ finalStatus: "waiting_for_user" });
  const code = await runExecMode(
    { prompt: "task", projectRoot: "/tmp/project", input: ttyInput() },
    harness.dependencies
  );
  assert.equal(code, 1);
  assert.deepEqual(harness.stdout, []);
  assert.match(harness.stderr.join("\n"), /unavailable in --exec mode/);
  assert.equal(harness.disposed, 1);
});

test("runExecMode reports model failures on stderr", async () => {
  const harness = createHarness({ finalStatus: "failed", failReason: "provider unavailable" });
  const code = await runExecMode(
    { prompt: "task", projectRoot: "/tmp/project", input: ttyInput() },
    harness.dependencies
  );

  assert.equal(code, 1);
  assert.deepEqual(harness.stdout, []);
  assert.equal(harness.stderr.includes("Execution failed: provider unavailable"), true);
  assert.equal(harness.disposed, 1);
});

test("runExecMode returns 130 and interrupts the active session on SIGINT", async () => {
  let emitSigint = (): void => {};
  const harness = createHarness({ duringPrompt: () => emitSigint() });
  emitSigint = harness.emitSigint;
  const code = await runExecMode(
    { prompt: "task", projectRoot: "/tmp/project", input: ttyInput() },
    harness.dependencies
  );

  assert.equal(code, 130);
  assert.deepEqual(harness.stdout, []);
  assert.equal(harness.interrupted, 1);
  assert.equal(harness.disposed, 1);
});

test("runExecMode catches prompt execution errors and disposes resources", async () => {
  const harness = createHarness({ throwFromPrompt: new Error("request exploded") });
  const code = await runExecMode(
    { prompt: "task", projectRoot: "/tmp/project", input: ttyInput() },
    harness.dependencies
  );

  assert.equal(code, 1);
  assert.match(harness.stderr.join("\n"), /deepcode: request exploded/);
  assert.equal(harness.disposed, 1);
});

test("runExecMode disposes resources when stdin cannot be read", async () => {
  const harness = createHarness();
  const brokenInput: ExecInputStream = {
    isTTY: false,
    [Symbol.asyncIterator]() {
      return {
        next: async () => {
          throw new Error("stdin unavailable");
        },
      };
    },
  };
  const code = await runExecMode(
    { prompt: "task", projectRoot: "/tmp/project", input: brokenInput },
    harness.dependencies
  );

  assert.equal(code, 1);
  assert.match(harness.stderr.join("\n"), /Failed to read stdin: stdin unavailable/);
  assert.equal(harness.disposed, 1);
});

// ── --output-format json ──────────────────────────────────────────────────────

function parseEvents(stdout: string[]): Record<string, unknown>[] {
  return stdout.map((line) => {
    assert.doesNotMatch(line, /\n/, "each event must occupy exactly one line");
    return JSON.parse(line) as Record<string, unknown>;
  });
}

test("runExecMode emits an init event carrying the session id before the result", async () => {
  const harness = createHarness();
  const code = await runExecMode(
    { prompt: "task", projectRoot: "/tmp/project", outputFormat: "json", input: ttyInput() },
    harness.dependencies
  );

  assert.equal(code, 0);
  const events = parseEvents(harness.stdout);
  const init = events[0];
  assert.equal(init.type, "system");
  assert.equal(init.subtype, "init");
  // The id is minted inside handleUserPrompt, so it reaches stdout via the
  // first streamed message — before the turn finishes.
  assert.equal(init.session_id, "new-session");
  assert.equal(init.cwd, "/tmp/project");
  assert.equal(init.model, "test-model");
  assert.deepEqual(init.mcp_servers, []);

  const result = events[events.length - 1];
  assert.equal(result.type, "result");
  assert.equal(result.subtype, "success");
  assert.equal(result.is_error, false);
  assert.equal(result.session_id, "new-session");
  assert.equal(result.result, "final answer");
  assert.equal(typeof result.duration_ms, "number");
});

test("runExecMode streams session messages as their own json events", async () => {
  const harness = createHarness();
  await runExecMode(
    { prompt: "task", projectRoot: "/tmp/project", outputFormat: "json", input: ttyInput() },
    harness.dependencies
  );

  const events = parseEvents(harness.stdout);
  const assistant = events.find((event) => event.type === "assistant");
  assert.ok(assistant, "expected an assistant event");
  assert.equal(assistant.session_id, "new-session");
  const message = assistant.message as Record<string, unknown>;
  assert.equal(message.id, "tool-message");
  assert.equal(message.role, "assistant");
  assert.deepEqual(message.message_params, { tool_calls: [{ function: { name: "read" } }] });
});

test("runExecMode emits exactly one init and one result event", async () => {
  const harness = createHarness();
  await runExecMode(
    { prompt: "task", projectRoot: "/tmp/project", outputFormat: "json", input: ttyInput() },
    harness.dependencies
  );

  const events = parseEvents(harness.stdout);
  assert.equal(events.filter((event) => event.subtype === "init").length, 1);
  assert.equal(events.filter((event) => event.type === "result").length, 1);
});

test("runExecMode reports the resumed session id in the init event", async () => {
  const harness = createHarness({ resumeExists: true });
  const code = await runExecMode(
    {
      prompt: "task",
      projectRoot: "/tmp/project",
      resumeSessionId: RESUME_ID,
      outputFormat: "json",
      input: ttyInput(),
    },
    harness.dependencies
  );

  assert.equal(code, 0);
  const init = parseEvents(harness.stdout)[0];
  assert.equal(init.session_id, RESUME_ID);
  assert.equal(init.resumed_from, RESUME_ID);
});

test("runExecMode emits an error result event for a failed turn", async () => {
  const harness = createHarness({ finalStatus: "failed", failReason: "model exploded" });
  const code = await runExecMode(
    { prompt: "task", projectRoot: "/tmp/project", outputFormat: "json", input: ttyInput() },
    harness.dependencies
  );

  assert.equal(code, 1);
  const result = parseEvents(harness.stdout).at(-1)!;
  assert.equal(result.type, "result");
  assert.equal(result.subtype, "error");
  assert.equal(result.is_error, true);
  assert.equal(result.status, "failed");
  assert.match(String(result.error), /model exploded/);
  // The human-readable diagnostic is unchanged on stderr.
  assert.match(harness.stderr.join("\n"), /model exploded/);
});

test("runExecMode emits a permission_required result event without a session reply", async () => {
  const harness = createHarness({
    finalStatus: "ask_permission",
    askPermissions: [
      { toolCallId: "call-1", name: "bash", command: "rm -rf /", description: "", scopes: ["write-out-cwd"] },
    ],
    permissions: { allow: [], deny: [], ask: ["write-out-cwd"], defaultMode: "allowAll" },
  });
  const code = await runExecMode(
    { prompt: "task", projectRoot: "/tmp/project", outputFormat: "json", input: ttyInput() },
    harness.dependencies
  );

  assert.equal(code, 1);
  const result = parseEvents(harness.stdout).at(-1)!;
  assert.equal(result.subtype, "permission_required");
  assert.equal(result.is_error, true);
  assert.match(String(result.error), /permission confirmation/);
});

test("runExecMode still emits an init and result event when no session is created", async () => {
  const harness = createHarness();
  const code = await runExecMode(
    {
      prompt: "task",
      projectRoot: "/tmp/project",
      resumeSessionId: RESUME_ID,
      outputFormat: "json",
      input: ttyInput(),
    },
    harness.dependencies
  );

  assert.equal(code, 1);
  const events = parseEvents(harness.stdout);
  assert.equal(events[0].subtype, "init");
  assert.equal(events[0].session_id, null);
  assert.equal(events[1].type, "result");
  assert.equal(events[1].is_error, true);
});

test("runExecMode writes plain text and no json events by default", async () => {
  const harness = createHarness();
  const code = await runExecMode(
    { prompt: "task", projectRoot: "/tmp/project", input: ttyInput() },
    harness.dependencies
  );

  assert.equal(code, 0);
  assert.deepEqual(harness.stdout, ["final answer"]);
});
