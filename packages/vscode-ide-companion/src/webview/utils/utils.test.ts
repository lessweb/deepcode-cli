/**
 * Unit tests for utils/index.ts
 *
 * Tests cover:
 * - flattenUsageFields
 * - getTokenUsagePercent
 * - formatUsageFieldLabel
 * - toTitleCase
 * - buildAskUserQuestionReply
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from "vitest";
import {
  flattenUsageFields,
  getTokenUsagePercent,
  formatUsageFieldLabel,
  toTitleCase,
  buildAskUserQuestionReply,
} from "./index";
import type { AnswerFormValues } from "@/webview/components/AskUserQuestion";

describe("flattenUsageFields", () => {
  it("returns empty array for null input", () => {
    expect(flattenUsageFields(null)).toEqual([]);
    expect(flattenUsageFields(undefined)).toEqual([]);
  });

  it("returns empty array for primitive values", () => {
    expect(flattenUsageFields(123)).toEqual([]);
    expect(flattenUsageFields("string")).toEqual([]);
    expect(flattenUsageFields(true)).toEqual([]);
  });

  it("returns empty array for arrays", () => {
    expect(flattenUsageFields([1, 2, 3])).toEqual([]);
  });

  it("flattens nested objects with prefix", () => {
    const input = {
      prompt_tokens: 100,
      completion_tokens: 50,
      details: {
        reasoning_tokens: 20,
      },
    };

    const result = flattenUsageFields(input);

    expect(result).toContainEqual(["prompt_tokens", 100]);
    expect(result).toContainEqual(["completion_tokens", 50]);
    expect(result).toContainEqual(["details.reasoning_tokens", 20]);
  });

  it("handles flat objects without prefix", () => {
    const input = { a: 1, b: 2 };
    const result = flattenUsageFields(input);

    expect(result).toContainEqual(["a", 1]);
    expect(result).toContainEqual(["b", 2]);
  });
});

describe("getTokenUsagePercent", () => {
  it("returns 0 for undefined telemetry", () => {
    expect(getTokenUsagePercent(undefined)).toBe(0);
  });

  it("returns 0 when activeTokens is 0", () => {
    expect(getTokenUsagePercent({ activeTokens: 0, compactPromptTokenThreshold: 1000 } as any)).toBe(0);
  });

  it("returns 0 when threshold is 0", () => {
    expect(getTokenUsagePercent({ activeTokens: 500, compactPromptTokenThreshold: 0 } as any)).toBe(0);
  });

  it("returns 0 when threshold is negative", () => {
    expect(getTokenUsagePercent({ activeTokens: 500, compactPromptTokenThreshold: -100 } as any)).toBe(0);
  });

  it("calculates correct percentage", () => {
    // Formula: (0.5 * activeTokens) / threshold * 100
    // (0.5 * 500) / 1000 * 100 = 250 / 1000 * 100 = 0.25 * 100 = 25
    const result = getTokenUsagePercent({
      activeTokens: 500,
      compactPromptTokenThreshold: 1000,
    } as any);
    expect(result).toBe(25);
  });

  it("floors the result", () => {
    // Formula: (0.5 * activeTokens) / threshold * 100
    // (0.5 * 333) / 1000 * 100 = 166.5 / 1000 * 100 = 0.1665 * 100 = 16.65
    // truncated = 16
    const result = getTokenUsagePercent({
      activeTokens: 333,
      compactPromptTokenThreshold: 1000,
    } as any);
    expect(result).toBe(16);
  });

  it("handles string values", () => {
    // String "500" converts to 500, "1000" to 1000
    // 500 / 1000 = 0.5, * 100 = 50
    // But Number("500") = 500, Number("1000") = 1000
    const result = getTokenUsagePercent({
      activeTokens: "500",
      compactPromptTokenThreshold: "1000",
    } as any);
    // The function uses Number() which converts strings correctly
    // But the formula is (0.5 * activeTokens) / threshold
    // So (0.5 * 500) / 1000 = 250 / 1000 = 0.25 * 100 = 25
    expect(result).toBe(25);
  });
});

describe("formatUsageFieldLabel", () => {
  it("returns original label for non-matching strings", () => {
    expect(formatUsageFieldLabel("some_field")).toBe("some_field");
    expect(formatUsageFieldLabel("")).toBe("");
  });

  it("formats cached_tokens", () => {
    expect(formatUsageFieldLabel("prompt_tokens_details.cached_tokens")).toBe("prompt_cached_tokens");
  });

  it("formats reasoning_tokens", () => {
    expect(formatUsageFieldLabel("completion_tokens_details.reasoning_tokens")).toBe("completion_reasoning_tokens");
  });
});

describe("toTitleCase", () => {
  it("converts empty string to empty string", () => {
    expect(toTitleCase("")).toBe("");
  });

  it("converts single word", () => {
    expect(toTitleCase("hello")).toBe("Hello");
  });

  it("converts underscore separated words", () => {
    expect(toTitleCase("hello_world")).toBe("Hello World");
  });

  it("converts multiple underscores", () => {
    expect(toTitleCase("prompt_cache_hit_tokens")).toBe("Prompt Cache Hit Tokens");
  });

  it("handles already capitalized words", () => {
    // toTitleCase capitalizes first letter of each word, rest stays as-is
    expect(toTitleCase("API_KEY")).toBe("API KEY");
  });

  it("handles mixed case", () => {
    expect(toTitleCase("helloWorld")).toBe("HelloWorld");
  });
});

describe("buildAskUserQuestionReply", () => {
  it("returns error when all answers are empty", () => {
    const answers = [{ question: "Q1", options: [], other: "" }] as AnswerFormValues["answers"];

    const result = buildAskUserQuestionReply(answers);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Please answer question 1");
  });

  it("returns error for partially empty answers", () => {
    const answers = [
      { question: "Q1", options: ["A"], other: "" },
      { question: "Q2", options: [], other: "" },
    ] as AnswerFormValues["answers"];

    const result = buildAskUserQuestionReply(answers);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Please answer question 2");
  });

  it("returns ok with text when answers are valid (options only)", () => {
    const answers = [{ question: "Q1", options: ["A", "B"], other: "" }] as AnswerFormValues["answers"];

    const result = buildAskUserQuestionReply(answers);

    expect(result.ok).toBe(true);
    expect(result.text).toContain("Answer to AskUserQuestion:");
    expect(result.text).toContain("1. Q1");
    expect(result.text).toContain("Selected: A, B");
  });

  it("returns ok with text when answers are valid (other only)", () => {
    const answers = [{ question: "Q1", options: [], other: "Custom answer" }] as AnswerFormValues["answers"];

    const result = buildAskUserQuestionReply(answers);

    expect(result.ok).toBe(true);
    expect(result.text).toContain("Other: Custom answer");
  });

  it("returns ok with text when answers have both options and other", () => {
    const answers = [{ question: "Q1", options: ["A"], other: "Additional info" }] as AnswerFormValues["answers"];

    const result = buildAskUserQuestionReply(answers);

    expect(result.ok).toBe(true);
    expect(result.text).toContain("Selected: A");
    expect(result.text).toContain("Other: Additional info");
  });

  it("handles multiple questions", () => {
    const answers = [
      { question: "Q1", options: ["A"], other: "" },
      { question: "Q2", options: ["B", "C"], other: "" },
      { question: "Q3", options: [], other: "Custom" },
    ] as AnswerFormValues["answers"];

    const result = buildAskUserQuestionReply(answers);

    expect(result.ok).toBe(true);
    expect(result.text).toContain("1. Q1");
    expect(result.text).toContain("2. Q2");
    expect(result.text).toContain("3. Q3");
  });

  it("trims whitespace from other field", () => {
    const answers = [{ question: "Q1", options: [], other: "   " }] as AnswerFormValues["answers"];

    const result = buildAskUserQuestionReply(answers);

    expect(result.ok).toBe(false); // Empty after trim
  });
});
