/**
 * Unit tests for PromptAttachments component
 */

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { PromptAttachments } from "./PromptAttachments";
import { usePromptAttachments } from "@/webview/hooks/usePromptAttachments";

describe("PromptAttachments", () => {
  it("renders nothing when no attachments", () => {
    const { container } = render(<PromptAttachments attachments={[]} onRemove={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders attachments with remove button", () => {
    const attachments = [
      { id: 1, name: "image1.png", mimeType: "image/png", dataUrl: "data:image/png;base64,abc", label: "粘贴的图像" },
    ];
    render(<PromptAttachments attachments={attachments} onRemove={vi.fn()} />);

    expect(screen.getByText("粘贴的图像")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
  });

  it("calls onRemove when remove button clicked", () => {
    const onRemove = vi.fn();
    const attachments = [
      { id: 1, name: "image1.png", mimeType: "image/png", dataUrl: "data:image/png;base64,abc", label: "粘贴的图像" },
    ];
    render(<PromptAttachments attachments={attachments} onRemove={onRemove} />);

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(onRemove).toHaveBeenCalledWith(1);
  });

  it("renders multiple attachments", () => {
    const attachments = [
      { id: 1, name: "image1.png", mimeType: "image/png", dataUrl: "data:image/png;base64,abc", label: "粘贴的图像" },
      { id: 2, name: "image2.png", mimeType: "image/png", dataUrl: "data:image/png;base64,def", label: "粘贴的图像" },
    ];
    render(<PromptAttachments attachments={attachments} onRemove={vi.fn()} />);

    const items = screen.getAllByText("粘贴的图像");
    expect(items).toHaveLength(2);
  });
});

describe("usePromptAttachments", () => {
  function TestComponent() {
    const { attachments, handlePaste, removeAttachment, clearAttachments, getImageUrls, loadImages } =
      usePromptAttachments();

    return (
      <div>
        <div data-testid="count">{attachments.length}</div>
        <div data-testid="urls">{getImageUrls().join(",")}</div>
        <textarea data-testid="textarea" onPaste={handlePaste} />
        <button data-testid="remove" onClick={() => removeAttachment(1)}>
          Remove
        </button>
        <button data-testid="clear" onClick={clearAttachments}>
          Clear
        </button>
        <button data-testid="loadImages" onClick={() => loadImages(["data:image/png;base64,xyz"])}>
          Load Images
        </button>
      </div>
    );
  }

  it("starts with no attachments", () => {
    render(<TestComponent />);
    expect(screen.getByTestId("count").textContent).toBe("0");
  });

  it("adds attachment on paste image", async () => {
    render(<TestComponent />);

    const file = new File([""], "test.png", { type: "image/png" });
    const clipboardEvent = {
      clipboardData: {
        items: [{ kind: "file", type: "image/png", getAsFile: () => file }],
      },
      preventDefault: vi.fn(),
    };

    fireEvent.paste(screen.getByTestId("textarea"), clipboardEvent);

    // Wait for async file reading
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(screen.getByTestId("count").textContent).toBe("1");
  });

  it("clears all attachments", async () => {
    render(<TestComponent />);

    const file = new File([""], "test.png", { type: "image/png" });
    const clipboardEvent = {
      clipboardData: {
        items: [{ kind: "file", type: "image/png", getAsFile: () => file }],
      },
      preventDefault: vi.fn(),
    };

    fireEvent.paste(screen.getByTestId("textarea"), clipboardEvent);
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(screen.getByTestId("count").textContent).toBe("1");

    fireEvent.click(screen.getByTestId("clear"));
    expect(screen.getByTestId("count").textContent).toBe("0");
  });

  it("loads images from URLs (for editing)", async () => {
    render(<TestComponent />);

    expect(screen.getByTestId("count").textContent).toBe("0");

    fireEvent.click(screen.getByTestId("loadImages"));

    expect(screen.getByTestId("count").textContent).toBe("1");
    expect(screen.getByTestId("urls").textContent).toBe("data:image/png;base64,xyz");
  });

  it("does not duplicate existing images when loading", async () => {
    render(<TestComponent />);

    // Load the same image twice
    fireEvent.click(screen.getByTestId("loadImages"));
    fireEvent.click(screen.getByTestId("loadImages"));

    expect(screen.getByTestId("count").textContent).toBe("1");
  });

  it("loads multiple images from URLs", async () => {
    function MultiLoadTest() {
      const { attachments, loadImages } = usePromptAttachments();
      return (
        <div>
          <div data-testid="count">{attachments.length}</div>
          <button
            data-testid="loadMultiple"
            onClick={() => loadImages(["data:image/png;base64,img1", "data:image/jpeg;base64,img2"])}
          >
            Load Multiple
          </button>
        </div>
      );
    }

    render(<MultiLoadTest />);

    fireEvent.click(screen.getByTestId("loadMultiple"));

    expect(screen.getByTestId("count").textContent).toBe("2");
  });
});
