/**
 * Unit tests for Header component
 *
 * Tests cover:
 * - Displaying session summary
 * - "New Conversation" when no active session
 * - Search button visibility conditions
 * - Rendering SessionList
 * - Delegating callbacks
 */

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import Header from "./Header";
import type { SessionSummary } from "@/webview/types";

// Mock the image import
vi.mock("../../../assets/deepcoding_icon.png", () => ({
  default: "data:image/png;base64,mockicon",
}));

vi.mock("./SessionList", () => ({
  default: vi.fn(
    ({
      sessions,
      open,
      onOpenChange,
      onSelect,
    }: {
      sessions: SessionSummary[];
      open: boolean;
      onOpenChange: (open: boolean) => void;
      onSelect: (id: string) => void;
    }) => (
      <div data-testid="session-list" data-open={open} data-count={sessions.length}>
        <button data-testid="session-list-select" onClick={() => onSelect?.(sessions[0]?.id)} />
        <button data-testid="session-list-toggle" onClick={() => onOpenChange(!open)} />
      </div>
    )
  ),
}));

vi.mock("./ui/button", () => ({
  Button: vi.fn(({ children, onClick, ...props }: { children: React.ReactNode; onClick?: () => void }) => (
    <button data-testid="ui-button" onClick={onClick} {...props}>
      {children}
    </button>
  )),
}));

vi.mock("./ui/tooltip", () => ({
  Tooltip: vi.fn(({ children }: { children: React.ReactNode }) => <div data-testid="tooltip">{children}</div>),
  TooltipContent: vi.fn(({ children }: { children: React.ReactNode }) => (
    <div data-testid="tooltip-content">{children}</div>
  )),
  TooltipTrigger: vi.fn(({ children }: { children: React.ReactNode }) => (
    <div data-testid="tooltip-trigger">{children}</div>
  )),
}));

vi.mock("lucide-react", () => ({
  Search: vi.fn(() => <span data-testid="search-icon" />),
}));

const sessions: SessionSummary[] = [
  {
    id: "session-1",
    summary: "Build a REST API",
    createTime: "2024-01-01",
    updateTime: "2024-01-02",
    status: "active",
  },
  { id: "session-2", summary: "Fix CSS bugs", createTime: "2024-01-03", updateTime: "2024-01-04", status: "idle" },
];

const defaultProps = {
  sessions,
  activeSessionId: "session-1" as string | null,
  onSelectSession: vi.fn(),
  onCreateNewSession: vi.fn(),
  onRenameSession: vi.fn(),
  onDeleteSession: vi.fn(),
  sessionListOpen: false,
  onToggleSessionList: vi.fn(),
  hasMessages: true,
  onToggleSearchPanel: vi.fn(),
};

describe("Header", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the active session summary", () => {
    render(<Header {...defaultProps} />);
    expect(screen.getByText("Build a REST API")).toBeInTheDocument();
  });

  it('shows "New Conversation" when no active session', () => {
    render(<Header {...defaultProps} activeSessionId={null} />);
    expect(screen.getByText("New Conversation")).toBeInTheDocument();
  });

  it('shows "Deep Code" when activeSessionId but no matching session', () => {
    render(<Header {...defaultProps} activeSessionId="non-existent" />);
    expect(screen.getByText("Deep Code")).toBeInTheDocument();
  });

  it("renders the logo image", () => {
    render(<Header {...defaultProps} />);
    const img = screen.getByAltText("");
    expect(img).toBeInTheDocument();
    expect(img.tagName).toBe("IMG");
  });

  it("shows search button when active session exists and has messages", () => {
    render(<Header {...defaultProps} activeSessionId="session-1" hasMessages={true} />);
    expect(screen.getByTestId("search-icon")).toBeInTheDocument();
  });

  it("does not show search button when no active session", () => {
    render(<Header {...defaultProps} activeSessionId={null} />);
    expect(screen.queryByTestId("search-icon")).not.toBeInTheDocument();
  });

  it("does not show search button when no messages", () => {
    render(<Header {...defaultProps} activeSessionId="session-1" hasMessages={false} />);
    expect(screen.queryByTestId("search-icon")).not.toBeInTheDocument();
  });

  it("calls onToggleSearchPanel when search button clicked", () => {
    render(<Header {...defaultProps} />);
    const searchButtons = screen.getAllByTestId("ui-button");
    // The search button is one of the ui-buttons
    const searchBtn = searchButtons.find((btn) => btn.querySelector('[data-testid="search-icon"]'));
    if (searchBtn) {
      fireEvent.click(searchBtn);
      expect(defaultProps.onToggleSearchPanel).toHaveBeenCalledWith(true);
    }
  });

  it("renders SessionList component", () => {
    render(<Header {...defaultProps} />);
    expect(screen.getByTestId("session-list")).toBeInTheDocument();
  });

  it("passes sessions to SessionList", () => {
    render(<Header {...defaultProps} sessions={sessions} />);
    const sessionList = screen.getByTestId("session-list");
    expect(sessionList.getAttribute("data-count")).toBe("2");
  });

  it("passes open state to SessionList", () => {
    render(<Header {...defaultProps} sessionListOpen={true} />);
    const sessionList = screen.getByTestId("session-list");
    expect(sessionList.getAttribute("data-open")).toBe("true");
  });

  it("calls onSelectSession when SessionList selects a session", () => {
    render(<Header {...defaultProps} />);
    fireEvent.click(screen.getByTestId("session-list-select"));
    expect(defaultProps.onSelectSession).toHaveBeenCalledWith("session-1");
  });

  it("calls onToggleSessionList when SessionList toggles", () => {
    render(<Header {...defaultProps} />);
    fireEvent.click(screen.getByTestId("session-list-toggle"));
    expect(defaultProps.onToggleSessionList).toHaveBeenCalled();
  });
});
