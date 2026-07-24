/**
 * Unit tests for SkillsPanel component
 *
 * Tests cover:
 * - Disabled button when no skills available
 * - Enabled button when skills available
 * - Popover content rendering
 * - Skill selection and toggling
 * - Marking loaded/selected skills as checked
 * - Size prop for positioning
 */

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import SkillsPanel from "./SkillsPanel";
import type { SkillInfo } from "@/webview/types";

vi.mock("./ui/input-group", () => ({
  InputGroupButton: vi.fn(
    ({
      children,
      disabled,
      onClick,
      ...props
    }: {
      children: React.ReactNode;
      disabled?: boolean;
      onClick?: () => void;
    }) => (
      <button data-testid="skills-trigger" disabled={disabled} onClick={onClick} {...props}>
        {children}
      </button>
    )
  ),
}));

vi.mock("./ui/command", () => ({
  Command: vi.fn(({ children, ...props }: { children: React.ReactNode }) => (
    <div data-testid="command" {...props}>
      {children}
    </div>
  )),
  CommandEmpty: vi.fn(({ children }: { children: React.ReactNode }) => (
    <div data-testid="command-empty">{children}</div>
  )),
  CommandGroup: vi.fn(({ children, heading }: { children: React.ReactNode; heading: string }) => (
    <div data-testid="command-group" data-heading={heading}>
      {children}
    </div>
  )),
  CommandItem: vi.fn(
    ({
      children,
      onSelect,
      ...props
    }: {
      children: React.ReactNode;
      onSelect?: () => void;
      [key: string]: unknown;
    }) => (
      <div data-testid="command-item" onClick={() => onSelect?.()} {...props}>
        {children}
      </div>
    )
  ),
  CommandList: vi.fn(({ children }: { children: React.ReactNode }) => <div data-testid="command-list">{children}</div>),
  CommandShortcut: vi.fn(({ children }: { children: React.ReactNode }) => (
    <span data-testid="command-shortcut">{children}</span>
  )),
}));

vi.mock("./ui/popover", () => ({
  PopoverTrigger: vi.fn(({ children, asChild: _asChild }: { children: React.ReactNode; asChild?: boolean }) => (
    <>{children}</>
  )),
  PopoverContent: vi.fn(
    ({
      children,
      className: _className,
      style,
      sideOffset,
      alignOffset,
      side,
      align,
    }: {
      children: React.ReactNode;
      className?: string;
      style?: React.CSSProperties;
      sideOffset?: number;
      alignOffset?: number;
      side?: string;
      align?: string;
    }) => (
      <div
        data-testid="popover-content"
        style={style}
        data-side-offset={sideOffset}
        data-align-offset={alignOffset}
        data-side={side}
        data-align={align}
      >
        {children}
      </div>
    )
  ),
}));

vi.mock("lucide-react", () => ({
  GraduationCap: vi.fn(() => <span data-testid="grad-cap-icon" />),
  Terminal: vi.fn(() => <span data-testid="terminal-icon" />),
  ChevronRight: vi.fn(() => <span data-testid="chevron-right-icon" />),
  FileQuestionMark: vi.fn(() => <span data-testid="file-question-icon" />),
}));

vi.mock("@/webview/lib/utils", () => ({
  cn: vi.fn((...inputs: unknown[]) => inputs.filter(Boolean).join(" ")),
}));

vi.mock("@/webview/services", () => ({
  chatService: {
    openExternal: vi.fn(),
  },
}));

vi.mock("@/webview/constants", () => ({
  DEEPCODE_DOCS_URL: "https://docs.example.com",
}));

vi.mock("@/webview/utils", () => ({
  toTitleCase: vi.fn((s: string) =>
    s
      .split(/[-_]/)
      .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ")
  ),
}));

const mockSkills: SkillInfo[] = [
  { name: "code-review", description: "Review code", path: "/skills/cr", isLoaded: false },
  { name: "test-gen", description: "Generate tests", path: "/skills/tg", isLoaded: true },
  { name: "refactor", description: "Refactor code", path: "/skills/ref", isLoaded: false },
];

describe("SkillsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders disabled button when no skills available", () => {
    render(<SkillsPanel availableSkills={[]} selectedSkills={[]} onToggle={vi.fn()} />);
    const trigger = screen.getByTestId("skills-trigger");
    expect(trigger).toBeDisabled();
    expect(screen.getByText("Skills")).toBeInTheDocument();
    expect(screen.getByTestId("grad-cap-icon")).toBeInTheDocument();
  });

  it("renders enabled button when skills available", () => {
    render(<SkillsPanel availableSkills={mockSkills} selectedSkills={[]} onToggle={vi.fn()} />);
    const trigger = screen.getByTestId("skills-trigger");
    expect(trigger).not.toBeDisabled();
    expect(screen.getByText("Skills")).toBeInTheDocument();
  });

  it("renders PopoverContent when skills available", () => {
    render(<SkillsPanel availableSkills={mockSkills} selectedSkills={[]} onToggle={vi.fn()} />);
    expect(screen.getByTestId("popover-content")).toBeInTheDocument();
  });

  it("does not render PopoverContent when no skills available", () => {
    render(<SkillsPanel availableSkills={[]} selectedSkills={[]} onToggle={vi.fn()} />);
    expect(screen.queryByTestId("popover-content")).not.toBeInTheDocument();
  });

  it("renders all available skills in command group", () => {
    render(<SkillsPanel availableSkills={mockSkills} selectedSkills={[]} onToggle={vi.fn()} />);

    const items = screen.getAllByTestId("command-item");
    // 3 skills + 1 "View help docs" support item = 4
    expect(items).toHaveLength(4);
  });

  it("displays skill names in title case", () => {
    render(<SkillsPanel availableSkills={mockSkills} selectedSkills={[]} onToggle={vi.fn()} />);

    expect(screen.getByText("Code Review")).toBeInTheDocument();
    expect(screen.getByText("Test Gen")).toBeInTheDocument();
    expect(screen.getByText("Refactor")).toBeInTheDocument();
  });

  it("marks loaded skills as checked", () => {
    render(<SkillsPanel availableSkills={mockSkills} selectedSkills={[]} onToggle={vi.fn()} />);

    const items = screen.getAllByTestId("command-item");
    // test-gen is loaded (index 1)
    expect(items[1].getAttribute("data-checked")).toBe("true");
    // code-review is not loaded (index 0)
    expect(items[0].getAttribute("data-checked")).toBe("false");
  });

  it("marks selected skills as checked", () => {
    render(
      <SkillsPanel
        availableSkills={mockSkills}
        selectedSkills={[mockSkills[0]]} // code-review is selected
        onToggle={vi.fn()}
      />
    );

    const items = screen.getAllByTestId("command-item");
    // code-review is selected (index 0)
    expect(items[0].getAttribute("data-checked")).toBe("true");
  });

  it("calls onToggle when a skill is selected", () => {
    const onToggle = vi.fn();
    render(<SkillsPanel availableSkills={mockSkills} selectedSkills={[]} onToggle={onToggle} />);

    fireEvent.click(screen.getAllByTestId("command-item")[0]);
    expect(onToggle).toHaveBeenCalledWith(mockSkills[0]);
  });

  it("renders empty state when search query has no matches", () => {
    render(
      <SkillsPanel availableSkills={mockSkills} selectedSkills={[]} onToggle={vi.fn()} searchQuery="nonexistent" />
    );

    expect(screen.getByTestId("command-empty")).toBeInTheDocument();
    expect(screen.getByText("No results found.")).toBeInTheDocument();
  });

  it("applies size prop to PopoverContent for positioning", () => {
    const size = { width: 400, height: 60 };
    render(<SkillsPanel availableSkills={mockSkills} selectedSkills={[]} onToggle={vi.fn()} size={size} />);

    const popover = screen.getByTestId("popover-content");
    expect(popover.style.width).toBe(`${400 - 32}px`);
    expect(popover.getAttribute("data-side-offset")).toBe("10");
  });

  it("uses default values when size prop is not provided", () => {
    render(<SkillsPanel availableSkills={mockSkills} selectedSkills={[]} onToggle={vi.fn()} />);

    const popover = screen.getByTestId("popover-content");
    // When size is undefined, width is (0 - 32) = -32, which becomes an empty style string
    expect(popover.style.width).toBe("");
    expect(popover.getAttribute("data-side-offset")).toBe("50");
  });
});
