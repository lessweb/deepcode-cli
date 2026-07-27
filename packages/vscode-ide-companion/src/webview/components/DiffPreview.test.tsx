/**
 * Unit tests for DiffPreview component
 *
 * Tests cover:
 * - Null/empty state rendering
 * - File path display and Open button
 * - View Diff button (conditional on diff_preview)
 * - Output text rendering
 * - Diff line rendering (added, removed, context)
 * - Button click handlers (wrpc.openFile, wrpc.showDiffEditor)
 * - Edge cases (missing diff, empty output, truncated diffs)
 */

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import DiffPreview from "./DiffPreview";
import type { FileToolMetadata } from "@/webview/components/bubbles/ToolBubble";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockOpenFileMutate = vi.fn<(input: { filePath: string; line: number }) => Promise<{ ok: boolean }>>();
const mockShowDiffEditorMutate =
  vi.fn<(input: { filePath: string; diffPreview: string }) => Promise<{ ok: boolean }>>();

vi.mock("@/webview/wrpc", () => ({
  wrpc: {
    openFile: { mutate: (input: unknown) => mockOpenFileMutate(input as { filePath: string; line: number }) },
    showDiffEditor: {
      mutate: (input: unknown) => mockShowDiffEditorMutate(input as { filePath: string; diffPreview: string }),
    },
  },
}));

vi.mock("@/webview/components/ui/button", () => ({
  Button: vi.fn(({ children, onClick, title, variant, size, ...props }: Record<string, unknown>) => {
    if (variant === "link") {
      return (
        <button data-testid="file-path-link" onClick={onClick as () => void} title={title as string} {...props}>
          {children as React.ReactNode}
        </button>
      );
    }
    return (
      <button data-testid="action-button" onClick={onClick as () => void} title={title as string} {...props}>
        {children as React.ReactNode}
      </button>
    );
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildMetadata(overrides: Partial<FileToolMetadata> = {}): FileToolMetadata {
  return {
    file_path: "/src/app.ts",
    diff_preview: `--- a/src/app.ts
+++ b/src/app.ts
@@ -5,3 +5,3 @@
 const x = 1;
-const y = 2;
+const y = 3;
 return x + y;`,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DiffPreview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ------------------------------------------------------------------
  // Null / empty state
  // ------------------------------------------------------------------

  describe("null / empty state", () => {
    it("returns null when metadata is undefined", () => {
      const { container } = render(<DiffPreview metadata={undefined as unknown as FileToolMetadata} output="" />);
      expect(container).toBeEmptyDOMElement();
    });

    it("returns null when file_path is undefined", () => {
      const { container } = render(<DiffPreview metadata={{ type: "edit" } as FileToolMetadata} output="" />);
      expect(container).toBeEmptyDOMElement();
    });

    it("returns null when file_path is empty string", () => {
      const { container } = render(<DiffPreview metadata={{ file_path: "" }} output="" />);
      expect(container).toBeEmptyDOMElement();
    });
  });

  // ------------------------------------------------------------------
  // File path rendering
  // ------------------------------------------------------------------

  describe("file path rendering", () => {
    it("renders the file path as a clickable link", () => {
      render(<DiffPreview metadata={buildMetadata()} output="" />);
      const link = screen.getByTestId("file-path-link");
      expect(link).toBeInTheDocument();
      expect(link).toHaveTextContent("/src/app.ts");
    });

    it('renders "File" label', () => {
      render(<DiffPreview metadata={buildMetadata()} output="" />);
      expect(screen.getByText("File")).toBeInTheDocument();
    });

    it("clicking the file path link calls wrpc.openFile.mutate", () => {
      const metadata = buildMetadata();
      render(<DiffPreview metadata={metadata} output="" />);
      const link = screen.getByTestId("file-path-link");
      fireEvent.click(link);
      expect(mockOpenFileMutate).toHaveBeenCalledWith({
        filePath: metadata.file_path,
        line: 1,
      });
    });
  });

  // ------------------------------------------------------------------
  // Open button
  // ------------------------------------------------------------------

  describe('"Open" button', () => {
    it('renders "Open" button when file_path exists', () => {
      render(<DiffPreview metadata={buildMetadata()} output="" />);
      const buttons = screen.getAllByTestId("action-button");
      const openButton = buttons.find((b) => b.textContent === "Open");
      expect(openButton).toBeInTheDocument();
    });

    it('"Open" button is visible even without diff_preview', () => {
      const metadata = buildMetadata({ diff_preview: undefined });
      render(<DiffPreview metadata={metadata} output="" />);
      const buttons = screen.getAllByTestId("action-button");
      const openButton = buttons.find((b) => b.textContent === "Open");
      expect(openButton).toBeInTheDocument();
    });

    it('clicking "Open" button calls wrpc.openFile.mutate', () => {
      const metadata = buildMetadata();
      render(<DiffPreview metadata={metadata} output="" />);
      const buttons = screen.getAllByTestId("action-button");
      const openButton = buttons.find((b) => b.textContent === "Open");
      fireEvent.click(openButton!);
      expect(mockOpenFileMutate).toHaveBeenCalledWith({
        filePath: metadata.file_path,
        line: 1,
      });
    });
  });

  // ------------------------------------------------------------------
  // "View Diff" button
  // ------------------------------------------------------------------

  describe('"View Diff" button', () => {
    it('renders "View Diff" button when diff_preview exists', () => {
      render(<DiffPreview metadata={buildMetadata()} output="" />);
      const buttons = screen.getAllByTestId("action-button");
      const viewDiffButton = buttons.find((b) => b.textContent === "View Diff");
      expect(viewDiffButton).toBeInTheDocument();
    });

    it('does NOT render "View Diff" button when diff_preview is undefined', () => {
      const metadata = buildMetadata({ diff_preview: undefined });
      render(<DiffPreview metadata={metadata} output="" />);
      const buttons = screen.getAllByTestId("action-button");
      const viewDiffButton = buttons.find((b) => b.textContent === "View Diff");
      expect(viewDiffButton).toBeUndefined();
    });

    it('does NOT render "View Diff" button when diff_preview is empty string', () => {
      const metadata = buildMetadata({ diff_preview: "" });
      render(<DiffPreview metadata={metadata} output="" />);
      const buttons = screen.getAllByTestId("action-button");
      const viewDiffButton = buttons.find((b) => b.textContent === "View Diff");
      expect(viewDiffButton).toBeUndefined();
    });

    it('clicking "View Diff" calls wrpc.showDiffEditor.mutate', () => {
      const metadata = buildMetadata();
      render(<DiffPreview metadata={metadata} output="" />);
      const buttons = screen.getAllByTestId("action-button");
      const viewDiffButton = buttons.find((b) => b.textContent === "View Diff");
      fireEvent.click(viewDiffButton!);
      expect(mockShowDiffEditorMutate).toHaveBeenCalledWith({
        filePath: metadata.file_path,
        diffPreview: metadata.diff_preview,
      });
    });
  });

  // ------------------------------------------------------------------
  // Output text
  // ------------------------------------------------------------------

  describe("output text", () => {
    it("renders output text when provided", () => {
      render(<DiffPreview metadata={buildMetadata()} output="File written successfully" />);
      expect(screen.getByText("File written successfully")).toBeInTheDocument();
    });

    it("does not render output when empty", () => {
      render(<DiffPreview metadata={buildMetadata()} output="" />);
      // The output div only renders when output is truthy
      expect(screen.queryByTestId("file-path-link")).toBeInTheDocument();
      expect(screen.queryByText("File written successfully")).not.toBeInTheDocument();
    });

    it("trims output text", () => {
      render(<DiffPreview metadata={buildMetadata()} output="  trimmed output  " />);
      // The output area should show trimmed text
      expect(screen.getByText("trimmed output")).toBeInTheDocument();
    });
  });

  // ------------------------------------------------------------------
  // Diff lines rendering
  // ------------------------------------------------------------------

  describe("diff lines rendering", () => {
    it('renders "Changes" header when diff has lines', () => {
      render(<DiffPreview metadata={buildMetadata()} output="" />);
      expect(screen.getByText("Changes")).toBeInTheDocument();
    });

    it("does not render diff section when no diff lines after filtering", () => {
      // Only header lines, no actual diff content
      const noContentDiff = `--- a/src/app.ts
+++ b/src/app.ts
@@ -1,1 +1,1 @@`;
      const metadata = buildMetadata({ diff_preview: noContentDiff });
      render(<DiffPreview metadata={metadata} output="" />);
      expect(screen.queryByText("Changes")).not.toBeInTheDocument();
    });

    it("renders added lines with success styling", () => {
      render(<DiffPreview metadata={buildMetadata()} output="" />);
      // The "+" line should have success class
      const elements = document.querySelectorAll(".bg-success\\/10, [class*='bg-success']");
      expect(elements.length).toBeGreaterThan(0);
    });

    it("renders removed lines with destructive styling", () => {
      render(<DiffPreview metadata={buildMetadata()} output="" />);
      // The "-" line should have destructive class
      const elements = document.querySelectorAll(".bg-destructive\\/10, [class*='bg-destructive']");
      expect(elements.length).toBeGreaterThan(0);
    });

    it("renders context lines with muted styling", () => {
      render(<DiffPreview metadata={buildMetadata()} output="" />);
      // Context lines should have text-muted-foreground class
      const elements = document.querySelectorAll(".text-muted-foreground");
      // At least the "File" label and context line should exist
      expect(elements.length).toBeGreaterThanOrEqual(1);
    });

    it("skips empty lines in diff", () => {
      const diffWithEmpty = `--- a/src/app.ts
+++ b/src/app.ts
@@ -1,3 +1,3 @@

 const x = 1;
-const y = 2;
+const y = 3;
`;
      const metadata = buildMetadata({ diff_preview: diffWithEmpty });
      render(<DiffPreview metadata={metadata} output="" />);
      // Should still render without crashing
      expect(screen.getByText("Changes")).toBeInTheDocument();
    });

    it("renders prefix indicator for added/removed lines", () => {
      const diff = `--- a/test.ts
+++ b/test.ts
@@ -1,2 +1,2 @@
-old line
+new line`;
      const metadata = buildMetadata({ diff_preview: diff });
      render(<DiffPreview metadata={metadata} output="" />);

      // "+" prefix for added lines
      const plusSignElements = screen.getAllByText("+");
      // There should be at least one "+" sign (from the added line prefix)
      const plusPrefix = plusSignElements.find((el) => el.textContent === "+");
      expect(plusPrefix).toBeInTheDocument();

      // "-" prefix for removed lines
      const minusPrefix = screen.queryByText("-");
      expect(minusPrefix).toBeInTheDocument();
    });
  });

  // ------------------------------------------------------------------
  // Edge cases
  // ------------------------------------------------------------------

  describe("edge cases", () => {
    it("handles file with very long path", () => {
      const longPath = "/very/long/path/to/a/file/that/is/deeply/nested/in/the/project/structure/app.ts";
      const metadata = buildMetadata({ file_path: longPath });
      render(<DiffPreview metadata={metadata} output="" />);
      expect(screen.getByText(longPath)).toBeInTheDocument();
    });

    it("handles output with special characters", () => {
      const specialOutput = "<div>HTML content</div>";
      render(<DiffPreview metadata={buildMetadata()} output={specialOutput} />);
      expect(screen.getByText(specialOutput)).toBeInTheDocument();
    });

    it("handles diff_preview with truncation marker", () => {
      const truncatedDiff = `--- a/large.ts
+++ b/large.ts
@@ -1,40 +1,40 @@
-line 1
-line 2
+new line 1
+new line 2
...`;
      const metadata = buildMetadata({ diff_preview: truncatedDiff });
      render(<DiffPreview metadata={metadata} output="" />);
      // Should render without errors
      expect(screen.getByText("Changes")).toBeInTheDocument();
    });

    it("handles single-line diff (one line added)", () => {
      const singleDiff = `--- a/file.ts
+++ b/file.ts
@@ -3,1 +3,1 @@
-old
+new`;
      const metadata = buildMetadata({ diff_preview: singleDiff });
      render(<DiffPreview metadata={metadata} output="" />);
      expect(screen.getByText("Changes")).toBeInTheDocument();
    });
  });
});
