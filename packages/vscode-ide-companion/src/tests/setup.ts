/**
 * Vitest setup file
 *
 * Configures global test utilities and mocks.
 */

import "@testing-library/jest-dom";
import { vi } from "vitest";

// ---------------------------------------------------------------------------
// Global mocks
// ---------------------------------------------------------------------------

// Mock VS Code module for extension utilities
vi.mock("vscode", () => ({
  window: {
    showInformationMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    showTextDocument: vi.fn(),
    activeTextEditor: undefined,
  },
  commands: {
    executeCommand: vi.fn(),
    registerCommand: vi.fn(),
  },
  ExtensionMode: {
    Development: 1,
    Production: 2,
    Test: 3,
  },
  Uri: {
    file: vi.fn((path: string) => ({ fsPath: path })),
  },
}));

// Mock window.matchMedia
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock ResizeObserver
class ResizeObserverMock {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
window.ResizeObserver = ResizeObserverMock;

// Mock IntersectionObserver
class IntersectionObserverMock implements IntersectionObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  takeRecords = vi.fn();
  root: Element | null = null;
  rootMargin: string = "";
  thresholds: ReadonlyArray<number> = [];
  constructor() {}
  scrollMargin: string = "";
}
window.IntersectionObserver = IntersectionObserverMock as unknown as typeof IntersectionObserver;

// Mock VS Code API
const mockVSCode = {
  postMessage: vi.fn(),
  getState: vi.fn(() => ({})),
  setState: vi.fn(),
};
Object.defineProperty(window, "acquireVsCodeApi", {
  writable: true,
  value: () => mockVSCode,
});

// Mock localStorage with real in-memory storage
const storageStore = new Map<string, string>();
const localStorageMock = {
  getItem: vi.fn((key: string) => storageStore.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => {
    storageStore.set(key, value);
  }),
  removeItem: vi.fn((key: string) => {
    storageStore.delete(key);
  }),
  clear: vi.fn(() => {
    storageStore.clear();
  }),
};
Object.defineProperty(window, "localStorage", {
  writable: true,
  value: localStorageMock,
});

// Mock navigator.onLine
Object.defineProperty(navigator, "onLine", {
  writable: true,
  value: true,
});

// ---------------------------------------------------------------------------
// Global test utilities
// ---------------------------------------------------------------------------

// Silence console.error in tests unless explicitly needed
// Uncomment the following to see all console errors during tests:
// global.console.error = console.error;

// Suppress specific warnings in tests
const originalWarn = console.warn;
console.warn = (...args: unknown[]) => {
  if (
    typeof args[0] === "string" &&
    (args[0].includes("ReactDOM.render") || args[0].includes("act()") || args[0].includes("Warning:"))
  ) {
    return;
  }
  originalWarn(...args);
};
