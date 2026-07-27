/**
 * Unit tests for AskQuestionSummary component
 *
 * Tests cover:
 * - Rendering Q&A content
 * - Styling of Q: lines vs A: lines
 * - Multiple Q&A pairs
 * - Empty content
 * - BubbleDot rendering
 */

import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import AskQuestionSummary from "./AskQuestionSummary";

vi.mock("@/webview/components/bubbles/BubbleDot", () => ({
  default: vi.fn(({ variant }: { variant: string }) => <span data-testid="bubble-dot" data-variant={variant} />),
}));

// cn from @/webview/lib/utils is used with clsx objects, so we need a proper mock
vi.mock("@/webview/lib/utils", () => ({
  cn: (...inputs: (string | Record<string, boolean> | undefined | null)[]) => {
    return inputs
      .map((input) => {
        if (!input) return "";
        if (typeof input === "string") return input;
        if (typeof input === "object") {
          return Object.entries(input)
            .filter(([, v]) => v)
            .map(([k]) => k)
            .join(" ");
        }
        return String(input);
      })
      .filter(Boolean)
      .join(" ");
  },
}));

describe("AskQuestionSummary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders Q&A content", () => {
    const content = "Q: What framework?" + "\n" + "A: React";
    render(<AskQuestionSummary content={content} />);
    expect(screen.getByText("Q: What framework?")).toBeInTheDocument();
    expect(screen.getByText("A: React")).toBeInTheDocument();
  });

  it("renders '明白了，请稍等...' follow-up text", () => {
    const content = "Q: What framework?" + "\n" + "A: React";
    render(<AskQuestionSummary content={content} />);
    expect(screen.getByText("明白了，请稍等...")).toBeInTheDocument();
  });

  it("renders Q lines with muted style", () => {
    render(<AskQuestionSummary content="Q: What framework?" />);
    const qLine = screen.getByText("Q: What framework?");
    expect(qLine.className).toContain("text-muted-foreground");
    expect(qLine.className).toContain("font-normal");
  });

  it("renders non-Q lines with bold style", () => {
    render(<AskQuestionSummary content="A: React" />);
    const aLine = screen.getByText("A: React");
    expect(aLine.className).toContain("font-bold");
  });

  it("renders BubbleDot with success variant", () => {
    render(<AskQuestionSummary content="Single answer" />);
    const dot = screen.getByTestId("bubble-dot");
    expect(dot).toBeInTheDocument();
    expect(dot.getAttribute("data-variant")).toBe("success");
  });

  it("renders multiple Q&A pairs", () => {
    const content = ["Q: First question?", "A: Option A, Option B", "Q: Second question?", "A: Value"].join("\n");
    render(<AskQuestionSummary content={content} />);
    expect(screen.getByText("Q: First question?")).toBeInTheDocument();
    expect(screen.getByText("Q: Second question?")).toBeInTheDocument();
  });

  it("handles single line content", () => {
    render(<AskQuestionSummary content="Single answer" />);
    expect(screen.getByText("Single answer")).toBeInTheDocument();
  });
});
