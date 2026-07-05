import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { SubAgentSession, SUB_AGENT_NON_INTERACTIVE_NOTE } from "../agents/sub-agent-session";
import type { SubAgentOptions } from "../agents/sub-agent-session";
import type { AgentManifest } from "../agents/agent-registry";
import type { CreateOpenAIClient } from "../common/tool-types";
import type { ToolExecutor } from "../tools/executor";

// =============================================================================
// Property 9: Sub-agent session isolation
// =============================================================================
// **Validates: Requirements 5.1, 5.6**
//
// For any sub-agent execution, the sub-agent's LLM context SHALL contain zero
// messages from the parent session's history, and upon completion, only the final
// assistant response text SHALL be returned to the parent — no intermediate
// messages, tool call records, or internal state SHALL leak.

describe("Property 9: Sub-agent session isolation", () => {
  /**
   * Helper: Create a mock manifest for testing.
   */
  function makeManifest(overrides: Partial<AgentManifest> = {}): AgentManifest {
    return {
      name: "test-agent",
      description: "A test sub-agent",
      model: "test-model",
      skills: [],
      instructions: "You are a helpful test agent.",
      sourcePath: "/fake/path/AGENT.md",
      sourceRoot: "./.deepcode/agents",
      ...overrides,
    };
  }

  /**
   * Helper: Create a mock ToolExecutor that records calls and returns canned results.
   */
  function makeMockToolExecutor(results: Array<{ toolCallId: string; content: string }> = []): ToolExecutor {
    return {
      executeToolCalls: async (_sessionId: string, toolCalls: unknown[]) => {
        // Return canned results matching the tool call IDs
        const calls = toolCalls as Array<{ id: string; function: { name: string; arguments: string } }>;
        return calls.map((tc, i) => ({
          toolCallId: tc.id,
          content: results[i]?.content ?? JSON.stringify({ ok: true, name: tc.function.name, output: "done" }),
          result: { ok: true, name: tc.function.name, output: "done" },
        }));
      },
    } as unknown as ToolExecutor;
  }

  /**
   * Scenario 1: Simple response (no tool calls).
   * Verifies that the LLM receives only a system message and a user message —
   * zero messages from any parent session history.
   */
  test("sub-agent LLM context starts fresh with only system + user messages (no parent history)", async () => {
    const capturedMessages: Array<Array<{ role: string; content?: string | null }>> = [];

    const mockCreateOpenAIClient: CreateOpenAIClient = () => ({
      client: {
        chat: {
          completions: {
            create: async (body: Record<string, unknown>) => {
              // Capture the messages sent to the LLM
              capturedMessages.push(
                (body.messages as Array<{ role: string; content?: string | null }>).map((m) => ({
                  role: m.role,
                  content: m.content ?? null,
                }))
              );
              // Return a simple text response (no tool calls)
              return {
                choices: [
                  {
                    message: {
                      role: "assistant",
                      content: "Final response from sub-agent",
                      tool_calls: undefined,
                    },
                    finish_reason: "stop",
                  },
                ],
              };
            },
          },
        },
      } as unknown,
      model: "test-model",
      baseURL: undefined,
      thinkingEnabled: false,
      debugLogEnabled: false,
    });

    const manifest = makeManifest();
    const toolExecutor = makeMockToolExecutor();

    const session = new SubAgentSession({
      manifest,
      task: "Do something specific",
      projectRoot: "/fake/project",
      parentModel: "parent-model",
      createOpenAIClient: mockCreateOpenAIClient,
      resolvedSkillPrompts: [],
      toolExecutor,
    } as SubAgentOptions);

    const result = await session.execute();

    // Verify successful execution
    assert.equal(result.ok, true);

    // Verify that exactly one LLM call was made
    assert.equal(capturedMessages.length, 1);

    // Verify the messages sent to LLM contain ONLY system + user (no parent history)
    const messages = capturedMessages[0]!;
    assert.equal(messages.length, 2, "Sub-agent should start with exactly 2 messages: system + user");
    assert.equal(messages[0]!.role, "system");
    assert.equal(messages[0]!.content, `${manifest.instructions}\n\n${SUB_AGENT_NON_INTERACTIVE_NOTE}`);
    assert.equal(messages[1]!.role, "user");
    assert.equal(messages[1]!.content, "Do something specific");
  });

  /**
   * Scenario 2: Multi-round with tool calls.
   * Verifies that intermediate tool calls and results stay internal
   * and only the final text response is returned to the parent.
   */
  test("only final assistant text is returned; intermediate tool calls do not leak to parent", async () => {
    let callCount = 0;
    const capturedMessages: Array<Array<{ role: string; content?: string | null; tool_calls?: unknown }>> = [];

    const mockCreateOpenAIClient: CreateOpenAIClient = () => ({
      client: {
        chat: {
          completions: {
            create: async (body: Record<string, unknown>) => {
              callCount++;
              // Capture messages for inspection
              capturedMessages.push(
                (body.messages as Array<{ role: string; content?: string | null; tool_calls?: unknown }>).map((m) => ({
                  role: m.role,
                  content: m.content ?? null,
                  tool_calls: (m as { tool_calls?: unknown }).tool_calls,
                }))
              );

              if (callCount === 1) {
                // First call: return a tool call (simulating intermediate work)
                return {
                  choices: [
                    {
                      message: {
                        role: "assistant",
                        content: null,
                        tool_calls: [
                          {
                            id: "tool-call-001",
                            type: "function",
                            function: {
                              name: "bash",
                              arguments: JSON.stringify({ command: "echo hello" }),
                            },
                          },
                        ],
                      },
                      finish_reason: "tool_calls",
                    },
                  ],
                };
              }

              // Second call: final text response (no more tool calls)
              return {
                choices: [
                  {
                    message: {
                      role: "assistant",
                      content: "The task is complete. Here is the result.",
                      tool_calls: undefined,
                    },
                    finish_reason: "stop",
                  },
                ],
              };
            },
          },
        },
      } as unknown,
      model: "test-model",
      baseURL: undefined,
      thinkingEnabled: false,
      debugLogEnabled: false,
    });

    const manifest = makeManifest();
    const toolExecutor = makeMockToolExecutor([
      { toolCallId: "tool-call-001", content: JSON.stringify({ ok: true, name: "bash", output: "hello\n" }) },
    ]);

    const session = new SubAgentSession({
      manifest,
      task: "Run a command and tell me the result",
      projectRoot: "/fake/project",
      parentModel: "parent-model",
      createOpenAIClient: mockCreateOpenAIClient,
      resolvedSkillPrompts: [],
      toolExecutor,
    } as SubAgentOptions);

    const result = await session.execute();

    // Verify successful execution
    assert.equal(result.ok, true);

    // The returned response is ONLY the final text — no tool call records, no intermediate messages
    assert.equal(result.response, "The task is complete. Here is the result.");

    // The result should not contain any trace of intermediate tool calls
    assert.ok(!result.response.includes("tool-call-001"), "Tool call ID should not leak");
    assert.ok(!result.response.includes("echo hello"), "Tool arguments should not leak");
    assert.ok(!result.response.includes("hello\\n"), "Tool output should not leak");

    // Verify the LLM was called twice (tool call round + final response)
    assert.equal(callCount, 2);

    // On the second LLM call, messages include the tool call exchange
    // but this is internal to the session — it does NOT appear in the result
    const secondCallMessages = capturedMessages[1]!;
    // Second call should have: system, user, assistant (with tool_calls), tool (result)
    assert.equal(secondCallMessages.length, 4);
    assert.equal(secondCallMessages[0]!.role, "system");
    assert.equal(secondCallMessages[1]!.role, "user");
    assert.equal(secondCallMessages[2]!.role, "assistant");
    assert.equal(secondCallMessages[3]!.role, "tool");
  });

  /**
   * Scenario 3: Multiple tool call rounds.
   * Verifies that even with many intermediate rounds, the parent only
   * receives the final text response — no internal state leaks.
   */
  test("multiple tool call rounds produce only final text in result (no state leakage)", async () => {
    let callCount = 0;

    const mockCreateOpenAIClient: CreateOpenAIClient = () => ({
      client: {
        chat: {
          completions: {
            create: async () => {
              callCount++;

              if (callCount <= 3) {
                // Three rounds of tool calls
                return {
                  choices: [
                    {
                      message: {
                        role: "assistant",
                        content: null,
                        tool_calls: [
                          {
                            id: `tool-call-${callCount}`,
                            type: "function",
                            function: {
                              name: "read",
                              arguments: JSON.stringify({ file_path: `/file-${callCount}.txt` }),
                            },
                          },
                        ],
                      },
                      finish_reason: "tool_calls",
                    },
                  ],
                };
              }

              // Final response after 3 tool rounds
              return {
                choices: [
                  {
                    message: {
                      role: "assistant",
                      content: "All files have been read successfully.",
                      tool_calls: undefined,
                    },
                    finish_reason: "stop",
                  },
                ],
              };
            },
          },
        },
      } as unknown,
      model: "test-model",
      baseURL: undefined,
      thinkingEnabled: false,
      debugLogEnabled: false,
    });

    const manifest = makeManifest();
    const toolExecutor = makeMockToolExecutor();

    const session = new SubAgentSession({
      manifest,
      task: "Read multiple files",
      projectRoot: "/fake/project",
      parentModel: "parent-model",
      createOpenAIClient: mockCreateOpenAIClient,
      resolvedSkillPrompts: [],
      toolExecutor,
    } as SubAgentOptions);

    const result = await session.execute();

    assert.equal(result.ok, true);
    // Only the final text is returned
    assert.equal(result.response, "All files have been read successfully.");

    // Verify no internal state leaked
    assert.ok(!result.response.includes("tool-call-"), "No tool call IDs in response");
    assert.ok(!result.response.includes("file_path"), "No tool arguments in response");

    // 3 tool rounds + 1 final response = 4 LLM calls
    assert.equal(callCount, 4);

    // SubAgentResult only has ok, response, and optionally error
    const keys = Object.keys(result);
    assert.ok(keys.includes("ok"));
    assert.ok(keys.includes("response"));
    // No fields like "messages", "toolCalls", "history" should exist
    assert.ok(!keys.includes("messages"), "No messages field should leak");
    assert.ok(!keys.includes("toolCalls"), "No toolCalls field should leak");
    assert.ok(!keys.includes("history"), "No history field should leak");
  });

  /**
   * Scenario 4: Error case — sub-agent still isolates internal state on failure.
   * Even when an error occurs, only the error message is returned, not internal context.
   */
  test("on error, only error description is returned — no internal messages leak", async () => {
    const mockCreateOpenAIClient: CreateOpenAIClient = () => ({
      client: {
        chat: {
          completions: {
            create: async () => {
              throw new Error("Network timeout connecting to LLM");
            },
          },
        },
      } as unknown,
      model: "test-model",
      baseURL: undefined,
      thinkingEnabled: false,
      debugLogEnabled: false,
    });

    const manifest = makeManifest();
    const toolExecutor = makeMockToolExecutor();

    const session = new SubAgentSession({
      manifest,
      task: "Do something that will fail",
      projectRoot: "/fake/project",
      parentModel: "parent-model",
      createOpenAIClient: mockCreateOpenAIClient,
      resolvedSkillPrompts: [],
      toolExecutor,
    } as SubAgentOptions);

    const result = await session.execute();

    assert.equal(result.ok, false);
    assert.equal(result.response, "");
    // Error should describe what happened, but not leak messages or context
    assert.ok(result.error?.includes("Network timeout"), "Error should describe the failure");
    // No internal state
    const keys = Object.keys(result);
    assert.ok(!keys.includes("messages"), "No messages field should leak on error");
    assert.ok(!keys.includes("history"), "No history field should leak on error");
  });

  /**
   * Scenario 5: Verify session messages never include simulated "parent" messages.
   * Even if we construct a sub-agent after a parent has many messages,
   * the sub-agent's first LLM call still only has system + user.
   */
  test("sub-agent context is completely independent of any parent message history", async () => {
    let capturedFirstCallMessages: Array<{ role: string }> = [];

    const mockCreateOpenAIClient: CreateOpenAIClient = () => ({
      client: {
        chat: {
          completions: {
            create: async (body: Record<string, unknown>) => {
              if (capturedFirstCallMessages.length === 0) {
                capturedFirstCallMessages = (body.messages as Array<{ role: string }>).map((m) => ({
                  role: m.role,
                }));
              }
              return {
                choices: [
                  {
                    message: {
                      role: "assistant",
                      content: "Done",
                      tool_calls: undefined,
                    },
                    finish_reason: "stop",
                  },
                ],
              };
            },
          },
        },
      } as unknown,
      model: "test-model",
      baseURL: undefined,
      thinkingEnabled: false,
      debugLogEnabled: false,
    });

    const manifest = makeManifest({ instructions: "Sub-agent system prompt" });
    const toolExecutor = makeMockToolExecutor();

    // Simulate: parent session has had extensive conversation history
    // (in reality, the SubAgentSession constructor doesn't receive parent messages at all)
    const session = new SubAgentSession({
      manifest,
      task: "A fresh task for the sub-agent",
      projectRoot: "/fake/project",
      parentModel: "parent-model",
      createOpenAIClient: mockCreateOpenAIClient,
      resolvedSkillPrompts: ["Extra skill instructions here."],
      toolExecutor,
    } as SubAgentOptions);

    const result = await session.execute();

    assert.equal(result.ok, true);
    assert.equal(result.response, "Done");

    // The first LLM call should have exactly 2 messages: system + user
    assert.equal(capturedFirstCallMessages.length, 2);
    assert.equal(capturedFirstCallMessages[0]!.role, "system");
    assert.equal(capturedFirstCallMessages[1]!.role, "user");

    // No "assistant" or "tool" messages from a parent session
    const hasParentMessages = capturedFirstCallMessages.some((m) => m.role === "assistant" || m.role === "tool");
    assert.equal(hasParentMessages, false, "No parent assistant/tool messages should be in sub-agent context");
  });
});

// =============================================================================
// AskUserQuestion exclusion and non-interactive guidance
// =============================================================================
// Sub-agent sessions are single-shot and non-interactive: there is no mechanism
// to pause execution and route a question to a real user. The AskUserQuestion
// tool must not be offered to the sub-agent LLM, and the system prompt must
// explain this limitation so the sub-agent states assumptions/open questions
// in its final text response instead.

describe("Sub-agent non-interactive constraints", () => {
  function makeManifest(overrides: Partial<AgentManifest> = {}): AgentManifest {
    return {
      name: "test-agent",
      description: "A test sub-agent",
      model: "test-model",
      skills: [],
      instructions: "You are a helpful test agent.",
      sourcePath: "/fake/path/AGENT.md",
      sourceRoot: "./.deepcode/agents",
      ...overrides,
    };
  }

  function makeMockToolExecutor(): ToolExecutor {
    return {
      executeToolCalls: async (_sessionId: string, toolCalls: unknown[]) => {
        const calls = toolCalls as Array<{ id: string; function: { name: string; arguments: string } }>;
        return calls.map((tc) => ({
          toolCallId: tc.id,
          content: JSON.stringify({ ok: true, name: tc.function.name, output: "done" }),
          result: { ok: true, name: tc.function.name, output: "done" },
        }));
      },
    } as unknown as ToolExecutor;
  }

  test("buildSystemPrompt() always appends the non-interactive note", () => {
    const manifest = makeManifest();
    const session = new SubAgentSession({
      manifest,
      task: "irrelevant",
      projectRoot: "/fake/project",
      parentModel: "parent-model",
      createOpenAIClient: (() => ({})) as unknown as CreateOpenAIClient,
      resolvedSkillPrompts: [],
      toolExecutor: makeMockToolExecutor(),
    } as SubAgentOptions);

    const prompt = session.buildSystemPrompt();
    assert.equal(prompt, `${manifest.instructions}\n\n${SUB_AGENT_NON_INTERACTIVE_NOTE}`);
    assert.ok(prompt.includes("non-interactive"));
  });

  test("buildSystemPrompt() with no instructions and no skills returns only the non-interactive note", () => {
    const manifest = makeManifest({ instructions: "" });
    const session = new SubAgentSession({
      manifest,
      task: "irrelevant",
      projectRoot: "/fake/project",
      parentModel: "parent-model",
      createOpenAIClient: (() => ({})) as unknown as CreateOpenAIClient,
      resolvedSkillPrompts: [],
      toolExecutor: makeMockToolExecutor(),
    } as SubAgentOptions);

    const prompt = session.buildSystemPrompt();
    assert.equal(prompt, SUB_AGENT_NON_INTERACTIVE_NOTE);
  });

  test("AskUserQuestion tool is excluded from the tools list passed to the sub-agent LLM", async () => {
    let capturedTools: Array<{ function: { name: string } }> | undefined;

    const mockCreateOpenAIClient: CreateOpenAIClient = () => ({
      client: {
        chat: {
          completions: {
            create: async (body: Record<string, unknown>) => {
              capturedTools = body.tools as Array<{ function: { name: string } }> | undefined;
              return {
                choices: [
                  {
                    message: {
                      role: "assistant",
                      content: "Done",
                      tool_calls: undefined,
                    },
                    finish_reason: "stop",
                  },
                ],
              };
            },
          },
        },
      } as unknown,
      model: "test-model",
      baseURL: undefined,
      thinkingEnabled: false,
      debugLogEnabled: false,
    });

    const manifest = makeManifest();
    const session = new SubAgentSession({
      manifest,
      task: "Do something",
      projectRoot: "/fake/project",
      parentModel: "parent-model",
      createOpenAIClient: mockCreateOpenAIClient,
      resolvedSkillPrompts: [],
      toolExecutor: makeMockToolExecutor(),
    } as SubAgentOptions);

    const result = await session.execute();

    assert.equal(result.ok, true);
    assert.ok(capturedTools, "Tools should have been passed to the LLM call");
    const toolNames = capturedTools!.map((t) => t.function.name);
    assert.ok(!toolNames.includes("AskUserQuestion"), "AskUserQuestion must not be offered to sub-agent LLM calls");
    assert.ok(toolNames.length > 0, "Other built-in tools should still be present");
  });
});
