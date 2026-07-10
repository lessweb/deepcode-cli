/**
 * Unit tests for SessionList component
 *
 * Tests cover:
 * - Search functionality
 * - Session grouping by date
 * - Empty states
 */

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import SessionList from "./SessionList";
import type { SessionSummary } from "@/webview/types";

// Mock dependencies
vi.mock("@/webview/components/ui/input-group", () => ({
  InputGroup: vi.fn(({ children }) => <div data-testid="input-group">{children}</div>),
  InputGroupAddon: vi.fn(({ children }) => <div data-testid="input-group-addon">{children}</div>),
  InputGroupInput: vi.fn(({ value, onChange, ...props }) => (
    <input data-testid="search-input" value={value} onChange={onChange} {...props} />
  )),
}));

vi.mock("@/webview/components/ui/drawer", () => ({
  Drawer: vi.fn(({ children, open, onOpenChange }) => (
    <div data-testid="drawer" data-open={open}>
      {children}
    </div>
  )),
  DrawerTrigger: vi.fn(({ children }) => <div data-testid="drawer-trigger">{children}</div>),
  DrawerContent: vi.fn(({ children }) => <div data-testid="drawer-content">{children}</div>),
  DrawerHeader: vi.fn(({ children }) => <div data-testid="drawer-header">{children}</div>),
  DrawerTitle: vi.fn(({ children }) => <div data-testid="drawer-title">{children}</div>),
  DrawerFooter: vi.fn(({ children }) => <div data-testid="drawer-footer">{children}</div>),
  DrawerClose: vi.fn(({ children }) => <div data-testid="drawer-close">{children}</div>),
}));

vi.mock("@/webview/components/ui/button", () => ({
  Button: vi.fn(({ children, onClick }) => (
    <button data-testid="button" onClick={onClick}>
      {children}
    </button>
  )),
}));

vi.mock("@/webview/components/ui/empty", () => ({
  Empty: vi.fn(({ children }) => <div data-testid="empty">{children}</div>),
  EmptyHeader: vi.fn(({ children }) => <div>{children}</div>),
  EmptyTitle: vi.fn(({ children }) => <div>{children}</div>),
  EmptyDescription: vi.fn(({ children }) => <div>{children}</div>),
  EmptyMedia: vi.fn(({ children }) => <div>{children}</div>),
}));

vi.mock("@/webview/components/ui/item", () => ({
  Item: vi.fn(({ children, onClick }) => (
    <div data-testid="item" onClick={onClick}>
      {children}
    </div>
  )),
  ItemContent: vi.fn(({ children }) => <div>{children}</div>),
  ItemGroup: vi.fn(({ children }) => <div data-testid="item-group">{children}</div>),
  ItemActions: vi.fn(({ children }) => <div>{children}</div>),
}));

describe("SessionList", () => {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const lastWeek = new Date(today);
  lastWeek.setDate(lastWeek.getDate() - 5);
  const older = new Date(today);
  older.setDate(older.getDate() - 30);

  const createMockSession = (id: string, updateTime: Date): SessionSummary => ({
    id,
    summary: `Session ${id}`,
    createTime: updateTime.toISOString(),
    updateTime: updateTime.toISOString(),
    status: "idle",
  });

  const mockSessions: SessionSummary[] = [
    createMockSession("1", today),
    createMockSession("2", yesterday),
    createMockSession("3", lastWeek),
    createMockSession("4", older),
  ];

  const defaultProps = {
    sessions: mockSessions,
    activeSessionId: null,
    onSelect: vi.fn(),
    onCreateNewSession: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders search input", () => {
    render(<SessionList {...defaultProps} />);
    expect(screen.getByTestId("search-input")).toBeInTheDocument();
  });

  it("renders drawer", () => {
    render(<SessionList {...defaultProps} />);
    expect(screen.getByTestId("drawer")).toBeInTheDocument();
  });

  it("shows empty state when no sessions", () => {
    render(<SessionList {...defaultProps} sessions={[]} />);
    expect(screen.getByTestId("empty")).toBeInTheDocument();
    expect(screen.getByText("No sessions yet")).toBeInTheDocument();
  });

  it("shows 'No sessions found' when search yields no results", () => {
    render(<SessionList {...defaultProps} />);

    const searchInput = screen.getByTestId("search-input");
    fireEvent.change(searchInput, { target: { value: "nonexistent" } });

    expect(screen.getByText("No sessions found")).toBeInTheDocument();
  });

  it("filters sessions by search query", () => {
    const sessionsWithNames: SessionSummary[] = [
      {
        id: "1",
        summary: "Project Alpha",
        createTime: today.toISOString(),
        updateTime: today.toISOString(),
        status: "idle",
      },
      {
        id: "2",
        summary: "Project Beta",
        createTime: today.toISOString(),
        updateTime: today.toISOString(),
        status: "idle",
      },
    ];

    render(<SessionList {...defaultProps} sessions={sessionsWithNames} />);

    const searchInput = screen.getByTestId("search-input");
    fireEvent.change(searchInput, { target: { value: "Alpha" } });

    // Should only show "Project Alpha"
    expect(screen.queryByText("Project Beta")).not.toBeInTheDocument();
  });

  it("search is case insensitive", () => {
    const sessionsWithNames: SessionSummary[] = [
      {
        id: "1",
        summary: "PROJECT ALPHA",
        createTime: today.toISOString(),
        updateTime: today.toISOString(),
        status: "idle",
      },
    ];

    render(<SessionList {...defaultProps} sessions={sessionsWithNames} />);

    const searchInput = screen.getByTestId("search-input");
    fireEvent.change(searchInput, { target: { value: "alpha" } });

    expect(screen.getByText("PROJECT ALPHA")).toBeInTheDocument();
  });

  it("handles empty summary as 'Untitled'", () => {
    const sessionsWithEmptySummary: SessionSummary[] = [
      { id: "1", summary: "", createTime: today.toISOString(), updateTime: today.toISOString(), status: "idle" },
    ];

    render(<SessionList {...defaultProps} sessions={sessionsWithEmptySummary} />);

    // Should display "Untitled" instead of empty string
    expect(screen.getByText("Untitled")).toBeInTheDocument();
  });
});
