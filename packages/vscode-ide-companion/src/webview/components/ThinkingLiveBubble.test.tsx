/**
 * Unit tests for ThinkingLiveBubble component
 *
 * Tests cover:
 * - Rendering with null props
 * - Rendering with llmStreamProgress
 * - Rendering with processes
 * - Interval-based status update
 * - Spinner and ProgressShimmer rendering
 * - Status text formatting
 * - Cleanup of interval on unmount
 */

import React from "react";
import { render, screen, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import ThinkingLiveBubble from "./ThinkingLiveBubble";
import type { LlmStreamProgressData } from "@/webview/types";

vi.mock("./ui/spinner", () => ({
  Spinner: vi.fn(({ className }: { className: string }) => <span data-testid="spinner" className={className} />),
}));

vi.mock("./ProgressShimmer", () => ({
  default: vi.fn(({ children, className }: { children: React.ReactNode; className?: string }) => (
    <span data-testid="progress-shimmer" className={className}>
      {children}
    </span>
  )),
}));

describe("ThinkingLiveBubble", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T10:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("renders with null props gracefully", () => {
    render(<ThinkingLiveBubble llmStreamProgress={null} processes={null} />);
    expect(screen.getByText("Thinking")).toBeInTheDocument();
    expect(screen.getByTestId("spinner")).toBeInTheDocument();
    expect(screen.getByTestId("progress-shimmer")).toBeInTheDocument();
  });

  it('renders "Processing..." when no progress or processes', () => {
    render(<ThinkingLiveBubble llmStreamProgress={null} processes={null} />);
    expect(screen.getByText("Processing...")).toBeInTheDocument();
  });

  it("renders with llmStreamProgress when started recently", () => {
    const progress: LlmStreamProgressData = {
      requestId: "req-1",
      sessionId: "sess-1",
      phase: "streaming",
      formattedTokens: "1.5k",
      startedAt: new Date(Date.now()).toISOString(),
    };
    render(<ThinkingLiveBubble llmStreamProgress={progress} processes={null} />);
    expect(screen.getByText("Thinking")).toBeInTheDocument();
    expect(screen.getByTestId("spinner")).toBeInTheDocument();
  });

  it("shows token count after 3 seconds elapsed", () => {
    const progress: LlmStreamProgressData = {
      requestId: "req-1",
      sessionId: "sess-1",
      phase: "streaming",
      formattedTokens: "2.3k",
      startedAt: new Date(Date.now() - 5000).toISOString(),
    };
    render(<ThinkingLiveBubble llmStreamProgress={progress} processes={null} />);
    // After 5 seconds, should show (5s) · ↓ 2.3k tokens
    expect(screen.getByText(/5s.*2\.3k/)).toBeInTheDocument();
  });

  it("shows token count as 0 by default", () => {
    const progress: LlmStreamProgressData = {
      requestId: "req-1",
      sessionId: "sess-1",
      phase: "start",
      startedAt: new Date(Date.now() - 10000).toISOString(),
    };
    render(<ThinkingLiveBubble llmStreamProgress={progress} processes={null} />);
    // No formattedTokens, defaults to "0"
    expect(screen.getByText(/10s.*0 tokens/)).toBeInTheDocument();
  });

  it("renders process info when processes are present", () => {
    const processes = {
      "proc-1": { startTime: new Date(Date.now() - 30000).toISOString(), command: "npm run build" },
    };
    render(<ThinkingLiveBubble llmStreamProgress={null} processes={processes} />);
    // Process takes priority over progress; status text shows elapsed time + command
    // The text is "(30s) npm run build" – there's a space between time and command
    expect(screen.getByText(/npm run build/)).toBeInTheDocument();
  });

  it("updates status text every second via interval", () => {
    const processes = {
      "proc-1": { startTime: new Date(Date.now()).toISOString(), command: "test" },
    };
    render(<ThinkingLiveBubble llmStreamProgress={null} processes={processes} />);

    // Initially: (0s) test
    expect(screen.getByText("(0s) test")).toBeInTheDocument();

    // Advance timer by 5 seconds -> should now show (5s) test
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByText("(5s) test")).toBeInTheDocument();
  });

  it("clears interval on unmount", () => {
    const spy = vi.spyOn(window, "clearInterval");
    const { unmount } = render(<ThinkingLiveBubble llmStreamProgress={null} processes={null} />);
    unmount();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("recreates interval when props change", () => {
    const processes1 = {
      p1: { startTime: new Date(Date.now()).toISOString(), command: "cmd1" },
    };
    const { rerender } = render(<ThinkingLiveBubble llmStreamProgress={null} processes={processes1} />);

    expect(screen.getByText("(0s) cmd1")).toBeInTheDocument();

    // Change processes prop
    const processes2 = {
      p2: { startTime: new Date(Date.now()).toISOString(), command: "cmd2" },
    };
    rerender(<ThinkingLiveBubble llmStreamProgress={null} processes={processes2} />);

    // Should now show the new process
    expect(screen.getByText(/cmd2/)).toBeInTheDocument();
  });

  it("renders spinner with proper size class", () => {
    render(<ThinkingLiveBubble llmStreamProgress={null} processes={null} />);
    const spinner = screen.getByTestId("spinner");
    expect(spinner.className).toContain("size-3.5");
  });

  it('renders "Thinking" text inside ProgressShimmer', () => {
    render(<ThinkingLiveBubble llmStreamProgress={null} processes={null} />);
    const shimmer = screen.getByTestId("progress-shimmer");
    expect(shimmer).toBeInTheDocument();
    expect(screen.getByText("Thinking")).toBeInTheDocument();
  });
});
