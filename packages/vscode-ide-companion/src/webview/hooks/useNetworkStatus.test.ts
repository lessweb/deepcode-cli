/**
 * Unit tests for useNetworkStatus hook
 *
 * Tests cover:
 * - Returns isOnline based on navigator.onLine
 * - Subscribes to online/offline events
 */

import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useNetworkStatus } from "./useNetworkStatus";

describe("useNetworkStatus", () => {
  let addEventListenerSpy: ReturnType<typeof vi.spyOn>;
  let removeEventListenerSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    addEventListenerSpy = vi.spyOn(window, "addEventListener");
    removeEventListenerSpy = vi.spyOn(window, "removeEventListener");
  });

  afterEach(() => {
    addEventListenerSpy.mockRestore();
    removeEventListenerSpy.mockRestore();
  });

  it("returns isOnline as true when navigator.onLine is true", () => {
    Object.defineProperty(navigator, "onLine", {
      writable: true,
      value: true,
    });

    const { result } = renderHook(() => useNetworkStatus());

    expect(result.current.isOnline).toBe(true);
  });

  it("returns isOnline as false when navigator.onLine is false", () => {
    Object.defineProperty(navigator, "onLine", {
      writable: true,
      value: false,
    });

    const { result } = renderHook(() => useNetworkStatus());

    expect(result.current.isOnline).toBe(false);
  });

  it("subscribes to online and offline events", () => {
    renderHook(() => useNetworkStatus());

    expect(addEventListenerSpy).toHaveBeenCalledWith("online", expect.any(Function));
    expect(addEventListenerSpy).toHaveBeenCalledWith("offline", expect.any(Function));
  });

  it("unsubscribes from events on unmount", () => {
    const { unmount } = renderHook(() => useNetworkStatus());

    unmount();

    expect(removeEventListenerSpy).toHaveBeenCalledWith("online", expect.any(Function));
    expect(removeEventListenerSpy).toHaveBeenCalledWith("offline", expect.any(Function));
  });

  it("updates isOnline when online event fires", () => {
    Object.defineProperty(navigator, "onLine", {
      writable: true,
      value: false,
    });

    const { result } = renderHook(() => useNetworkStatus());

    // Simulate going online
    Object.defineProperty(navigator, "onLine", {
      writable: true,
      value: true,
    });

    // Trigger the online event listener
    const onlineHandler = addEventListenerSpy.mock.calls.find(
      ([event]: [string]) => event === "online"
    )?.[1] as () => void;

    act(() => {
      onlineHandler?.();
    });

    // The hook uses useSyncExternalStore which handles the snapshot update
    // In our mock setup, the snapshot returns navigator.onLine
    expect(result.current.isOnline).toBe(true);
  });

  it("updates isOnline when offline event fires", () => {
    Object.defineProperty(navigator, "onLine", {
      writable: true,
      value: true,
    });

    const { result } = renderHook(() => useNetworkStatus());

    // Simulate going offline
    Object.defineProperty(navigator, "onLine", {
      writable: true,
      value: false,
    });

    // Trigger the offline event listener
    const offlineHandler = addEventListenerSpy.mock.calls.find(
      ([event]: [string]) => event === "offline"
    )?.[1] as () => void;

    act(() => {
      offlineHandler?.();
    });

    expect(result.current.isOnline).toBe(false);
  });
});
