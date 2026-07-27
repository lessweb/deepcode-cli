/**
 * Unit tests for ContinuePrompt component
 *
 * Tests cover:
 * - Renders the continue dialog correctly
 * - Continue button triggers onContinue callback
 * - X dismiss button triggers onDismiss callback
 * - Dialog displays correct title and description text
 */

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import ContinuePrompt from "./ContinuePrompt";

describe("ContinuePrompt", () => {
  it("renders the continue dialog with correct title", () => {
    render(<ContinuePrompt onContinue={vi.fn()} onDismiss={vi.fn()} />);

    expect(screen.getByText("Session interrupted")).toBeInTheDocument();
  });

  it("renders the description text", () => {
    render(<ContinuePrompt onContinue={vi.fn()} onDismiss={vi.fn()} />);

    expect(
      screen.getByText("The previous operation was interrupted. Do you want to continue the conversation?")
    ).toBeInTheDocument();
  });

  it("renders a Continue button", () => {
    render(<ContinuePrompt onContinue={vi.fn()} onDismiss={vi.fn()} />);

    const continueButton = screen.getByRole("button", { name: /continue/i });
    expect(continueButton).toBeInTheDocument();
  });

  it("calls onContinue when Continue button is clicked", () => {
    const onContinue = vi.fn();
    const onDismiss = vi.fn();

    render(<ContinuePrompt onContinue={onContinue} onDismiss={onDismiss} />);

    const continueButton = screen.getByRole("button", { name: /continue/i });
    fireEvent.click(continueButton);

    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("calls onDismiss when X close button is clicked", () => {
    const onContinue = vi.fn();
    const onDismiss = vi.fn();

    render(<ContinuePrompt onContinue={onContinue} onDismiss={onDismiss} />);

    // The X button has title="Dismiss"
    const dismissButton = screen.getByTitle("Dismiss");
    fireEvent.click(dismissButton);

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onContinue).not.toHaveBeenCalled();
  });

  it("renders the dialog within a bordered container", () => {
    const { container } = render(<ContinuePrompt onContinue={vi.fn()} onDismiss={vi.fn()} />);

    // The dialog should have the rounded border class
    const dialogContainer = container.querySelector(".rounded-md.border");
    expect(dialogContainer).toBeInTheDocument();
  });

  it("renders with correct layout structure", () => {
    const { container } = render(<ContinuePrompt onContinue={vi.fn()} onDismiss={vi.fn()} />);

    // Should have flex layout for title and close button
    const headerRow = container.querySelector(".flex.items-center.justify-between");
    expect(headerRow).toBeInTheDocument();

    // Should have a button group
    const buttonGroup = container.querySelector(".flex.gap-2");
    expect(buttonGroup).toBeInTheDocument();
  });

  it("can be called multiple times with different callbacks", () => {
    const onContinue1 = vi.fn();
    const onDismiss1 = vi.fn();
    const onContinue2 = vi.fn();
    const onDismiss2 = vi.fn();

    const { rerender } = render(<ContinuePrompt onContinue={onContinue1} onDismiss={onDismiss1} />);

    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(onContinue1).toHaveBeenCalledTimes(1);

    rerender(<ContinuePrompt onContinue={onContinue2} onDismiss={onDismiss2} />);

    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(onContinue2).toHaveBeenCalledTimes(1);
    expect(onContinue1).toHaveBeenCalledTimes(1);
  });
});
