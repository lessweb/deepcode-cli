/**
 * Unit tests for Suggestion component
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
import Suggestion from "./Suggestion";
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

vi.mock("./ui/switch", () => ({
  Switch: vi.fn(
    ({
      checked,
      onCheckedChange,
      id,
      size: _size,
    }: {
      checked?: boolean;
      onCheckedChange?: (checked: boolean) => void;
      id?: string;
      size?: string;
    }) => (
      <input
        data-testid="thinking-switch"
        type="checkbox"
        id={id}
        checked={checked}
        onChange={(e) => onCheckedChange?.(e.target.checked)}
      />
    )
  ),
}));

vi.mock("./ui/segmented", () => ({
  Segmented: vi.fn(
    ({
      children,
      value,
      onValueChange,
    }: {
      children: React.ReactNode;
      value?: string;
      onValueChange?: (value: string) => void;
    }) => (
      <div data-testid="segmented" data-value={value}>
        {React.Children.map(children, (child) => {
          if (React.isValidElement(child)) {
            return React.cloneElement(child as React.ReactElement<any>, {
              _onChange: onValueChange,
              _selectedValue: value,
            });
          }
          return child;
        })}
      </div>
    )
  ),
  SegmentedItem: vi.fn(
    ({
      children,
      value: itemValue,
      _onChange,
      _selectedValue,
    }: {
      children: React.ReactNode;
      value: string;
      _onChange?: (value: string) => void;
      _selectedValue?: string;
    }) => (
      <button
        data-testid="segmented-item"
        data-value={itemValue}
        data-state={_selectedValue === itemValue ? "checked" : "unchecked"}
        onClick={() => _onChange?.(itemValue)}
      >
        {children}
      </button>
    )
  ),
}));

vi.mock("./ui/dropdown-menu", () => ({
  DropdownMenu: vi.fn(({ children }: { children: React.ReactNode }) => (
    <div data-testid="dropdown-menu">{children}</div>
  )),
  DropdownMenuContent: vi.fn(({ children }: { children: React.ReactNode }) => (
    <div data-testid="dropdown-menu-content">{children}</div>
  )),
  DropdownMenuGroup: vi.fn(({ children }: { children: React.ReactNode }) => (
    <div data-testid="dropdown-menu-group">{children}</div>
  )),
  DropdownMenuLabel: vi.fn(({ children }: { children: React.ReactNode }) => (
    <div data-testid="dropdown-menu-label">{children}</div>
  )),
  DropdownMenuRadioGroup: vi.fn(
    ({
      children,
      value,
      onValueChange,
    }: {
      children: React.ReactNode;
      value?: string;
      onValueChange?: (value: string) => void;
    }) => (
      <div data-testid="dropdown-menu-radio-group" data-value={value}>
        {React.Children.map(children, (child) => {
          if (React.isValidElement(child)) {
            return React.cloneElement(child as React.ReactElement<any>, {
              _onChange: onValueChange,
              _groupValue: value,
            });
          }
          return child;
        })}
      </div>
    )
  ),
  DropdownMenuRadioItem: vi.fn(
    ({
      children,
      value: itemValue,
      _onChange,
    }: {
      children: React.ReactNode;
      value: string;
      _onChange?: (value: string) => void;
      _groupValue?: string;
    }) => (
      <button data-testid="dropdown-menu-radio-item" data-value={itemValue} onClick={() => _onChange?.(itemValue)}>
        {children}
      </button>
    )
  ),
  DropdownMenuTrigger: vi.fn(({ children }: { children: React.ReactNode }) => (
    <span data-testid="dropdown-menu-trigger">{children}</span>
  )),
}));

vi.mock("./ui/item", () => ({
  Item: vi.fn(({ children }: { children: React.ReactNode; size?: string }) => <div data-testid="item">{children}</div>),
  ItemContent: vi.fn(({ children }: { children: React.ReactNode }) => <div data-testid="item-content">{children}</div>),
  ItemTitle: vi.fn(({ children }: { children: React.ReactNode; className?: string }) => (
    <div data-testid="item-title">{children}</div>
  )),
  ItemDescription: vi.fn(({ children }: { children: React.ReactNode; className?: string }) => (
    <div data-testid="item-description">{children}</div>
  )),
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
  Brain: vi.fn(() => <span data-testid="brain-icon" />),
  ChevronRight: vi.fn(() => <span data-testid="chevron-right-icon" />),
  FileQuestionMark: vi.fn(() => <span data-testid="file-question-icon" />),
  GraduationCap: vi.fn(() => <span data-testid="grad-cap-icon" />),
  Settings2: vi.fn(() => <span data-testid="settings-icon" />),
  SlidersHorizontal: vi.fn(() => <span data-testid="sliders-icon" />),
  SquareSlash: vi.fn(() => <span data-testid="square-slash-icon" />),
  Terminal: vi.fn(() => <span data-testid="terminal-icon" />),
}));

vi.mock("@/webview/lib/utils", () => ({
  cn: vi.fn((...inputs: unknown[]) => inputs.filter(Boolean).join(" ")),
}));

vi.mock("@/webview/services", () => ({
  chatService: {
    openExternal: vi.fn(),
    updateModelConfig: vi.fn().mockResolvedValue({ ok: true, changed: true, tokenTelemetry: null }),
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

describe("Suggestion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders trigger button when no skills available", () => {
    render(<Suggestion availableSkills={[]} selectedSkills={[]} onToggle={vi.fn()} />);
    const trigger = screen.getByTestId("skills-trigger");
    expect(trigger).toBeInTheDocument();
    expect(screen.getByTestId("square-slash-icon")).toBeInTheDocument();
  });

  it("renders trigger button when skills available", () => {
    render(<Suggestion availableSkills={mockSkills} selectedSkills={[]} onToggle={vi.fn()} />);
    const trigger = screen.getByTestId("skills-trigger");
    expect(trigger).not.toBeDisabled();
    expect(screen.getByTestId("square-slash-icon")).toBeInTheDocument();
  });

  it("renders PopoverContent when skills available", () => {
    render(<Suggestion availableSkills={mockSkills} selectedSkills={[]} onToggle={vi.fn()} />);
    expect(screen.getByTestId("popover-content")).toBeInTheDocument();
  });

  it("renders PopoverContent even when no skills available (model section always shown)", () => {
    render(<Suggestion availableSkills={[]} selectedSkills={[]} onToggle={vi.fn()} />);
    expect(screen.getByTestId("popover-content")).toBeInTheDocument();
  });

  it("renders all available skills in command group", () => {
    render(<Suggestion availableSkills={mockSkills} selectedSkills={[]} onToggle={vi.fn()} />);

    const items = screen.getAllByTestId("command-item");
    // 3 model config + 3 skills + 1 "View help docs" support item = 7
    expect(items).toHaveLength(7);
  });

  it("displays skill names in title case", () => {
    render(<Suggestion availableSkills={mockSkills} selectedSkills={[]} onToggle={vi.fn()} />);

    expect(screen.getByText("Code Review")).toBeInTheDocument();
    expect(screen.getByText("Test Gen")).toBeInTheDocument();
    expect(screen.getByText("Refactor")).toBeInTheDocument();
  });

  it("marks loaded skills as checked", () => {
    render(<Suggestion availableSkills={mockSkills} selectedSkills={[]} onToggle={vi.fn()} />);

    const items = screen.getAllByTestId("command-item");
    // With 3 model config items before skills:
    // index 3 = code-review (not loaded), index 4 = test-gen (loaded)
    expect(items[4].getAttribute("data-checked")).toBe("true");
    expect(items[3].getAttribute("data-checked")).toBe("false");
  });

  it("marks selected skills as checked", () => {
    render(
      <Suggestion
        availableSkills={mockSkills}
        selectedSkills={[mockSkills[0]]} // code-review is selected
        onToggle={vi.fn()}
      />
    );

    const items = screen.getAllByTestId("command-item");
    // code-review is at index 3 (after 3 model config items)
    expect(items[3].getAttribute("data-checked")).toBe("true");
  });

  it("calls onToggle when a skill is selected", () => {
    const onToggle = vi.fn();
    render(<Suggestion availableSkills={mockSkills} selectedSkills={[]} onToggle={onToggle} />);

    // First skill (code-review) is at index 3 (after 3 model config items)
    fireEvent.click(screen.getAllByTestId("command-item")[3]);
    expect(onToggle).toHaveBeenCalledWith(mockSkills[0]);
  });

  it("renders empty state when search query has no matches", () => {
    render(
      <Suggestion availableSkills={mockSkills} selectedSkills={[]} onToggle={vi.fn()} searchQuery="nonexistent" />
    );

    expect(screen.getByTestId("command-empty")).toBeInTheDocument();
    expect(screen.getByText("No results found.")).toBeInTheDocument();
  });

  it("applies size prop to PopoverContent for positioning", () => {
    const size = { width: 400, height: 60 };
    render(<Suggestion availableSkills={mockSkills} selectedSkills={[]} onToggle={vi.fn()} size={size} />);

    const popover = screen.getByTestId("popover-content");
    expect(popover.style.width).toBe(`${400 - 32}px`);
    expect(popover.getAttribute("data-side-offset")).toBe("10");
  });

  it("uses default values when size prop is not provided", () => {
    render(<Suggestion availableSkills={mockSkills} selectedSkills={[]} onToggle={vi.fn()} />);

    const popover = screen.getByTestId("popover-content");
    // When size is undefined, width is (0 - 32) = -32, which becomes an empty style string
    expect(popover.style.width).toBe("");
    expect(popover.getAttribute("data-side-offset")).toBe("50");
  });
});
