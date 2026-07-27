/**
 * Unit tests for PlanRenderer component
 *
 * Tests cover:
 * - Rendering of headings at all 6 levels
 * - Task items with different statuses ([ ], [x], [>], [!])
 * - Bullet list items
 * - Plain paragraphs
 * - Inline markdown (code, bold, italic)
 * - Indentation of nested items
 * - Empty input
 * - HTML escaping
 */

import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import PlanRenderer from "./PlanRenderer";

vi.mock("lucide-react", () => ({
  Circle: vi.fn(({ className }: { className?: string }) => <span data-testid="icon-circle" className={className} />),
  CircleCheckBig: vi.fn(({ className }: { className?: string }) => (
    <span data-testid="icon-check" className={className} />
  )),
  Clock: vi.fn(({ className }: { className?: string }) => <span data-testid="icon-clock" className={className} />),
  CircleAlert: vi.fn(({ className }: { className?: string }) => (
    <span data-testid="icon-alert" className={className} />
  )),
}));

describe("PlanRenderer", () => {
  it("renders spacer for empty plan input", () => {
    const { container } = render(<PlanRenderer plan="" />);
    const wrapper = container.querySelector(".update-plan-markdown");
    expect(wrapper).toBeInTheDocument();
    // Empty string produces one empty line which renders as a spacer div
    expect(wrapper?.children.length).toBe(1);
  });

  it("renders headings at different levels", () => {
    const plan = "# H1\n## H2\n### H3\n#### H4\n##### H5\n###### H6";
    render(<PlanRenderer plan={plan} />);

    // Headings render via dangerouslySetInnerHTML inside <span>
    expect(screen.getByText("H1")).toBeInTheDocument();
    expect(screen.getByText("H2")).toBeInTheDocument();
    expect(screen.getByText("H3")).toBeInTheDocument();
    expect(screen.getByText("H4")).toBeInTheDocument();
    expect(screen.getByText("H5")).toBeInTheDocument();
    expect(screen.getByText("H6")).toBeInTheDocument();

    // The heading text is inside a <span> within the <h1>/<h6> elements
    const h1Text = screen.getByText("H1");
    expect(h1Text.closest("h1")).toBeInTheDocument();
    const h6Text = screen.getByText("H6");
    expect(h6Text.closest("h6")).toBeInTheDocument();
  });

  it("falls through to paragraph when heading has too many #", () => {
    // 7 # characters won't match the heading regex, so it falls through to paragraph
    const plan = "####### Too Deep";
    render(<PlanRenderer plan={plan} />);
    // The whole line renders as a paragraph
    const p = document.querySelector("p");
    expect(p).toBeInTheDocument();
    expect(p?.textContent).toContain("Too Deep");
  });

  it("renders todo task items with Circle icon", () => {
    const plan = "- [ ] Write tests";
    render(<PlanRenderer plan={plan} />);
    // Text is rendered via dangerouslySetInnerHTML
    expect(screen.getByText("Write tests")).toBeInTheDocument();
    // Todo status uses Circle icon
    expect(screen.getByTestId("icon-circle")).toBeInTheDocument();
  });

  it("renders completed task items with check icon", () => {
    const plan = "- [x] Implement login";
    render(<PlanRenderer plan={plan} />);
    expect(screen.getByText("Implement login")).toBeInTheDocument();
    expect(screen.getByTestId("icon-check")).toBeInTheDocument();
  });

  it("renders active task items with clock icon", () => {
    const plan = "- [>] In progress feature";
    render(<PlanRenderer plan={plan} />);
    expect(screen.getByText("In progress feature")).toBeInTheDocument();
    expect(screen.getByTestId("icon-clock")).toBeInTheDocument();
  });

  it("renders attention task items with alert icon", () => {
    const plan = "- [!] Blocked by dependency";
    render(<PlanRenderer plan={plan} />);
    expect(screen.getByText("Blocked by dependency")).toBeInTheDocument();
    expect(screen.getByTestId("icon-alert")).toBeInTheDocument();
  });

  it("supports X (uppercase) for completed status", () => {
    const plan = "- [X] Done (uppercase X)";
    render(<PlanRenderer plan={plan} />);
    expect(screen.getByText("Done (uppercase X)")).toBeInTheDocument();
    expect(screen.getByTestId("icon-check")).toBeInTheDocument();
  });

  it("renders bullet list items", () => {
    const plan = "- Regular bullet\n* Star bullet";
    render(<PlanRenderer plan={plan} />);
    expect(screen.getByText("Regular bullet")).toBeInTheDocument();
    expect(screen.getByText("Star bullet")).toBeInTheDocument();
  });

  it("renders plain paragraphs", () => {
    const plan = "This is a plain paragraph.";
    render(<PlanRenderer plan={plan} />);
    expect(screen.getByText("This is a plain paragraph.")).toBeInTheDocument();
  });

  it("renders inline code in items", () => {
    const plan = "- [x] Use `useMemo` for optimization";
    render(<PlanRenderer plan={plan} />);
    const codeEl = document.querySelector("code");
    expect(codeEl).toBeInTheDocument();
    expect(codeEl?.textContent).toBe("useMemo");
  });

  it("renders inline bold text", () => {
    const plan = "- [x] Fix **critical** bug";
    render(<PlanRenderer plan={plan} />);
    const strongEl = document.querySelector("strong");
    expect(strongEl).toBeInTheDocument();
    expect(strongEl?.textContent).toBe("critical");
  });

  it("renders inline italic text", () => {
    const plan = "- Note: *optional* parameter";
    render(<PlanRenderer plan={plan} />);
    const emEl = document.querySelector("em");
    expect(emEl).toBeInTheDocument();
    expect(emEl?.textContent).toBe("optional");
  });

  it("escapes HTML in plan content", () => {
    const plan = "- [x] Test <script>alert('xss')</script>";
    render(<PlanRenderer plan={plan} />);
    const rendered = document.body.innerHTML;
    expect(rendered).toContain("&lt;script&gt;");
    expect(rendered).not.toContain("<script>alert");
  });

  it("handles indented task items", () => {
    const plan = "  - [ ] Sub task";
    render(<PlanRenderer plan={plan} />);
    expect(screen.getByText("Sub task")).toBeInTheDocument();
  });

  it("renders empty lines as spacers", () => {
    const plan = "- [x] Task 1\n\n- [ ] Task 2";
    render(<PlanRenderer plan={plan} />);
    expect(screen.getByText("Task 1")).toBeInTheDocument();
    expect(screen.getByText("Task 2")).toBeInTheDocument();
    // There should be an empty line spacer between
    const spacers = document.querySelectorAll(".h-1");
    expect(spacers.length).toBeGreaterThanOrEqual(1);
  });

  it("renders a mixed plan with multiple element types", () => {
    const plan = [
      "# Project Plan",
      "This is the overview.",
      "## Tasks",
      "- [x] Setup project `init`",
      "- [>] Build **core** features",
      "- [!] Fix *critical* bug",
      "- [ ] Write documentation",
      "- **Important**: review before merge",
    ].join("\n");
    render(<PlanRenderer plan={plan} />);
    expect(screen.getByText("Project Plan")).toBeInTheDocument();
    expect(screen.getByText("Tasks")).toBeInTheDocument();
    expect(screen.getByTestId("icon-check")).toBeInTheDocument();
    expect(screen.getByTestId("icon-clock")).toBeInTheDocument();
    expect(screen.getByTestId("icon-alert")).toBeInTheDocument();
    expect(screen.getByTestId("icon-circle")).toBeInTheDocument();
  });

  it("handles null/undefined plan gracefully", () => {
    const { container } = render(<PlanRenderer plan={null as unknown as string} />);
    expect(container.querySelector(".update-plan-markdown")).toBeInTheDocument();
    const { container: container2 } = render(<PlanRenderer plan={undefined as unknown as string} />);
    expect(container2.querySelector(".update-plan-markdown")).toBeInTheDocument();
  });
});
