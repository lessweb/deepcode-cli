import { test } from "node:test";
import assert from "node:assert/strict";
import { getThinkingOptionIndex, MODEL_COMMAND_MODELS, MODEL_COMMAND_THINKING_OPTIONS } from "../ui";

test("model dropdown offers supported DeepSeek models", () => {
  assert.deepEqual(MODEL_COMMAND_MODELS, ["deepseek-v4-pro", "deepseek-v4-flash", "deepseek-v4-flash-vision-exp"]);
});

test("model dropdown offers all reasoning effort levels", () => {
  assert.deepEqual(
    MODEL_COMMAND_THINKING_OPTIONS.map((option) => option.reasoningEffort),
    ["max", "high", "low", undefined]
  );
  assert.equal(getThinkingOptionIndex({ thinkingEnabled: true, reasoningEffort: "low" }), 2);
});
