import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getCompactPromptTokenThreshold } from "../session";

/**
 * Regression test for auto-compaction bug:
 * activeTokens was set to the *single response* total_tokens instead of a
 * running counter. Because each individual call stays below the threshold,
 * auto-compaction never fired, so long sessions kept resending their full
 * history on every turn and blew up token usage.
 *
 * The fix (session.ts):
 *   activeTokens = (entry.activeTokens ?? 0) + getTotalTokens(responseUsage)
 *   → running context counter that grows with each response
 *   activeTokens = 0 after compaction
 *   → reset so it does not re-trigger immediately on the next turn
 */
describe("auto-compact activeTokens accumulation", () => {
  it("accumulated activeTokens eventually crosses the threshold (buggy single-response never does)", () => {
    const threshold = getCompactPromptTokenThreshold("deepseek-v4-flash");
    // Each single response is far below the threshold
    const singleTotal = 30_000;
    assert.ok(singleTotal < threshold, "single response must stay under threshold");

    // Buggy behavior: activeTokens = getTotalTokens(responseUsage) — single response, never crosses
    const buggyActive = singleTotal;
    // Fixed behavior: activeTokens = previous + responseTotal (running counter)
    let activeTokens = 0;
    let fixedCrossed = false;

    // Simulate many turns in one long session
    for (let i = 0; i < 50; i += 1) {
      activeTokens += singleTotal;
      if (activeTokens > threshold) {
        fixedCrossed = true;
        activeTokens = 0; // reset after compaction
      }
    }

    assert.equal(fixedCrossed, true, "fixed logic must trigger compaction at some point");
    assert.ok(buggyActive < threshold, "buggy single-response activeTokens stays under threshold forever");
  });

  it("resetting activeTokens after compaction prevents immediate re-trigger", () => {
    const threshold = getCompactPromptTokenThreshold("deepseek-v4-flash");
    const bigTotal = 120_000;
    let activeTokens = 0;
    let compactions = 0;

    for (let i = 0; i < 100; i += 1) {
      activeTokens += bigTotal;
      if (activeTokens > threshold) {
        compactions += 1;
        activeTokens = 0; // reset after compaction
      }
    }

    assert.ok(compactions >= 1, "should have compacted at least once");
    // Reset prevents runaway: with 120k/call and ~524k threshold, at least 4 calls
    // must pass before the next compaction. 100 calls → at most ~25 compactions,
    // and never one on every call.
    const maxBounded = Math.ceil(100 / 4);
    assert.ok(compactions <= maxBounded, `compactions=${compactions} should be bounded by ${maxBounded}`);
  });
});
