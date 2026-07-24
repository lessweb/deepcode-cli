/**
 * Unit tests for logger
 *
 * Tests cover:
 * - Logs message when in Development mode
 * - Does not log message when in Production mode
 * - Does not log message when in Test mode
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createLogger } from "./logger";

// Mock vscode module
vi.mock("vscode", () => ({
  ExtensionMode: {
    Development: 1,
    Production: 2,
    Test: 3,
  },
}));

describe("createLogger", () => {
  const mockLogger = {
    appendLine: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("logs message when in Development mode", () => {
    const mockContext = {
      extensionMode: 1,
    };

    const logger = createLogger(mockContext, mockLogger);

    logger("Test message");

    expect(mockLogger.appendLine).toHaveBeenCalledWith("Test message");
    expect(mockLogger.appendLine).toHaveBeenCalledTimes(1);
  });

  it("does not log message when in Production mode", () => {
    const mockContext = {
      extensionMode: 2,
    };

    const logger = createLogger(mockContext, mockLogger);

    logger("Test message");

    expect(mockLogger.appendLine).not.toHaveBeenCalled();
  });

  it("does not log message when in Test mode", () => {
    const mockContext = {
      extensionMode: 3,
    };

    const logger = createLogger(mockContext, mockLogger);

    logger("Test message");

    expect(mockLogger.appendLine).not.toHaveBeenCalled();
  });

  it("logs multiple messages when called multiple times in Development mode", () => {
    const mockContext = {
      extensionMode: 1,
    };

    const logger = createLogger(mockContext, mockLogger);

    logger("Message 1");
    logger("Message 2");
    logger("Message 3");

    expect(mockLogger.appendLine).toHaveBeenCalledTimes(3);
    expect(mockLogger.appendLine).toHaveBeenCalledWith("Message 1");
    expect(mockLogger.appendLine).toHaveBeenCalledWith("Message 2");
    expect(mockLogger.appendLine).toHaveBeenCalledWith("Message 3");
  });
});
