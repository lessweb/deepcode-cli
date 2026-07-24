/**
 * Unit tests for ContextIndicator component
 *
 * Tests cover:
 * - Rendering ProgressRing trigger
 * - HoverCard content (model, thinking, effort, tokens)
 * - Session usage display
 * - Token formatting
 * - Missing/empty tokenTelemetry
 */

import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import ContextIndicator from "./ContextIndicator";
import type { TokenTelemetry } from "@/webview/types";

vi.mock("./ui/hover-card", () => ({
  HoverCard: vi.fn(({ children }: { children: React.ReactNode }) => <div data-testid="hover-card">{children}</div>),
  HoverCardContent: vi.fn(({ children }: { children: React.ReactNode }) => (
    <div data-testid="hover-card-content">{children}</div>
  )),
  HoverCardTrigger: vi.fn(({ children }: { children: React.ReactNode }) => (
    <div data-testid="hover-card-trigger">{children}</div>
  )),
}));

vi.mock("./ui/input-group", () => ({
  InputGroupButton: vi.fn(({ children, ...props }: { children: React.ReactNode }) => (
    <button data-testid="input-group-button" {...props}>
      {children}
    </button>
  )),
}));

vi.mock("./ui/progress-ring", () => ({
  ProgressRing: vi.fn(({ value }: { value: number }) => <span data-testid="progress-ring" data-value={value} />),
}));

vi.mock("./ui/progress", () => ({
  Progress: vi.fn(({ value }: { value: number }) => <progress data-testid="progress-bar" value={value} max={100} />),
}));

vi.mock("./ui/field", () => ({
  Field: vi.fn(({ children }: { children: React.ReactNode }) => <div data-testid="field">{children}</div>),
  FieldLabel: vi.fn(({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) => (
    <label data-testid="field-label" htmlFor={htmlFor}>
      {children}
    </label>
  )),
}));

vi.mock("./ui/separator", () => ({
  Separator: vi.fn(() => <hr data-testid="separator" />),
}));

vi.mock("@/webview/utils", () => ({
  flattenUsageFields: vi.fn((usage: Record<string, unknown> | undefined) => {
    if (!usage) return [];
    return [
      ["total_tokens", 5000],
      ["prompt_cached_tokens", 2000],
    ];
  }),
  formatUsageFieldLabel: vi.fn((label: string) => label),
  getTokenUsagePercent: vi.fn((tt: TokenTelemetry | undefined) => {
    if (!tt?.activeTokens || !tt?.compactPromptTokenThreshold) return 0;
    return Math.min(100, Math.floor((tt.activeTokens / tt.compactPromptTokenThreshold) * 100));
  }),
  toTitleCase: vi.fn((str: string) => str.charAt(0).toUpperCase() + str.slice(1)),
}));

const baseTelemetry: TokenTelemetry = {
  model: "claude-sonnet-4-20250514",
  thinkingEnabled: true,
  reasoningEffort: "max",
  activeTokens: 50000,
  compactPromptTokenThreshold: 200000,
  usage: {
    total_tokens: 150000,
    prompt_cached_tokens: 50000,
  },
};

describe("ContextIndicator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the ProgressRing trigger button", () => {
    render(<ContextIndicator tokenTelemetry={baseTelemetry} />);
    expect(screen.getByTestId("input-group-button")).toBeInTheDocument();
    expect(screen.getByTestId("progress-ring")).toBeInTheDocument();
  });

  it("renders with 0% when tokenTelemetry is undefined", () => {
    render(<ContextIndicator tokenTelemetry={undefined} />);
    const ring = screen.getByTestId("progress-ring");
    expect(ring.getAttribute("data-value")).toBe("0");
  });

  it("displays model name in hover card", () => {
    render(<ContextIndicator tokenTelemetry={baseTelemetry} />);
    expect(screen.getByText("claude-sonnet-4-20250514")).toBeInTheDocument();
  });

  it('displays "unknown" model when not provided', () => {
    render(<ContextIndicator tokenTelemetry={{ ...baseTelemetry, model: "" }} />);
    expect(screen.getByText("unknown")).toBeInTheDocument();
  });

  it("displays thinking enabled state", () => {
    render(<ContextIndicator tokenTelemetry={baseTelemetry} />);
    expect(screen.getByText("true")).toBeInTheDocument();
  });

  it("displays thinking disabled state", () => {
    render(<ContextIndicator tokenTelemetry={{ ...baseTelemetry, thinkingEnabled: false }} />);
    expect(screen.getByText("false")).toBeInTheDocument();
  });

  it("displays reasoning effort", () => {
    render(<ContextIndicator tokenTelemetry={baseTelemetry} />);
    expect(screen.getByText("max")).toBeInTheDocument();
  });

  it('displays "max" for missing reasoning effort', () => {
    render(<ContextIndicator tokenTelemetry={{ ...baseTelemetry, reasoningEffort: "" }} />);
    expect(screen.getByText("max")).toBeInTheDocument();
  });

  it("displays active tokens formatted", () => {
    render(<ContextIndicator tokenTelemetry={baseTelemetry} />);
    // Should render a span with textContent that includes "50,000"
    const tokenSpans = screen.getAllByText(/50,000/);
    expect(tokenSpans.length).toBeGreaterThan(0);
  });

  it("shows session usage separator when usage data exists", () => {
    render(<ContextIndicator tokenTelemetry={baseTelemetry} />);
    expect(screen.getByTestId("separator")).toBeInTheDocument();
  });

  it("does not show separator when no usage data", () => {
    render(<ContextIndicator tokenTelemetry={{ ...baseTelemetry, usage: null }} />);
    expect(screen.queryByTestId("separator")).not.toBeInTheDocument();
  });

  it('displays "Context Window" title in hover card', () => {
    render(<ContextIndicator tokenTelemetry={baseTelemetry} />);
    expect(screen.getByText("Context Window")).toBeInTheDocument();
  });

  it("renders usage percentage in hover card label", () => {
    render(<ContextIndicator tokenTelemetry={baseTelemetry} />);
    // getTokenUsagePercent mock returns (50000/200000)*100 = 25
    expect(screen.getByText("25%")).toBeInTheDocument();
  });

  it("renders a progress bar for usage", () => {
    render(<ContextIndicator tokenTelemetry={baseTelemetry} />);
    expect(screen.getByTestId("progress-bar")).toBeInTheDocument();
  });
});
