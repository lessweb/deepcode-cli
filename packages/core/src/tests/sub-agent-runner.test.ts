import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { SubAgentRunner } from "../common/sub-agent-runner";
import { ToolExecutor } from "../tools/executor";
import { handleDelegateTool } from "../tools/delegate-handler";
import type { ToolExecutionContext } from "../tools/executor";

// ---- SubAgentRunner unit tests ----

test("SubAgentRunner can be instantiated", () => {
  const runner = new SubAgentRunner();
  assert.ok(runner instanceof SubAgentRunner);
});

test("SubAgentRunner returns error when no API client", async () => {
  const runner = new SubAgentRunner();
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "deepcode-subagent-"));

  try {
    const results = await runner.runTasks([{ description: "Find all TypeScript files" }], {
      projectRoot: workspace,
      createOpenAIClient: () => ({ client: null, model: "", thinkingEnabled: false }),
      toolExecutor: new ToolExecutor(workspace, () => ({ client: null, model: "", thinkingEnabled: false })),
    });

    assert.equal(results.length, 1);
    assert.equal(results[0]!.ok, false);
    assert.ok(results[0]!.errors.includes("No API client configured"));
    assert.equal(results[0]!.taskIndex, 0);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

// ---- Delegate tool handler tests ----

test("Delegate tool rejects empty tasks array", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "deepcode-delegate-"));

  try {
    const context: ToolExecutionContext = {
      sessionId: "test-session",
      projectRoot: workspace,
      toolCall: { id: "call-1", type: "function", function: { name: "Delegate", arguments: "" } },
    };

    const result = await handleDelegateTool({ tasks: [], parallel: true }, context);

    assert.equal(result.ok, false);
    assert.ok(result.error?.includes("tasks"));
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("Delegate tool rejects missing description", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "deepcode-delegate-"));

  try {
    const context: ToolExecutionContext = {
      sessionId: "test-session",
      projectRoot: workspace,
      toolCall: { id: "call-1", type: "function", function: { name: "Delegate", arguments: "" } },
    };

    const result = await handleDelegateTool({ tasks: [{ tools: ["read"] }], parallel: true }, context);

    assert.equal(result.ok, false);
    assert.ok(result.error?.includes("description"));
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("Delegate tool requires tasks array", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "deepcode-delegate-"));

  try {
    const context: ToolExecutionContext = {
      sessionId: "test-session",
      projectRoot: workspace,
      toolCall: { id: "call-1", type: "function", function: { name: "Delegate", arguments: "" } },
    };

    const result = await handleDelegateTool({ tasks: null }, context);
    assert.equal(result.ok, false);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("Delegate tool accepts valid tasks (no API call)", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "deepcode-delegate-"));

  try {
    const context: ToolExecutionContext = {
      sessionId: "test-session",
      projectRoot: workspace,
      toolCall: { id: "call-1", type: "function", function: { name: "Delegate", arguments: "" } },
      createOpenAIClient: () => ({
        client: null,
        model: "test-model",
        thinkingEnabled: false,
      }),
    };

    const result = await handleDelegateTool(
      {
        tasks: [
          { description: "Search for function X", tools: ["read", "bash"], maxIterations: 3 },
          { description: "Search for function Y" },
        ],
        parallel: false,
      },
      context
    );

    // Should fail because the sub-agent runner has no actual API client
    // But the schema validation should have passed
    assert.equal(result.ok, false);
    assert.ok(result.output?.includes("Sub-Agent Results"));
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});
