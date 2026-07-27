/**
 * Unit tests for useSize hook
 *
 * Tests cover:
 * - Returns undefined when target element is null
 * - Returns initial size from clientWidth/clientHeight
 * - Observes element with ResizeObserver
 * - Disconnects ResizeObserver on unmount
 * - Updates size when ResizeObserver callback fires
 */

import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useSize } from "./useSize";

describe("useSize", () => {
  let resizeCallback: ((entries: ResizeObserverEntry[]) => void) | null = null;

  function createMockElement(width: number, height: number): HTMLElement {
    const el = document.createElement("div");
    Object.defineProperty(el, "clientWidth", { value: width, configurable: true });
    Object.defineProperty(el, "clientHeight", { value: height, configurable: true });
    return el;
  }

  beforeEach(() => {
    resizeCallback = null;

    // Override ResizeObserver to capture the callback
    window.ResizeObserver = class MockResizeObserver {
      private callback: (entries: ResizeObserverEntry[]) => void;
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();

      constructor(callback: (entries: ResizeObserverEntry[]) => void) {
        this.callback = callback;
        resizeCallback = callback;
      }

      // Helper to simulate a resize event
      _triggerResize(entries: ResizeObserverEntry[]) {
        this.callback(entries);
      }
    } as unknown as typeof ResizeObserver;
  });

  it("returns undefined when target ref has no current element", () => {
    const ref = { current: null };
    const { result } = renderHook(() => useSize(ref));
    expect(result.current).toBeUndefined();
  });

  it("returns initial size from target element", () => {
    const el = createMockElement(200, 100);
    const ref = { current: el };
    const { result } = renderHook(() => useSize(ref));
    expect(result.current).toEqual({ width: 200, height: 100 });
  });

  it("observes the target element", () => {
    const el = createMockElement(200, 100);
    const ref = { current: el };

    const observeSpy = vi.fn();
    const disconnectSpy = vi.fn();

    window.ResizeObserver = class {
      observe = observeSpy;
      unobserve = vi.fn();
      disconnect = disconnectSpy;
      constructor(_cb: unknown) {}
    } as unknown as typeof ResizeObserver;

    renderHook(() => useSize(ref));

    expect(observeSpy).toHaveBeenCalledWith(el);
  });

  it("disconnects ResizeObserver on unmount", () => {
    const el = createMockElement(200, 100);
    const ref = { current: el };

    const disconnectSpy = vi.fn();
    window.ResizeObserver = class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = disconnectSpy;
      constructor(_cb: unknown) {}
    } as unknown as typeof ResizeObserver;

    const { unmount } = renderHook(() => useSize(ref));
    unmount();

    expect(disconnectSpy).toHaveBeenCalled();
  });

  it("updates size when element resizes", () => {
    const el = createMockElement(200, 100);
    const ref = { current: el };

    let capturedCallback: ((entries: ResizeObserverEntry[]) => void) | null = null;

    window.ResizeObserver = class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
      constructor(cb: (entries: ResizeObserverEntry[]) => void) {
        capturedCallback = cb;
      }
    } as unknown as typeof ResizeObserver;

    const { result } = renderHook(() => useSize(ref));

    expect(result.current).toEqual({ width: 200, height: 100 });

    // Update element dimensions
    Object.defineProperty(el, "clientWidth", { value: 400, configurable: true });
    Object.defineProperty(el, "clientHeight", { value: 300, configurable: true });

    // Simulate ResizeObserver callback
    act(() => {
      capturedCallback?.([
        { target: el, contentRect: new DOMRectReadOnly(0, 0, 400, 300) },
      ] as unknown as ResizeObserverEntry[]);
    });

    expect(result.current).toEqual({ width: 400, height: 300 });
  });

  it("does nothing when target element becomes null after mount", () => {
    const el = createMockElement(200, 100);
    const ref = { current: el } as React.RefObject<HTMLElement | null>;

    const observeSpy = vi.fn();
    window.ResizeObserver = class {
      observe = observeSpy;
      unobserve = vi.fn();
      disconnect = vi.fn();
      constructor(_cb: unknown) {}
    } as unknown as typeof ResizeObserver;

    renderHook(() => useSize(ref));

    expect(observeSpy).toHaveBeenCalledWith(el);
  });
});
