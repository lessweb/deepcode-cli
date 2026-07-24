/**
 * Unit tests for SkillsTags component
 *
 * Tests cover:
 * - Rendering nothing when no skills selected
 * - Rendering skill tags with proper labels
 * - Calling onRemove when X button clicked
 * - Multiple skill rendering
 */

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import SkillsTags from "./SkillsTags";
import type { SkillInfo } from "@/webview/types";

vi.mock("./ui/badge", () => ({
  Badge: vi.fn(({ children, ...props }) => (
    <span data-testid="badge" {...props}>
      {children}
    </span>
  )),
}));

vi.mock("./ui/button", () => ({
  Button: vi.fn(({ children, onClick, ...props }) => (
    <button onClick={onClick} {...props}>
      {children}
    </button>
  )),
}));

vi.mock("./ui/input-group", () => ({
  InputGroupAddon: vi.fn(({ children, ...props }) => (
    <div data-testid="input-group-addon" {...props}>
      {children}
    </div>
  )),
}));

vi.mock("lucide-react", () => ({
  X: vi.fn(() => <span data-testid="x-icon" />),
}));

const mockSkill: SkillInfo = {
  name: "code-review",
  description: "Review code",
  path: "/skills/code-review",
  isLoaded: true,
};

const mockSkill2: SkillInfo = {
  name: "test-gen",
  description: "Generate tests",
  path: "/skills/test-gen",
  isLoaded: false,
};

describe("SkillsTags", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing when no skills selected", () => {
    const { container } = render(<SkillsTags selectedSkills={[]} onRemove={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a single skill tag", () => {
    render(<SkillsTags selectedSkills={[mockSkill]} onRemove={vi.fn()} />);
    expect(screen.getByText("Code Review")).toBeInTheDocument();
  });

  it("renders skill names with title case conversion", () => {
    render(<SkillsTags selectedSkills={[{ ...mockSkill, name: "code-review" }]} onRemove={vi.fn()} />);
    expect(screen.getByText("Code Review")).toBeInTheDocument();
  });

  it("renders multiple skills", () => {
    render(<SkillsTags selectedSkills={[mockSkill, mockSkill2]} onRemove={vi.fn()} />);
    expect(screen.getByText("Code Review")).toBeInTheDocument();
    expect(screen.getByText("Test Gen")).toBeInTheDocument();
  });

  it("calls onRemove with skill name when X is clicked", () => {
    const onRemove = vi.fn();
    render(<SkillsTags selectedSkills={[mockSkill]} onRemove={onRemove} />);
    const xIcons = screen.getAllByTestId("x-icon");
    fireEvent.click(xIcons[0]);
    expect(onRemove).toHaveBeenCalledWith("code-review");
  });

  it("calls onRemove with correct name for each skill", () => {
    const onRemove = vi.fn();
    render(<SkillsTags selectedSkills={[mockSkill, mockSkill2]} onRemove={onRemove} />);
    const xIcons = screen.getAllByTestId("x-icon");
    fireEvent.click(xIcons[0]);
    expect(onRemove).toHaveBeenCalledWith("code-review");
    fireEvent.click(xIcons[1]);
    expect(onRemove).toHaveBeenCalledWith("test-gen");
  });

  it("renders badges with secondary variant", () => {
    render(<SkillsTags selectedSkills={[mockSkill]} onRemove={vi.fn()} />);
    const badges = screen.getAllByTestId("badge");
    expect(badges).toHaveLength(1);
  });

  it("renders within InputGroupAddon wrapper", () => {
    render(<SkillsTags selectedSkills={[mockSkill]} onRemove={vi.fn()} />);
    expect(screen.getByTestId("input-group-addon")).toBeInTheDocument();
  });
});
