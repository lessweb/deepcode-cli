/**
 * Unit tests for Messages component
 *
 * Tests cover:
 * - Rendering different message types
 * - Auto-scroll behavior
 * - Message role-based rendering
 */

import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import Messages from "./Messages";
import type { SessionMessage } from "@/webview/types";

// Mock dependencies
vi.mock("@/webview/components/ui/scroll-area", () => ({
  ScrollArea: vi.fn(({ children }) => <div data-testid="scroll-area">{children}</div>),
  ScrollBar: vi.fn(() => <div data-testid="scroll-bar" />),
}));

vi.mock("@/webview/components/bubbles/UserBubble", () => ({
  default: vi.fn(({ content }) => <div data-testid="user-bubble">{content}</div>),
}));

vi.mock("@/webview/components/bubbles/AssistantBubble", () => ({
  default: vi.fn(({ content }) => <div data-testid="assistant-bubble">{content}</div>),
}));

vi.mock("@/webview/components/bubbles/ThinkingBubble", () => ({
  default: vi.fn(({ content }) => <div data-testid="thinking-bubble">{content}</div>),
}));

vi.mock("@/webview/components/bubbles/ToolBubble", () => ({
  default: vi.fn(({ content }) => <div data-testid="tool-bubble">{content}</div>),
}));

vi.mock("@/webview/components/bubbles/SystemBubble", () => ({
  default: vi.fn(({ content }) => <div data-testid="system-bubble">{content}</div>),
}));

// Mock scrollIntoView
Element.prototype.scrollIntoView = vi.fn();

describe("Messages", () => {
  const defaultProps = {
    messages: [] as SessionMessage[],
    loading: false,
    llmStreamProgress: null,
    processes: null,
  };

  it("renders empty messages", () => {
    render(<Messages {...defaultProps} />);
    expect(screen.getByTestId("scroll-area")).toBeInTheDocument();
  });

  it("renders user message", () => {
    const messages: SessionMessage[] = [{ role: "user", content: "Hello" }];
    render(<Messages {...defaultProps} messages={messages} />);
    expect(screen.getByTestId("user-bubble")).toHaveTextContent("Hello");
  });

  it("renders assistant message", () => {
    const messages: SessionMessage[] = [{ role: "assistant", content: "Hi there!" }];
    render(<Messages {...defaultProps} messages={messages} />);
    expect(screen.getByTestId("assistant-bubble")).toHaveTextContent("Hi there!");
  });

  it("renders thinking bubble when asThinking is true", () => {
    const messages: SessionMessage[] = [{ role: "assistant", content: "Thinking...", meta: { asThinking: true } }];
    render(<Messages {...defaultProps} messages={messages} />);
    expect(screen.getByTestId("thinking-bubble")).toBeInTheDocument();
  });

  it("renders tool message", () => {
    const messages: SessionMessage[] = [
      { role: "tool", content: "Tool output", meta: { function: { name: "readFile" } } },
    ];
    render(<Messages {...defaultProps} messages={messages} />);
    expect(screen.getByTestId("tool-bubble")).toHaveTextContent("Tool output");
  });

  it("renders system message", () => {
    const messages: SessionMessage[] = [{ role: "system", content: "System info" }];
    render(<Messages {...defaultProps} messages={messages} />);
    expect(screen.getByTestId("system-bubble")).toBeInTheDocument();
  });

  it("renders multiple messages of different types", () => {
    const messages: SessionMessage[] = [
      { role: "user", content: "Question" },
      { role: "assistant", content: "Answer" },
      { role: "tool", content: "Result" },
    ];
    render(<Messages {...defaultProps} messages={messages} />);
    expect(screen.getAllByTestId(/bubble/)).toHaveLength(3);
  });

  it("renders message with html content", () => {
    const messages: SessionMessage[] = [{ role: "assistant", content: "Text" }];
    render(<Messages {...defaultProps} messages={messages} />);
    expect(screen.getByTestId("assistant-bubble")).toHaveTextContent("Text");
  });
});
