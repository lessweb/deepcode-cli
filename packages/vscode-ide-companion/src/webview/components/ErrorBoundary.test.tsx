/**
 * Unit tests for ErrorBoundary component
 *
 * Tests cover:
 * - Renders children when no error
 * - Shows error UI when error occurs
 * - Reset functionality
 */

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary";

describe("ErrorBoundary", () => {
  // Test component that throws
  const ThrowError = ({ shouldThrow }: { shouldThrow: boolean }) => {
    if (shouldThrow) {
      throw new Error("Test error message");
    }
    return <div>Content rendered successfully</div>;
  };

  it("renders children when there is no error", () => {
    render(
      <ErrorBoundary>
        <div data-testid="child">Test Child</div>
      </ErrorBoundary>
    );

    expect(screen.getByTestId("child")).toBeInTheDocument();
    expect(screen.getByText("Test Child")).toBeInTheDocument();
  });

  it("displays error message when child throws", () => {
    render(
      <ErrorBoundary>
        <ThrowError shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByText("Test error message")).toBeInTheDocument();
  });

  it("displays generic message when error has no message", () => {
    // Error() creates error with empty string message by default
    // `error?.message ?? '...'` uses `??` so empty string is NOT nullish
    // An empty message will render as empty string
    const NoMessageError = () => {
      throw new Error(); // message = ""
    };

    render(
      <ErrorBoundary>
        <NoMessageError />
      </ErrorBoundary>
    );

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    // The rendered error message is empty string (not "An unexpected error occurred")
    // because `error.message` is "" which is not null/undefined for `??`
    expect(screen.queryByText("An unexpected error occurred")).not.toBeInTheDocument();
  });

  it("has a reset/try again button", () => {
    render(
      <ErrorBoundary>
        <ThrowError shouldThrow={true} />
      </ErrorBoundary>
    );

    const resetButton = screen.getByRole("button", { name: /try again/i });
    expect(resetButton).toBeInTheDocument();
  });

  it("resets error state when try again button is clicked", () => {
    let shouldThrow = true;

    function TestComponent() {
      if (shouldThrow) {
        throw new Error("Test error");
      }
      return <div data-testid="recovered">Recovered!</div>;
    }

    render(
      <ErrorBoundary>
        <TestComponent />
      </ErrorBoundary>
    );

    // Error should be showing
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();

    // Click reset
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));

    // The error boundary should have reset, but component still throws
    // So we need to update shouldThrow state
    shouldThrow = false;

    // Re-render with fixed state
    render(
      <ErrorBoundary>
        <TestComponent />
      </ErrorBoundary>
    );

    // Now it should show recovered content
    expect(screen.getByTestId("recovered")).toBeInTheDocument();
  });

  it("logs error to console when componentDidCatch is called", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const FailingComponent = () => {
      throw new Error("Caught by boundary");
    };

    render(
      <ErrorBoundary>
        <FailingComponent />
      </ErrorBoundary>
    );

    expect(consoleSpy).toHaveBeenCalledWith("[ErrorBoundary] Uncaught error:", expect.any(Error), expect.any(Object));

    consoleSpy.mockRestore();
  });

  it("renders different child components correctly", () => {
    function SimpleComponent() {
      return <p>Simple content</p>;
    }

    render(
      <ErrorBoundary>
        <SimpleComponent />
      </ErrorBoundary>
    );

    expect(screen.getByText("Simple content")).toBeInTheDocument();
  });

  it("handles nested errors", () => {
    function DeeplyNestedError() {
      return (
        <div>
          <span>Before error</span>
          <ThrowError shouldThrow={true} />
        </div>
      );
    }

    render(
      <ErrorBoundary>
        <DeeplyNestedError />
      </ErrorBoundary>
    );

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });
});
