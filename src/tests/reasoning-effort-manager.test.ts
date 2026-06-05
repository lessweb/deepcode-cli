import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { RuntimeReasoningEffortManager, type TurnInput } from "../common/reasoning-effort-manager";

function mkExec(ok: boolean, name = "bash"): TurnInput["toolExecutions"][number] {
  return { ok, name, output: ok ? "success" : undefined, error: ok ? undefined : "fail" };
}

function mkCall(name: string, args: string): TurnInput["toolCalls"][number] {
  return { id: "call-1", type: "function", function: { name, arguments: args } };
}

describe("RuntimeReasoningEffortManager", () => {
  test("starts at high", () => {
    const m = new RuntimeReasoningEffortManager();
    assert.equal(m.getCurrentEffort(), "high");
  });

  test("escalates on 2 consecutive failures", () => {
    const m = new RuntimeReasoningEffortManager();
    assert.equal(
      m.evaluate({
        toolCalls: [mkCall("bash", '{"cmd":"x"}')],
        toolExecutions: [mkExec(false)],
      }),
      null
    );
    assert.equal(m.getCurrentEffort(), "high");
    assert.equal(
      m.evaluate({
        toolCalls: [mkCall("bash", '{"cmd":"y"}')],
        toolExecutions: [mkExec(false)],
      }),
      "max"
    );
    assert.equal(m.getCurrentEffort(), "max");
  });

  test("resets failure counter on success", () => {
    const m = new RuntimeReasoningEffortManager();
    m.evaluate({ toolCalls: [mkCall("bash", "{}")], toolExecutions: [mkExec(false)] });
    m.evaluate({ toolCalls: [mkCall("bash", "{}")], toolExecutions: [mkExec(true)] });
    m.evaluate({ toolCalls: [mkCall("bash", "{}")], toolExecutions: [mkExec(false)] });
    assert.equal(m.getCurrentEffort(), "high");
  });

  test("escalates on 3 identical tool calls", () => {
    const m = new RuntimeReasoningEffortManager();
    const call = mkCall("read", '{"file_path":"/x"}');
    assert.equal(m.evaluate({ toolCalls: [call], toolExecutions: [mkExec(true)] }), null);
    assert.equal(m.evaluate({ toolCalls: [call], toolExecutions: [mkExec(true)] }), null);
    assert.equal(m.evaluate({ toolCalls: [call], toolExecutions: [mkExec(true)] }), "max");
  });

  test("downgrades after 5 clean turns (default threshold)", () => {
    const m = new RuntimeReasoningEffortManager();
    // Escalate first
    m.evaluate({ toolCalls: [mkCall("bash", "{}")], toolExecutions: [mkExec(false)] });
    m.evaluate({ toolCalls: [mkCall("bash", "{}")], toolExecutions: [mkExec(false)] });
    assert.equal(m.getCurrentEffort(), "max");

    // Cooldown: first 3 turns at "max" cannot downgrade
    for (let i = 0; i < 3; i++) {
      const call = mkCall("bash", `{"cmd":"cooldown${i}"}`);
      assert.equal(m.evaluate({ toolCalls: [call], toolExecutions: [mkExec(true)] }), null);
    }
    assert.equal(m.getCurrentEffort(), "max");

    // Now 5 clean turns with different fingerprints
    for (let i = 0; i < 5; i++) {
      const call = mkCall("bash", `{"cmd":"unique${i}"}`);
      m.evaluate({ toolCalls: [call], toolExecutions: [mkExec(true)] });
    }
    assert.equal(m.getCurrentEffort(), "high");
  });

  test("fingerprint is independent of argument whitespace", () => {
    const fp1 = RuntimeReasoningEffortManager.computeFingerprint([
      { id: "a", type: "function", function: { name: "bash", arguments: '{"cmd":  "x"}' } },
    ]);
    const fp2 = RuntimeReasoningEffortManager.computeFingerprint([
      { id: "b", type: "function", function: { name: "bash", arguments: '{"cmd":"x"}' } },
    ]);
    assert.equal(fp1, fp2);
  });

  test("reset clears all state", () => {
    const m = new RuntimeReasoningEffortManager();
    m.evaluate({ toolCalls: [mkCall("bash", "{}")], toolExecutions: [mkExec(false)] });
    m.evaluate({ toolCalls: [mkCall("bash", "{}")], toolExecutions: [mkExec(false)] });
    assert.equal(m.getCurrentEffort(), "max");
    m.reset();
    assert.equal(m.getCurrentEffort(), "high");
    assert.equal(m.getState().consecutiveFailures, 0);
    assert.equal(m.getState().cleanTurnStreak, 0);
  });

  test("cooldown prevents immediate re-escalation after downgrade", () => {
    const m = new RuntimeReasoningEffortManager();
    // Escalate
    m.evaluate({ toolCalls: [mkCall("bash", "{}")], toolExecutions: [mkExec(false)] });
    m.evaluate({ toolCalls: [mkCall("bash", "{}")], toolExecutions: [mkExec(false)] });
    assert.equal(m.getCurrentEffort(), "max");
    // Downgrade via 8 clean turns (3 cooldown + 5 threshold)
    for (let i = 0; i < 3; i++) {
      m.evaluate({ toolCalls: [mkCall("bash", `{"c":"a${i}"}`)], toolExecutions: [mkExec(true)] });
    }
    for (let i = 0; i < 5; i++) {
      m.evaluate({ toolCalls: [mkCall("bash", `{"c":"b${i}"}`)], toolExecutions: [mkExec(true)] });
    }
    assert.equal(m.getCurrentEffort(), "high");
    // Immediate failure should NOT re-escalate (cooldown active)
    assert.equal(m.evaluate({ toolCalls: [mkCall("bash", "{}")], toolExecutions: [mkExec(false)] }), null);
    assert.equal(m.getCurrentEffort(), "high");
  });

  test("anti-flapping doubles downgrade threshold on repeated cycles", () => {
    const m = new RuntimeReasoningEffortManager();
    // First cycle: escalate
    m.evaluate({ toolCalls: [mkCall("bash", "{}")], toolExecutions: [mkExec(false)] });
    m.evaluate({ toolCalls: [mkCall("bash", "{}")], toolExecutions: [mkExec(false)] });
    assert.equal(m.getCurrentEffort(), "max");
    // Downgrade: 3 cooldown + 5 clean
    for (let i = 0; i < 3; i++) {
      m.evaluate({ toolCalls: [mkCall("b", `${i}`)], toolExecutions: [mkExec(true)] });
    }
    for (let i = 0; i < 5; i++) {
      m.evaluate({ toolCalls: [mkCall("b", `d${i}`)], toolExecutions: [mkExec(true)] });
    }
    assert.equal(m.getCurrentEffort(), "high");
    // Second cycle: escalate again (cooldown absorbs first 2 failures)
    for (let i = 0; i < 2; i++) {
      m.evaluate({ toolCalls: [mkCall("b", `e${i}`)], toolExecutions: [mkExec(false)] });
    }
    m.evaluate({ toolCalls: [mkCall("b", "e2")], toolExecutions: [mkExec(false)] });
    m.evaluate({ toolCalls: [mkCall("b", "e3")], toolExecutions: [mkExec(false)] });
    assert.equal(m.getCurrentEffort(), "max");
    // Downgrade: 3 cooldown + now 10 clean turns needed (threshold doubled)
    for (let i = 0; i < 3; i++) {
      m.evaluate({ toolCalls: [mkCall("b", `f${i}`)], toolExecutions: [mkExec(true)] });
    }
    for (let i = 0; i < 9; i++) {
      m.evaluate({ toolCalls: [mkCall("b", `g${i}`)], toolExecutions: [mkExec(true)] });
    }
    assert.equal(m.getCurrentEffort(), "max"); // still max, threshold not met
    m.evaluate({ toolCalls: [mkCall("b", "g9")], toolExecutions: [mkExec(true)] }); // 10th clean
    assert.equal(m.getCurrentEffort(), "high"); // now downgraded
  });

  test("no escalation on first turn (empty executions)", () => {
    const m = new RuntimeReasoningEffortManager();
    assert.equal(m.evaluate({ toolCalls: [mkCall("bash", "{}")], toolExecutions: [] }), null);
    assert.equal(m.getCurrentEffort(), "high");
  });
});
