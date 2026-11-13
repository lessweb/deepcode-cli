import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import {
  getCompletedProposedPlan,
  persistProposedPlan,
  PLAN_IMPLEMENTATION_CHOICES,
} from "../common/plan-implementation";

test("plan choices have a shared order and labels", () => {
  assert.deepEqual(PLAN_IMPLEMENTATION_CHOICES, [
    { value: "implement", label: "implement this plan" },
    { value: "clear-context", label: "clear context and implement" },
    { value: "stay", label: "stay in Plan mode" },
    { value: "default", label: "switch to Default mode" },
  ]);
});

test("only a completed Plan request with a complete non-empty plan triggers the chooser", () => {
  const reply = "Here is the plan.\n<proposed_plan>\n# Plan\n\n- Verify the change\n</proposed_plan>";
  assert.equal(getCompletedProposedPlan(true, "completed", reply), "# Plan\n\n- Verify the change");
  assert.equal(getCompletedProposedPlan(false, "completed", reply), null);
  for (const status of ["processing", "pending", "waiting_for_user", "ask_permission", "interrupted", "failed", null]) {
    assert.equal(getCompletedProposedPlan(true, status, reply), null);
  }
  for (const text of [null, "", "No plan", "<proposed_plan>Partial", "<proposed_plan>\n </proposed_plan>"]) {
    assert.equal(getCompletedProposedPlan(true, "completed", text), null);
  }
});

test("a finished plan is persisted under .deepcode/plans so it outlives the turn", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deepcode-plan-"));
  try {
    const relative = persistProposedPlan(root, "# Plan\n\n- Verify the change\n");
    assert.ok(relative, "expected a relative path back");
    assert.match(relative, /^\.deepcode\/plans\/.+\.md$/);

    const written = fs.readFileSync(path.join(root, relative), "utf8");
    assert.equal(written, "# Plan\n\n- Verify the change\n");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("plan persistence is best-effort and never throws", () => {
  // No project root, or an empty plan, is a no-op rather than an error.
  assert.equal(persistProposedPlan("", "# Plan"), null);
  assert.equal(persistProposedPlan("/tmp", "   "), null);
});
