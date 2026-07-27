/**
 * Unit tests for SearchDialog component
 *
 * Tests cover:
 * - Rendering command dialog when open
 * - Not rendering when closed
 * - Filtering visible messages only
 * - Role icons and labels
 * - Message selection callback
 * - Empty state
 * - Time formatting
 */

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import SearchDialog from "./SearchDialog";
import type { SessionMessage } from "@/webview/types";

vi.mock("./ui/command", () => ({
  Command: vi.fn(({ children }: { children: React.ReactNode }) => <div data-testid="command">{children}</div>),
  CommandDialog: vi.fn(
    ({
      children,
      open,
    }: {
      children: React.ReactNode;
      open: boolean;
      onOpenChange: (open: boolean) => void;
      title: string;
    }) => (open ? <div data-testid="command-dialog">{children}</div> : null)
  ),
  CommandEmpty: vi.fn(({ children }: { children: React.ReactNode }) => (
    <div data-testid="command-empty">{children}</div>
  )),
  CommandGroup: vi.fn(({ children, heading }: { children: React.ReactNode; heading: string }) => (
    <div data-testid="command-group" data-heading={heading}>
      {children}
    </div>
  )),
  CommandInput: vi.fn(({ placeholder }: { placeholder: string; className?: string }) => (
    <input data-testid="command-input" placeholder={placeholder} />
  )),
  CommandItem: vi.fn(({ children, onSelect }: { children: React.ReactNode; onSelect: () => void }) => (
    <div data-testid="command-item" onClick={() => onSelect()}>
      {children}
    </div>
  )),
  CommandList: vi.fn(({ children }: { children: React.ReactNode }) => <div data-testid="command-list">{children}</div>),
  CommandShortcut: vi.fn(({ children }: { children: React.ReactNode }) => (
    <span data-testid="command-shortcut">{children}</span>
  )),
}));

vi.mock("lucide-react", () => ({
  User: vi.fn(() => <span data-testid="icon-user" />),
  Bot: vi.fn(() => <span data-testid="icon-bot" />),
  Wrench: vi.fn(() => <span data-testid="icon-wrench" />),
  Info: vi.fn(() => <span data-testid="icon-info" />),
}));

const mockMessages: SessionMessage[] = [
  {
    id: "msg-1",
    sessionId: "s1",
    role: "user",
    content: "How do I fix this bug?",
    visible: true,
    createTime: "2024-01-01T10:00:00Z",
    updateTime: "2024-01-01T10:00:00Z",
  },
  {
    id: "msg-2",
    sessionId: "s1",
    role: "assistant",
    content: "Let me help with that bug.",
    visible: true,
    createTime: "2024-01-01T10:01:00Z",
    updateTime: "2024-01-01T10:01:00Z",
  },
  {
    id: "msg-3",
    sessionId: "s1",
    role: "tool",
    content: "",
    visible: true,
    createTime: "2024-01-01T10:02:00Z",
    updateTime: "2024-01-01T10:02:00Z",
  },
  {
    id: "msg-4",
    sessionId: "s1",
    role: "system",
    content: "System notification",
    visible: false,
    createTime: "2024-01-01T10:03:00Z",
    updateTime: "2024-01-01T10:03:00Z",
  },
];

describe("SearchDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing when closed", () => {
    render(<SearchDialog open={false} onOpenChange={vi.fn()} messages={[]} onSelectMessage={vi.fn()} />);
    expect(screen.queryByTestId("command-dialog")).not.toBeInTheDocument();
  });

  it("renders command dialog when open", () => {
    render(<SearchDialog open={true} onOpenChange={vi.fn()} messages={mockMessages} onSelectMessage={vi.fn()} />);
    expect(screen.getByTestId("command-dialog")).toBeInTheDocument();
  });

  it("renders command input with placeholder", () => {
    render(<SearchDialog open={true} onOpenChange={vi.fn()} messages={mockMessages} onSelectMessage={vi.fn()} />);
    expect(screen.getByPlaceholderText("Search messages...")).toBeInTheDocument();
  });

  it("renders empty state when no messages", () => {
    render(<SearchDialog open={true} onOpenChange={vi.fn()} messages={[]} onSelectMessage={vi.fn()} />);
    expect(screen.getByText("No messages found.")).toBeInTheDocument();
  });

  it("filters out invisible messages", () => {
    render(<SearchDialog open={true} onOpenChange={vi.fn()} messages={mockMessages} onSelectMessage={vi.fn()} />);
    // msg-4 (system, visible=false) should not appear
    // msg-3 (tool, empty content) should not appear
    // Only msg-1 (user) and msg-2 (assistant) should show
    const items = screen.getAllByTestId("command-item");
    expect(items).toHaveLength(2);
  });

  it("displays role labels", () => {
    render(<SearchDialog open={true} onOpenChange={vi.fn()} messages={mockMessages} onSelectMessage={vi.fn()} />);
    expect(screen.getByText("You")).toBeInTheDocument();
    expect(screen.getByText("Assistant")).toBeInTheDocument();
  });

  it("displays message previews", () => {
    render(<SearchDialog open={true} onOpenChange={vi.fn()} messages={mockMessages} onSelectMessage={vi.fn()} />);
    expect(screen.getByText("How do I fix this bug?")).toBeInTheDocument();
    expect(screen.getByText("Let me help with that bug.")).toBeInTheDocument();
  });

  it("renders shortcuts with message index numbering", () => {
    render(<SearchDialog open={true} onOpenChange={vi.fn()} messages={mockMessages} onSelectMessage={vi.fn()} />);
    const shortcuts = screen.getAllByTestId("command-shortcut");
    // msg-1 (index 0, user) -> #1, msg-2 (index 1, assistant) -> #2
    expect(shortcuts[0].textContent).toBe("#1");
    expect(shortcuts[1].textContent).toBe("#2");
  });

  it("calls onSelectMessage and closes dialog on selection", () => {
    const onSelectMessage = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <SearchDialog open={true} onOpenChange={onOpenChange} messages={mockMessages} onSelectMessage={onSelectMessage} />
    );
    const items = screen.getAllByTestId("command-item");
    fireEvent.click(items[0]);
    expect(onSelectMessage).toHaveBeenCalledWith("msg-1");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("renders role icons", () => {
    render(<SearchDialog open={true} onOpenChange={vi.fn()} messages={mockMessages} onSelectMessage={vi.fn()} />);
    // Should have user and bot icons
    expect(screen.getByTestId("icon-user")).toBeInTheDocument();
    expect(screen.getByTestId("icon-bot")).toBeInTheDocument();
  });

  it("handles messages group heading", () => {
    render(<SearchDialog open={true} onOpenChange={vi.fn()} messages={mockMessages} onSelectMessage={vi.fn()} />);
    const group = screen.getByTestId("command-group");
    expect(group.getAttribute("data-heading")).toBe("Messages");
  });
});
