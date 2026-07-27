/**
 * Unit tests for checkForUpdates
 *
 * Tests cover:
 * - Successful update check when a newer version is available
 * - No prompt when current version is up to date
 * - Handles non-ok response from marketplace
 * - Handles missing version data in response
 * - Handles fetch errors gracefully
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkForUpdates } from "./checkForUpdates";
import { window as vscodeWindow, commands as vscodeCommands } from "@/tests/__mocks__/vscode";

interface MarketplaceResponse {
  results: Array<{
    extensions?: Array<{
      versions?: Array<{ version: string }>;
    }>;
  }>;
}

interface MockFetchResponse {
  ok: boolean;
  statusText: string;
  json: () => Promise<MarketplaceResponse>;
}

describe("checkForUpdates", () => {
  const mockLog = vi.fn();
  const mockContext = {
    extension: {
      id: "test.extension",
      packageJSON: { version: "1.0.0" },
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("prompts for update when a newer version is available and user clicks Update", async () => {
    const mockResponse: MockFetchResponse = {
      ok: true,
      statusText: "OK",
      json: async () => ({
        results: [
          {
            extensions: [
              {
                versions: [{ version: "2.0.0" }],
              },
            ],
          },
        ],
      }),
    };
    global.fetch = vi.fn().mockResolvedValue(mockResponse);
    vi.mocked(vscodeWindow.showInformationMessage).mockResolvedValue("Update");

    await checkForUpdates(mockContext, mockLog);

    expect(vscodeWindow.showInformationMessage).toHaveBeenCalledWith(
      "A new version (2.0.0) of this extension is available.",
      "Update"
    );
    expect(vscodeCommands.executeCommand).toHaveBeenCalledWith(
      "workbench.extensions.installExtension",
      "test.extension"
    );
    expect(mockLog).not.toHaveBeenCalled();
  });

  it("does not install when user dismisses the update prompt", async () => {
    const mockResponse: MockFetchResponse = {
      ok: true,
      statusText: "OK",
      json: async () => ({
        results: [
          {
            extensions: [
              {
                versions: [{ version: "2.0.0" }],
              },
            ],
          },
        ],
      }),
    };
    global.fetch = vi.fn().mockResolvedValue(mockResponse);
    vi.mocked(vscodeWindow.showInformationMessage).mockResolvedValue(undefined);

    await checkForUpdates(mockContext, mockLog);

    expect(vscodeWindow.showInformationMessage).toHaveBeenCalled();
    expect(vscodeCommands.executeCommand).not.toHaveBeenCalled();
  });

  it("does not prompt when current version is up to date", async () => {
    const mockResponse: MockFetchResponse = {
      ok: true,
      statusText: "OK",
      json: async () => ({
        results: [
          {
            extensions: [
              {
                versions: [{ version: "1.0.0" }],
              },
            ],
          },
        ],
      }),
    };
    global.fetch = vi.fn().mockResolvedValue(mockResponse);

    await checkForUpdates(mockContext, mockLog);

    expect(vscodeWindow.showInformationMessage).not.toHaveBeenCalled();
    expect(vscodeCommands.executeCommand).not.toHaveBeenCalled();
  });

  it("does not prompt when current version is newer than marketplace", async () => {
    const mockResponse: MockFetchResponse = {
      ok: true,
      statusText: "OK",
      json: async () => ({
        results: [
          {
            extensions: [
              {
                versions: [{ version: "0.5.0" }],
              },
            ],
          },
        ],
      }),
    };
    global.fetch = vi.fn().mockResolvedValue(mockResponse);

    await checkForUpdates(mockContext, mockLog);

    expect(vscodeWindow.showInformationMessage).not.toHaveBeenCalled();
  });

  it("logs error when fetch response is not ok", async () => {
    const mockResponse: MockFetchResponse = {
      ok: false,
      statusText: "Not Found",
      json: async () => ({ results: [] }),
    };
    global.fetch = vi.fn().mockResolvedValue(mockResponse);

    await checkForUpdates(mockContext, mockLog);

    expect(mockLog).toHaveBeenCalledWith("Failed to fetch latest version info: Not Found");
    expect(vscodeWindow.showInformationMessage).not.toHaveBeenCalled();
  });

  it("does not prompt when version data is missing", async () => {
    const mockResponse: MockFetchResponse = {
      ok: true,
      statusText: "OK",
      json: async () => ({
        results: [{ extensions: [{}] }],
      }),
    };
    global.fetch = vi.fn().mockResolvedValue(mockResponse);

    await checkForUpdates(mockContext, mockLog);

    expect(vscodeWindow.showInformationMessage).not.toHaveBeenCalled();
  });

  it("handles fetch errors gracefully", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

    await checkForUpdates(mockContext, mockLog);

    expect(mockLog).toHaveBeenCalledWith("Error checking for extension updates: Network error");
    expect(vscodeWindow.showInformationMessage).not.toHaveBeenCalled();
  });

  it("handles non-Error exceptions", async () => {
    global.fetch = vi.fn().mockRejectedValue("String error");

    await checkForUpdates(mockContext, mockLog);

    expect(mockLog).toHaveBeenCalledWith("Error checking for extension updates: String error");
  });
});
